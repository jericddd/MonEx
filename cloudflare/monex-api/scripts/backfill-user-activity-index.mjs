/**
 * Backfill monex:activity-user:{xUserId} indexes from the global activity log.
 * Run once after deploying user-only profile catch log reads.
 *
 * Usage:
 *   node scripts/backfill-user-activity-index.mjs --dry-run
 *   node scripts/backfill-user-activity-index.mjs --dry-run trainer
 *   node scripts/backfill-user-activity-index.mjs trainer
 *   node scripts/backfill-user-activity-index.mjs --force trainer
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  userActivityIndexKey,
  loadUserActivityIndex,
  saveUserActivityIndex,
} from "../src/kv-store.js";
import {
  cleanPersonalLogUsername,
  filterUserSuccessfulCatchEntries,
} from "../src/lib/personal-catch-log.js";
import { findUserIdFromCatchUsernameIndex } from "./lib/resolve-production-user.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIVITY_KEY = "monex:activity";
const MAX_USER_ACTIVITY_INDEX = 250;

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
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const usernameFilter = process.argv.find(
  (arg) => arg && !arg.startsWith("-") && arg !== process.argv[1]
);

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

function makeRemoteKv() {
  return {
    async get(key) {
      return getValue(key);
    },
    async put(key, value) {
      if (dryRun) return;
      const res = await fetch(apiUrl(`/values/${encodeURIComponent(key)}`), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "text/plain",
        },
        body: value,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        const msg = data.errors?.map((e) => e.message).join("; ") || res.statusText;
        throw new Error(`Cloudflare API put ${key}: ${msg}`);
      }
    },
  };
}

function entryKey(entry) {
  if (entry?.tweetId) return `tweet:${String(entry.tweetId)}`;
  if (entry?.id) return `id:${String(entry.id)}`;
  return null;
}

function sortNewestFirst(entries) {
  return [...entries].sort((a, b) => Date.parse(b.at || "") - Date.parse(a.at || ""));
}

function mergeActivityEntries(existing, fromGlobal) {
  const merged = new Map();
  for (const entry of [...(existing || []), ...(fromGlobal || [])]) {
    const key = entryKey(entry);
    if (!key) continue;
    merged.set(key, entry);
  }
  return sortNewestFirst([...merged.values()]).slice(0, MAX_USER_ACTIVITY_INDEX);
}

function needsBackfill(existingEntries, globalEntries, forceRebuild) {
  if (forceRebuild) return true;
  const existing = existingEntries || [];
  if (!existing.length) return globalEntries.length > 0;
  if (globalEntries.length > existing.length) return true;
  const existingKeys = new Set(existing.map(entryKey).filter(Boolean));
  return globalEntries.some((entry) => {
    const key = entryKey(entry);
    return key && !existingKeys.has(key);
  });
}

requireEnv();

const activityRaw = await getValue(ACTIVITY_KEY);
const activity = activityRaw ? JSON.parse(activityRaw) : { entries: [] };
const globalEntries = activity.entries || [];

/** @type {Map<string, { username: string, entries: object[] }>} */
const grouped = new Map();
const uidCache = new Map();
const skippedNoUserId = [];

async function resolveXUserId(entry, username) {
  const direct = String(entry?.xUserId || "").trim();
  if (direct) return direct;
  const uname = cleanPersonalLogUsername(username);
  if (!uname) return null;
  if (uidCache.has(uname)) return uidCache.get(uname);
  const uid = await findUserIdFromCatchUsernameIndex(getValue, uname);
  uidCache.set(uname, uid);
  return uid;
}

for (const entry of globalEntries) {
  if (entry?.status !== "success" || !entry.xUsername) continue;
  const username = cleanPersonalLogUsername(entry.xUsername);
  if (usernameFilter && username !== usernameFilter.toLowerCase().replace(/^@/, "")) continue;

  const xUserId = await resolveXUserId(entry, username);
  if (!xUserId) {
    skippedNoUserId.push(username);
    continue;
  }

  if (!grouped.has(xUserId)) {
    grouped.set(xUserId, { username: entry.xUsername, entries: [] });
  }
  grouped.get(xUserId).entries.push(entry);
}

const kv = makeRemoteKv();
const report = {
  ok: true,
  dryRun,
  force,
  usersScanned: grouped.size,
  backfilled: 0,
  skippedUpToDate: 0,
  skippedNoUserId: [...new Set(skippedNoUserId)],
  details: [],
};

for (const [xUserId, group] of grouped) {
  const username = group.username;
  const chronological = filterUserSuccessfulCatchEntries(group.entries, username);
  const fromGlobal = sortNewestFirst(chronological);
  const existing = await loadUserActivityIndex(kv, xUserId);
  const existingEntries = existing.entries || [];

  if (!needsBackfill(existingEntries, fromGlobal, force)) {
    report.skippedUpToDate += 1;
    continue;
  }

  const merged = mergeActivityEntries(existingEntries, fromGlobal);
  if (!dryRun) {
    await saveUserActivityIndex(kv, xUserId, { entries: merged });
  }

  report.backfilled += 1;
  const row = {
    xUserId,
    username: cleanPersonalLogUsername(username),
    before: existingEntries.length,
    after: merged.length,
    globalMatches: fromGlobal.length,
  };
  report.details.push(row);
  console.log(
    `${dryRun ? "[dry-run] " : ""}@${row.username} (${xUserId}): ${row.before} -> ${row.after} entries`
  );
}

console.log(JSON.stringify(report, null, 2));
