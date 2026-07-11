/**
 * Recover X catches from activity log into cloud save when pending queue is empty.
 *
 * Usage:
 *   node scripts/recover-activity-catches.mjs Lucci_Crypto
 *   node scripts/recover-activity-catches.mjs --dry-run Lucci_Crypto
 *   node scripts/recover-activity-catches.mjs --dry-run --spend 18 Lucci_Crypto
 *   node scripts/recover-activity-catches.mjs --activity-id act_xxx Lucci_Crypto
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanUsername } from "../src/lib/backfill-pending.js";
import { recoverActivityCatchesForUser } from "../src/lib/recover-activity-catches.js";
import { resolveCatchUser } from "../src/kv-store.js";

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
  const res = await fetch(apiUrl(`/values/${encodeURIComponent(key)}`), {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to read ${key}: ${res.statusText}`);
  return res.text();
}

async function putValue(key, value) {
  await cfFetch(`/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
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

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let spend = null;
  let activityId = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") continue;
    if (arg === "--spend" && args[i + 1]) {
      spend = parseInt(args[++i], 10);
      continue;
    }
    if (arg === "--activity-id" && args[i + 1]) {
      activityId = args[++i];
      continue;
    }
    if (!arg.startsWith("--")) positional.push(arg);
  }
  const username = cleanUsername(positional[0] || "");
  return { dryRun, username, spend, activityId };
}

async function buildSaveIndex() {
  const exact = new Map();
  const byLower = new Map();
  const keys = await listKeys(SAVE_PREFIX);
  for (const key of keys) {
    const raw = await getValue(key);
    if (!raw) continue;
    try {
      const save = JSON.parse(raw);
      const handle = cleanUsername(save?.xHandle);
      const xUserId = key.slice(SAVE_PREFIX.length);
      if (!handle) continue;
      const entry = { xUserId, save, handle };
      if (!exact.has(handle)) exact.set(handle, []);
      exact.get(handle).push(entry);
      const lower = handle.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, []);
      byLower.get(lower).push(entry);
    } catch {
      /* skip */
    }
  }
  return { exact, byLower };
}

function pickCloudSaveTarget(username, preferredUserId, saveIndex) {
  const handle = cleanUsername(username);
  let candidates = [];

  if (preferredUserId) {
    for (const list of [saveIndex.exact.values(), saveIndex.byLower.values()]) {
      for (const group of list) {
        const hit = group.find((c) => c.xUserId === preferredUserId);
        if (hit) return hit;
      }
    }
  }

  candidates = saveIndex.exact.get(handle) || [];
  if (!candidates.length) {
    candidates = saveIndex.byLower.get(handle.toLowerCase()) || [];
  }
  if (!candidates.length) return null;

  const nonSim = candidates.find((c) => !String(c.xUserId).startsWith("sim_"));
  return nonSim || candidates[0];
}

function getCatchMonballs(state, xUserId, username, startingMonballs) {
  const user = resolveCatchUser(state, xUserId, username, startingMonballs);
  return user?.monballs ?? null;
}

async function main() {
  requireEnv();
  const { dryRun, username, spend, activityId } = parseArgs(process.argv);
  if (!username) {
    console.error(
      "Usage: node scripts/recover-activity-catches.mjs [--dry-run] [--spend N] [--activity-id ID] <x_username>"
    );
    process.exit(1);
  }

  const recoveryFilter = { spend: Number.isFinite(spend) && spend > 0 ? spend : null, activityId };

  const startingMonballs = parseInt(process.env.STARTING_MONBALLS || "10", 10) || 10;
  const activityRaw = await getValue(ACTIVITY_KEY);
  const activity = activityRaw ? JSON.parse(activityRaw) : { entries: [] };
  const entries = Array.isArray(activity.entries) ? activity.entries : [];

  const stateRaw = await getValue(STATE_KEY);
  const state = stateRaw ? JSON.parse(stateRaw) : { processedTweetIds: [], users: {} };

  const preview = recoverActivityCatchesForUser({
    username,
    activityEntries: entries,
    save: { party: [], box: [], monballs: startingMonballs, xHandle: username },
    caseSensitive: true,
    ...recoveryFilter,
  });

  const saveIndex = await buildSaveIndex();
  const cloud = pickCloudSaveTarget(username, preview.xUserId, saveIndex);
  if (!cloud) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          dryRun,
          username,
          error: "cloud_save_not_found",
          activityMatches: preview.activityMatches,
          recoverableCount: preview.recoverableCount,
          xUserId: preview.xUserId,
          activities: preview.activities,
          message:
            "Activity log entries found but no cloud save exists yet. User must log into the game once, then rerun recovery.",
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const catchMonballs = getCatchMonballs(state, cloud.xUserId, username, startingMonballs);
  const result = recoverActivityCatchesForUser({
    username,
    activityEntries: entries,
    save: cloud.save,
    catchMonballs,
    caseSensitive: true,
    ...recoveryFilter,
  });

  if (!dryRun && result.added.length > 0) {
    await putValue(`${SAVE_PREFIX}${cloud.xUserId}`, JSON.stringify(result.save));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        username,
        saveUserId: cloud.xUserId,
        spendFilter: recoveryFilter.spend,
        activityIdFilter: recoveryFilter.activityId,
        activityMatches: result.activityMatches,
        recoverableCount: result.recoverableCount,
        addedCount: result.added.length,
        added: result.added,
        skipped: result.skipped,
        monballs: result.monballs,
        activities: result.activities,
        status: dryRun ? "dry_run" : result.added.length ? "recovered" : "nothing_to_add",
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
