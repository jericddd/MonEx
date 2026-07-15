/**
 * Backfill durable personal catch log refs for existing players.
 *
 * Usage:
 *   node scripts/backfill-personal-catch-log-refs.mjs --dry-run
 *   node scripts/backfill-personal-catch-log-refs.mjs --dry-run trainer
 *   node scripts/backfill-personal-catch-log-refs.mjs trainer
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  filterUserSuccessfulCatchEntries,
  savePersonalCatchLogRef,
  buildPersonalCatchLogRef,
  personalCatchLogRefKey,
} from "../src/lib/personal-catch-log.js";
import { loadCatchReceipt } from "../src/lib/catch-receipt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIVITY_KEY = "monex:activity";
const CATCH_USER_PREFIX = "monex:catch-user:";

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
const usernameFilter = process.argv.find((arg) => arg && !arg.startsWith("-") && arg !== process.argv[1]);

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

async function putValue(key, value) {
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
}

function makeRemoteKv() {
  return {
    async get(key) {
      return getValue(key);
    },
    async put(key, value) {
      if (dryRun) return;
      await putValue(key, value);
    },
  };
}

requireEnv();

const activityRaw = await getValue(ACTIVITY_KEY);
const activity = activityRaw ? JSON.parse(activityRaw) : { entries: [] };
const entries = activity.entries || [];

const users = new Map();
for (const entry of entries) {
  if (entry?.status !== "success" || !entry.xUsername) continue;
  const uname = String(entry.xUsername).toLowerCase().replace("@", "");
  if (usernameFilter && uname !== usernameFilter.toLowerCase().replace("@", "")) continue;
  if (!users.has(uname)) users.set(uname, []);
  users.get(uname).push(entry);
}

const kv = makeRemoteKv();
let written = 0;

for (const [uname, rows] of users) {
  const chronological = filterUserSuccessfulCatchEntries(rows, uname);
  const xUserId = entryXUserId(chronological[0]);
  if (!xUserId) {
    console.warn(`skip ${uname}: no xUserId on activity rows`);
    continue;
  }

  for (let i = 0; i < chronological.length; i++) {
    const logNumber = i + 1;
    const entry = chronological[i];
    const existingRef = await kv.get(personalCatchLogRefKey(xUserId, logNumber));
    if (existingRef) continue;

    const receipt = entry.tweetId
      ? await loadCatchReceipt({ get: (k) => getValue(k) }, entry.tweetId)
      : null;

    const ref = buildPersonalCatchLogRef({
      logNumber,
      xUserId,
      username: entry.xUsername,
      tweetId: entry.tweetId,
      activityId: entry.id,
      catchId: receipt?.catchId || (entry.tweetId ? `catch_${entry.tweetId}` : ""),
      at: entry.at,
      activity: entry,
      receipt: receipt || {},
    });

    if (!dryRun) {
      await savePersonalCatchLogRef(kv, xUserId, ref);
    }
    written += 1;
    console.log(`${dryRun ? "[dry-run] " : ""}${uname} log #${logNumber} -> tweet ${entry.tweetId || "?"}`);
  }

  if (!dryRun && chronological.length > 0) {
    const catchUserRaw = await getValue(`${CATCH_USER_PREFIX}${xUserId}`);
    if (catchUserRaw) {
      const catchUser = JSON.parse(catchUserRaw);
      catchUser.personalCatchLogSeq = Math.max(
        Number(catchUser.personalCatchLogSeq) || 0,
        chronological.length
      );
      await putValue(`${CATCH_USER_PREFIX}${xUserId}`, JSON.stringify(catchUser));
    }
  }
}

function entryXUserId(entry) {
  return String(entry?.xUserId || "").trim() || null;
}

console.log(JSON.stringify({ ok: true, dryRun, users: users.size, refsWritten: written }, null, 2));
