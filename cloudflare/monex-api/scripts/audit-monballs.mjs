/**
 * Audit MonBall economy for one user (production KV).
 *
 * Usage:
 *   node scripts/audit-monballs.mjs Daniel_Freire15
 *   node scripts/audit-monballs.mjs --json daniel_freire15
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDailyLoginDayKeyFromTimestamp } from "../src/lib/daily-reset.js";
import { replyCountKey, todayUtcDay } from "../src/lib/reply-tracker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readNamespaceId() {
  if (process.env.MONEX_KV_NAMESPACE_ID) return process.env.MONEX_KV_NAMESPACE_ID;
  const toml = readFileSync(join(__dirname, "..", "wrangler.toml"), "utf8");
  const block = toml.match(/\[\[kv_namespaces\]\][\s\S]*?(?=\n\[|\n\[\[|$)/);
  const idMatch = block?.[0]?.match(/^\s*id\s*=\s*"([^"]+)"/m);
  if (idMatch?.[1]) return idMatch[1];
  throw new Error("Could not resolve KV namespace id from wrangler.toml");
}

const NAMESPACE_ID = readNamespaceId();
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const STATE_KEY = "monex:state";
const ACTIVITY_KEY = "monex:activity";
const SAVE_PREFIX = "monex:save:";
const AUDIT_PREFIX = "monex:monball-audit:";

function requireEnv() {
  if (!API_TOKEN) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  if (!ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
}

function apiUrl(path) {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}${path}`;
}

async function getValue(key) {
  const res = await fetch(apiUrl(`/values/${encodeURIComponent(key)}`), {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to read ${key}: ${res.statusText}`);
  return res.text();
}

function normalizeUsername(username) {
  return String(username || "").toLowerCase().replace(/^@/, "").trim();
}

function findUserIdInState(state, username) {
  for (const [xUserId, user] of Object.entries(state.users || {})) {
    if (user?.username?.toLowerCase() === username) return xUserId;
  }
  return null;
}

function findAllUserRows(state, username) {
  const rows = [];
  for (const [xUserId, user] of Object.entries(state.users || {})) {
    if (user?.username?.toLowerCase() === username) {
      rows.push({ xUserId, user });
    }
  }
  return rows;
}

function buildCatchLedger(entries) {
  return entries
    .filter((e) => e.xUsername?.toLowerCase() === normalizeUsername(arguments[1]))
    .map((e) => ({
      at: e.at,
      source: "x_catch_activity",
      spend: e.spend,
      caught: e.caughtCount,
      monballsLeft: e.monballsLeft,
      tweetId: e.tweetId,
      activityId: e.id,
    }));
}

function reconcileAuditTrail(audit) {
  const sorted = [...audit].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let running = null;
  const rows = [];
  for (const row of sorted) {
    const before = row.balanceBefore ?? (running != null ? running : row.balanceAfter - row.delta);
    const after = row.balanceAfter;
    rows.push({
      at: row.at,
      source: row.source,
      delta: row.delta,
      balanceBefore: before,
      balanceAfter: after,
      meta: row.meta || null,
    });
    running = after;
    const expected = before + row.delta;
    if (Math.abs(expected - after) > 0) {
      rows[rows.length - 1].reconcileError = `expected ${expected}, got ${after}`;
    }
  }
  return rows;
}

async function main() {
  requireEnv();
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const usernameArg = args.find((a) => !a.startsWith("--"));
  if (!usernameArg) {
    console.error("Usage: node scripts/audit-monballs.mjs [--json] <x_username>");
    process.exit(1);
  }
  const username = normalizeUsername(usernameArg);

  const [stateRaw, activityRaw, ..._] = await Promise.all([
    getValue(STATE_KEY),
    getValue(ACTIVITY_KEY),
  ]);

  const state = stateRaw ? JSON.parse(stateRaw) : { users: {} };
  const activity = activityRaw ? JSON.parse(activityRaw) : { entries: [] };
  const userRows = findAllUserRows(state, username);
  const xUserId = findUserIdInState(state, username);

  let save = null;
  let audit = [];
  let replyKvCount = null;
  const replyDay = todayUtcDay();
  if (xUserId) {
    const saveRaw = await getValue(`${SAVE_PREFIX}${xUserId}`);
    if (saveRaw) save = JSON.parse(saveRaw);
    const auditRaw = await getValue(`${AUDIT_PREFIX}${xUserId}`);
    if (auditRaw) audit = JSON.parse(auditRaw);
    const replyRaw = await getValue(replyCountKey(xUserId, replyDay));
    replyKvCount = replyRaw != null ? Number.parseInt(replyRaw, 10) : 0;
  }

  const primaryUser = userRows.find((r) => r.xUserId === xUserId)?.user || userRows[0]?.user || null;

  const catches = (activity.entries || [])
    .filter((e) => e.xUsername?.toLowerCase() === username && e.status === "success")
    .map((e) => ({
      at: e.at,
      source: "x_catch_activity",
      spend: e.spend,
      caught: e.caughtCount,
      monballsLeft: e.monballsLeft,
      tweetId: e.tweetId,
      activityId: e.id,
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const auditLedger = reconcileAuditTrail(audit);
  const dailyLoginDay = save?.dailyLoginLastClaimAt
    ? getDailyLoginDayKeyFromTimestamp(save.dailyLoginLastClaimAt)
    : null;
  const unclaimedMail = (save?.mailbox || []).filter((m) => !m.claimedAt);
  const dailyLoginMail = unclaimedMail.filter((m) => m.title === "Daily Login Reward");
  const claimedDailyMail = (save?.mailbox || []).filter(
    (m) => m.title === "Daily Login Reward" && m.claimedAt
  );

  const report = {
    username,
    xUserId: xUserId || null,
    generatedAt: new Date().toISOString(),
    catchState: userRows.map(({ xUserId: id, user }) => ({
      xUserId: id,
      monballs: user.monballs,
      pendingMons: user.pendingMons?.length ?? 0,
      updatedAt: user.updatedAt,
      replyDay: user.replyDay || null,
      replyCount: user.replyCount ?? null,
    })),
    replyTracker: xUserId
      ? {
          dayUtc: replyDay,
          kvCount: Number.isFinite(replyKvCount) ? replyKvCount : 0,
          stateReplyDay: primaryUser?.replyDay || null,
          stateReplyCount: primaryUser?.replyCount ?? null,
          dailyLimit: 4,
          repliesLeftAfterNext: Math.max(0, 4 - (Number.isFinite(replyKvCount) ? replyKvCount : 0) - 1),
        }
      : null,
    cloudSave: save
      ? {
          monballs: save.monballs,
          dailyLoginLastClaimAt: save.dailyLoginLastClaimAt,
          dailyLoginDayKeyUtc8: dailyLoginDay,
          unclaimedMailbox: unclaimedMail.length,
          unclaimedDailyLoginMail: dailyLoginMail.length,
          claimedDailyLoginMail: claimedDailyMail.map((m) => ({
            id: m.id,
            amount: m.amount,
            createdAt: m.createdAt,
            claimedAt: m.claimedAt,
          })),
          updatedAt: save.updatedAt,
          revision: save.revision,
        }
      : null,
    catchHistory: catches,
    monballAudit: auditLedger,
    analysis: {
      totalCatchSpend: catches.reduce((sum, c) => sum + (c.spend || 0), 0),
      catchSessions: catches.length,
      auditEntries: auditLedger.length,
      likelyDailyLoginBetweenCatches:
        catches.length >= 2
        && catches.some((c) => c.monballsLeft === 0)
        && auditLedger.some((a) => a.source === "mailbox_claim" && a.delta === 5),
    },
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`MonBall audit — @${username}`);
  console.log("=".repeat(60));
  console.log(`xUserId: ${report.xUserId || "(not found)"}`);
  console.log("");
  console.log("Catch state rows:");
  for (const row of report.catchState) {
    console.log(`  ${row.xUserId}: ${row.monballs} monballs, pending=${row.pendingMons}, updated=${row.updatedAt}`);
    if (row.replyDay || row.replyCount != null) {
      console.log(`    legacy reply state: day=${row.replyDay || "(none)"} count=${row.replyCount ?? 0}`);
    }
  }
  if (report.replyTracker) {
    console.log("");
    console.log("Reply tracker (KV):");
    console.log(`  day (UTC): ${report.replyTracker.dayUtc}`);
    console.log(`  kvCount: ${report.replyTracker.kvCount}`);
    console.log(`  footer after next reply: ${report.replyTracker.repliesLeftAfterNext}/${report.replyTracker.dailyLimit} left`);
  }
  if (report.cloudSave) {
    console.log("");
    console.log("Cloud save:");
    console.log(`  monballs: ${report.cloudSave.monballs}`);
    console.log(`  dailyLoginLastClaimAt: ${report.cloudSave.dailyLoginLastClaimAt || "(never)"}`);
    console.log(`  daily login day (UTC+8): ${report.cloudSave.dailyLoginDayKeyUtc8 || "(n/a)"}`);
    console.log(`  unclaimed mailbox: ${report.cloudSave.unclaimedMailbox} (daily login mail: ${report.cloudSave.unclaimedDailyLoginMail})`);
    if (report.cloudSave.claimedDailyLoginMail.length) {
      console.log("  claimed daily login mail:");
      for (const m of report.cloudSave.claimedDailyLoginMail) {
        console.log(`    - ${m.claimedAt} (+${m.amount}) created ${m.createdAt}`);
      }
    }
  }
  console.log("");
  console.log(`Catch history (${catches.length} sessions):`);
  for (const c of catches.slice(0, 20)) {
    console.log(`  ${c.at}  spend=${c.spend}  caught=${c.caught}  left=${c.monballsLeft}  tweet=${c.tweetId || c.activityId}`);
  }
  console.log("");
  console.log(`MonBall audit log (${auditLedger.length} entries, newest first in KV):`);
  for (const a of audit.slice(0, 30)) {
    const before = a.balanceBefore ?? a.balanceAfter - a.delta;
    console.log(`  ${a.at}  ${a.source}  ${before} → ${a.balanceAfter} (${a.delta >= 0 ? "+" : ""}${a.delta})`);
  }
  console.log("");
  console.log("Analysis:");
  console.log(`  Total catch spend logged: ${report.analysis.totalCatchSpend}`);
  if (report.analysis.likelyDailyLoginBetweenCatches) {
    console.log("  ⚠ Pattern matches: catch to 0, then mailbox_claim +5, then another catch.");
    console.log("    This is expected if Daily Login mail was claimed between sessions.");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
