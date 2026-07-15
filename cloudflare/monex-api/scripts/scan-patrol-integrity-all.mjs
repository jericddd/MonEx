/**
 * Scan all production saves for patrol attempt / ledger mismatches.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyPatrolDailyResetOnSave, PATROL_DAILY_MAX } from "../src/lib/patrol-attempt.js";
import { sanitizeAccountBattleCompletions } from "../src/lib/battle-completion.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const toml = readFileSync(join(__dirname, "..", "wrangler.toml"), "utf8");
const block = toml.match(/\[\[kv_namespaces\]\][\s\S]*?(?=\n\[|\n\[\[|$)/);
const NAMESPACE_ID = process.env.MONEX_KV_NAMESPACE_ID || block?.[0]?.match(/^\s*id\s*=\s*"([^"]+)"/m)?.[1];
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

function apiUrl(path) {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}${path}`;
}
async function cfFetch(path) {
  const res = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${API_TOKEN}` } });
  const data = await res.json();
  if (!data.success) throw new Error(data.errors?.[0]?.message || "cf error");
  return data;
}
async function getValue(key) {
  const res = await fetch(apiUrl(`/values/${encodeURIComponent(key)}`), {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (res.status === 404) return null;
  return res.text();
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

function countPatrolLedger(completions) {
  return Object.keys(sanitizeAccountBattleCompletions(completions || {})).filter((id) =>
    id.startsWith("patrol:")
  ).length;
}

const keys = await listKeys("monex:save:");
const issues = [];
const highRevision = [];

for (const key of keys) {
  const raw = await getValue(key);
  if (!raw) continue;
  let save;
  try {
    save = JSON.parse(raw);
  } catch {
    continue;
  }
  const reset = applyPatrolDailyResetOnSave(save);
  const scansUsed = reset.patrolScansUsed || 0;
  const ledgerCount = countPatrolLedger(reset.accountBattleCompletions);
  const handle = save.xHandle || save.username || "?";
  const xUserId = key.slice("monex:save:".length);
  const rowIssues = [];
  if (scansUsed > ledgerCount) {
    rowIssues.push({ type: "attempts_without_ledger", delta: scansUsed - ledgerCount });
  }
  if (ledgerCount > scansUsed) {
    rowIssues.push({ type: "ledger_exceeds_attempts", delta: ledgerCount - scansUsed });
  }
  if (scansUsed > PATROL_DAILY_MAX) {
    rowIssues.push({ type: "over_daily_cap", scansUsed });
  }
  if (rowIssues.length) {
    issues.push({
      xUserId,
      handle,
      patrolScansDay: reset.patrolScansDay,
      scansUsed,
      ledgerCount,
      revision: save.revision,
      issues: rowIssues,
    });
  }
  if ((save.revision || 0) >= 1000) {
    highRevision.push({ xUserId, handle, revision: save.revision, scansUsed, ledgerCount });
  }
}

issues.sort((a, b) => (b.issues[0].delta || 0) - (a.issues[0].delta || 0));
highRevision.sort((a, b) => b.revision - a.revision);

console.log(
  JSON.stringify(
    {
      totalSaves: keys.length,
      affectedUsers: issues.length,
      attemptsWithoutLedger: issues.filter((u) =>
        u.issues.some((i) => i.type === "attempts_without_ledger")
      ).length,
      ledgerExceedsAttempts: issues.filter((u) =>
        u.issues.some((i) => i.type === "ledger_exceeds_attempts")
      ).length,
      louis: issues.find((u) => u.xUserId === "1493015343543070724") || null,
      topIssues: issues.slice(0, 25),
      highRevisionUsers: highRevision.slice(0, 10),
    },
    null,
    2
  )
);
