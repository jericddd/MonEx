/**
 * One-time backfill: push stuck X catch pending mons into cloud saves (Party/Box)
 * and align in-game Monballs with catch-state balances from before the sync fix.
 *
 * Usage:
 *   node scripts/backfill-pending-catches.mjs
 *   node scripts/backfill-pending-catches.mjs jericddd
 *   node scripts/backfill-pending-catches.mjs --dry-run
 *   node scripts/backfill-pending-catches.mjs --dry-run jericddd
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  collectPendingUsers,
  pickCanonicalCatchUserId,
  backfillPendingForUser,
} from "../src/lib/backfill-pending.js";
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

function normalizeUsername(username) {
  return String(username || "").toLowerCase().replace(/^@/, "").trim();
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const username = normalizeUsername(args.find((a) => !a.startsWith("--")) || "");
  return { dryRun, username };
}

async function buildSaveIndex() {
  const index = new Map();
  const keys = await listKeys(SAVE_PREFIX);
  for (const key of keys) {
    const raw = await getValue(key);
    if (!raw) continue;
    try {
      const save = JSON.parse(raw);
      const handle = normalizeUsername(save?.xHandle);
      const xUserId = key.slice(SAVE_PREFIX.length);
      if (!handle) continue;
      if (!index.has(handle)) index.set(handle, []);
      index.get(handle).push({ xUserId, save });
    } catch {
      /* skip */
    }
  }
  return index;
}

function pickCloudSaveTarget(username, catchUserId, saveIndex) {
  const candidates = saveIndex.get(username) || [];
  if (!candidates.length) return null;

  const exact = candidates.find((c) => c.xUserId === catchUserId);
  if (exact) return exact;

  const nonSim = candidates.find((c) => !String(c.xUserId).startsWith("sim_"));
  return nonSim || candidates[0];
}

async function main() {
  requireEnv();
  const { dryRun, username: onlyUsername } = parseArgs(process.argv);
  const startingMonballs = parseInt(process.env.STARTING_MONBALLS || "10", 10) || 10;

  const stateRaw = await getValue(STATE_KEY);
  const loadedState = stateRaw ? JSON.parse(stateRaw) : { processedTweetIds: [], users: {} };
  if (!loadedState.users) loadedState.users = {};
  const state = dryRun ? structuredClone(loadedState) : loadedState;

  const groups = collectPendingUsers(state);
  const saveIndex = await buildSaveIndex();
  const results = [];

  for (const [username, entries] of groups) {
    if (onlyUsername && username !== onlyUsername) continue;

    const catchUserId = pickCanonicalCatchUserId(entries);
    const pendingTotal = entries.reduce((sum, e) => sum + (e.pendingCount || 0), 0);
    const cloud = pickCloudSaveTarget(username, catchUserId, saveIndex);

    if (!cloud) {
      resolveCatchUser(state, catchUserId, username, startingMonballs);
      results.push({
        username,
        catchUserId,
        pendingBefore: pendingTotal,
        status: "merged_catch_state_only",
        message: "No cloud save found; catch rows merged for next in-game sync.",
      });
      continue;
    }

    const outcome = backfillPendingForUser(state, {
      xUserId: cloud.xUserId,
      username,
      save: cloud.save,
      startingMonballs,
    });

    if (!outcome.ok) {
      results.push({
        username,
        catchUserId,
        saveUserId: cloud.xUserId,
        pendingBefore: pendingTotal,
        status: "skipped",
        reason: outcome.reason,
      });
      continue;
    }

    if (!dryRun) {
      await putValue(`${SAVE_PREFIX}${cloud.xUserId}`, JSON.stringify(outcome.save));
    }

    results.push({
      username,
      catchUserId,
      saveUserId: cloud.xUserId,
      pendingBefore: outcome.pendingBefore,
      addedParty: outcome.addedParty,
      addedBox: outcome.addedBox,
      added: outcome.added,
      remaining: outcome.remaining,
      monballs: outcome.monballs,
      status: dryRun ? "dry_run" : "backfilled",
    });
  }

  const wroteState =
    !dryRun
    && results.some((r) => r.status === "backfilled" || r.status === "merged_catch_state_only");
  if (wroteState) {
    await putValue(STATE_KEY, JSON.stringify(state));
  }

  const summary = {
    ok: true,
    dryRun,
    filter: onlyUsername || null,
    usersScanned: results.length,
    backfilled: results.filter((r) => r.status === "backfilled").length,
    dryRunUsers: results.filter((r) => r.status === "dry_run").length,
    catchOnlyMerged: results.filter((r) => r.status === "merged_catch_state_only").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    totalMonsAdded: results.reduce((sum, r) => sum + (r.added || 0), 0),
    results,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
