/**
 * Audit and repair patrol reward / attempt mismatches.
 *
 * Usage:
 *   node scripts/reconcile-patrol-progress.mjs --username louisM33726154 --dry-run
 *   node scripts/reconcile-patrol-progress.mjs --username louisM33726154 --confirm REPAIR
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  sanitizeAccountBattleCompletions,
  isLegacyPatrolScanCompletionId,
  isPatrolTokenCompletionId,
} from "../src/lib/battle-completion.js";
import { computePatrolReward, claimBattleReward } from "../src/lib/battle-reward.js";
import { applyPatrolDailyResetOnSave, PATROL_DAILY_MAX } from "../src/lib/patrol-attempt.js";
import { loadCloudSave, writeCloudSave } from "../src/lib/save.js";
import {
  resolveProductionUser,
  normalizeUsername,
  countActivityForUsername,
  findSimilarCatchUsernames,
} from "./lib/resolve-production-user.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIVITY_KEY = "monex:activity";
const REPAIR_PREFIX = "monex:patrol-repair:";

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

function requireEnv() {
  if (!API_TOKEN) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  if (!ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
}

function apiUrl(path) {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}${path}`;
}

async function cfFetch(path, options = {}) {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = data.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Cloudflare API ${path}: ${msg}`);
  }
  return data;
}

async function getValue(key) {
  const data = await cfFetch(`/values/${encodeURIComponent(key)}`);
  return data.result ?? null;
}

async function putValue(key, value) {
  await cfFetch(`/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: value,
  });
}

async function listKeys(prefix) {
  const keys = [];
  let cursor;
  do {
    const params = new URLSearchParams({ limit: "1000" });
    if (prefix) params.set("prefix", prefix);
    if (cursor) params.set("cursor", cursor);
    const data = await cfFetch(`/keys?${params}`);
    keys.push(...(data.result || []).map((k) => k.name));
    cursor = data.result_info?.cursor;
  } while (cursor);
  return keys;
}

function makeKvApi() {
  return {
    async get(key) {
      return getValue(key);
    },
    async put(key, value) {
      await putValue(key, value);
    },
  };
}

function parseArgs(argv) {
  const args = { dryRun: true, confirm: "", username: "" };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--confirm") args.confirm = argv[++i] || "";
    else if (arg === "--username") args.username = argv[++i] || "";
    else if (!arg.startsWith("-") && !args.username) args.username = arg;
  }
  if (args.confirm === "REPAIR") args.dryRun = false;
  return args;
}

function listPatrolCompletions(completions) {
  const rows = [];
  for (const [id, entry] of Object.entries(sanitizeAccountBattleCompletions(completions))) {
    if (!id.startsWith("patrol:")) continue;
    rows.push({
      id,
      at: entry.at,
      reward: entry.reward,
      hasReward: (entry.reward?.gold || 0) > 0 || (entry.reward?.essence || 0) > 0,
    });
  }
  return rows.sort((a, b) => Date.parse(a.at || "") - Date.parse(b.at || ""));
}

function evaluatePatrolIntegrity(save) {
  const reset = applyPatrolDailyResetOnSave(save);
  const patrolCompletions = listPatrolCompletions(reset.accountBattleCompletions);
  const winsWithReward = patrolCompletions.filter((row) => row.hasReward);
  const lossesOrEmpty = patrolCompletions.filter((row) => !row.hasReward);
  const ledgerCount = patrolCompletions.length;
  const scansUsed = reset.patrolScansUsed || 0;

  const issues = [];
  if (scansUsed > ledgerCount) {
    issues.push({
      type: "attempts_without_ledger",
      scansUsed,
      ledgerCount,
      missingRecords: scansUsed - ledgerCount,
    });
  }

  const missingRewardCandidates = [];
  for (const row of patrolCompletions) {
    if (row.hasReward) continue;
    if (isPatrolTokenCompletionId(row.id)) {
      missingRewardCandidates.push({
        completionId: row.id,
        reason: "ledger_loss_or_zero_reward",
        repairable: false,
      });
      continue;
    }
    if (isLegacyPatrolScanCompletionId(row.id)) {
      const match = row.id.match(/^patrol:day-[^:]+:scan-\d+:(.+)$/);
      const encounterId = match?.[1] || "common";
      missingRewardCandidates.push({
        completionId: row.id,
        encounterId,
        reason: "legacy_win_missing_reward_unknown",
        repairable: false,
      });
    }
  }

  for (const row of winsWithReward) {
    if (!row.reward) continue;
  }

  return {
    patrolScansDay: reset.patrolScansDay,
    patrolScansUsed: scansUsed,
    patrolScansRemaining: Math.max(0, PATROL_DAILY_MAX - scansUsed),
    ledgerCount,
    winsWithReward: winsWithReward.length,
    lossesRecorded: lossesOrEmpty.length,
    issues,
    missingRewardCandidates,
    patrolCompletions,
  };
}

async function repairMissingPatrolReward(kv, session, save, completionId, encounterId) {
  const repairKey = `${REPAIR_PREFIX}${session.xUserId}:${completionId}`;
  const prior = await kv.get(repairKey);
  if (prior) {
    return { ok: false, alreadyRepaired: true, reason: "repair_receipt_exists" };
  }

  const ledger = sanitizeAccountBattleCompletions(save.accountBattleCompletions);
  if (ledger[completionId]?.reward?.gold > 0) {
    return { ok: false, reason: "reward_already_present" };
  }

  const preview = computePatrolReward(save, encounterId);
  const moneyBefore = Number(save.money) || 0;
  const result = await claimBattleReward(kv, session, {
    mode: "patrol",
    win: true,
    encounterId,
    claimId: completionId,
    expectedRevision: save.revision,
  });

  if (!result.ok) {
    return { ok: false, reason: result.error || "claim_failed", result };
  }

  await kv.put(repairKey, JSON.stringify({
    at: new Date().toISOString(),
    completionId,
    encounterId,
    moneyBefore,
    moneyAfter: result.save?.money,
  }));

  return { ok: true, result, expectedReward: preview.reward };
}

async function main() {
  requireEnv();
  const args = parseArgs(process.argv);
  if (!args.username) throw new Error("username required");

  const kv = makeKvApi();
  const normalized = normalizeUsername(args.username);
  const activityRaw = await getValue(ACTIVITY_KEY);
  let activityEntries = [];
  try {
    activityEntries = activityRaw ? JSON.parse(activityRaw).entries || [] : [];
  } catch {
    activityEntries = [];
  }

  const user = await resolveProductionUser(getValue, listKeys, args.username, activityEntries);
  if (!user?.xUserId) {
    const similar = await findSimilarCatchUsernames(listKeys, args.username);
    const activityMatches = countActivityForUsername(activityEntries, args.username);
    console.log(JSON.stringify({
      ok: false,
      error: "user_not_found",
      username: args.username,
      normalizedUsername: normalized,
      activityCatchEntries: activityMatches,
      similarCatchUsernames: similar,
    }, null, 2));
    return;
  }

  const session = { xUserId: user.xUserId, username: user.save?.xHandle || args.username };
  const { save } = await loadCloudSave(kv, user.xUserId);
  const evaluation = evaluatePatrolIntegrity(save);

  const report = {
    ok: true,
    username: args.username,
    normalizedUsername: normalized,
    xUserId: user.xUserId,
    resolvedVia: user.resolvedVia || [],
    dryRun: args.dryRun,
    evaluation,
    revision: save.revision,
    money: save.money,
  };

  if (args.dryRun || args.confirm !== "REPAIR") {
    console.log(JSON.stringify(report, null, 2));
    if (!args.dryRun && args.confirm !== "REPAIR") {
      console.error("Pass --confirm REPAIR to apply repairs (or use --dry-run)");
    }
    return;
  }

  report.repairs = [];
  for (const issue of evaluation.issues) {
    if (issue.type !== "attempts_without_ledger") continue;
    report.repairs.push({
      issue,
      action: "manual_review_required",
      note: "No server-side patrol token exists for unattributed attempts. Cannot safely auto-grant.",
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
