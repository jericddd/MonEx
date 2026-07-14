/**
 * Audit and repair catch-log vs in-game inventory mismatches.
 *
 * Usage:
 *   node scripts/reconcile-catch-sync.mjs --dry-run
 *   node scripts/reconcile-catch-sync.mjs --dry-run username
 *   node scripts/reconcile-catch-sync.mjs username
 *   node scripts/reconcile-catch-sync.mjs --all-users
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanUsername } from "../src/lib/backfill-pending.js";
import { auditCatchSyncForUser, repairCatchSyncForUser } from "../src/lib/catch-reconcile.js";
import { validateAndSanitizeSave } from "../src/lib/save-validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAVE_PREFIX = "monex:save:";
const ACTIVITY_KEY = "monex:activity";

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

async function listKeys(prefix) {
  const keys = [];
  let cursor;
  do {
    const params = new URLSearchParams({ limit: "1000" });
    if (prefix) params.set("prefix", prefix);
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(apiUrl(`/keys?${params}`), {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(`Cloudflare API list keys: ${res.statusText}`);
    }
    keys.push(...(data.result || []).map((k) => k.name));
    cursor = data.result_info?.cursor;
  } while (cursor);
  return keys;
}

function makeKvAdapter() {
  return {
    async get(key) {
      return getValue(key);
    },
    async put(key, value) {
      await putValue(key, value);
    },
    async list(opts = {}) {
      const names = await listKeys(opts.prefix || "");
      return { keys: names.map((name) => ({ name })), list_complete: true };
    },
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allUsers = args.includes("--all-users");
  const usernameArg = args.find((arg) => !arg.startsWith("--")) || "";
  const username = cleanUsername(usernameArg);
  return { dryRun, allUsers, username };
}

async function loadActivityEntries() {
  const raw = await getValue(ACTIVITY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw).entries || [];
  } catch {
    return [];
  }
}

async function main() {
  requireEnv();
  const { dryRun, allUsers, username } = parseArgs(process.argv);
  if (!username && !allUsers) {
    console.error("Usage: node scripts/reconcile-catch-sync.mjs [--dry-run] [--all-users | username]");
    process.exit(1);
  }

  const activityEntries = await loadActivityEntries();
  const saveKeys = await listKeys(SAVE_PREFIX);
  const kv = makeKvAdapter();
  const report = {
    ok: true,
    dryRun,
    scanned: 0,
    mismatchesBefore: 0,
    mismatchesAfter: 0,
    repairedTotal: 0,
    users: [],
  };

  for (const key of saveKeys) {
    const raw = await getValue(key);
    if (!raw) continue;
    let save;
    try {
      save = validateAndSanitizeSave(JSON.parse(raw));
    } catch {
      continue;
    }
    const handle = cleanUsername(save.xHandle || "");
    if (!handle) continue;
    if (username && handle.toLowerCase() !== username.toLowerCase()) continue;

    const xUserId = key.slice(SAVE_PREFIX.length);
    report.scanned += 1;

    const catchRaw = await getValue(`monex:catch-user:${xUserId}`);
    const catchUser = catchRaw ? JSON.parse(catchRaw) : { pendingMons: [] };

    const before = auditCatchSyncForUser({
      username: handle,
      save,
      catchUser,
      activityEntries,
    });
    report.mismatchesBefore += before.issueCount;

    const result = await repairCatchSyncForUser(kv, xUserId, handle, 10, {
      activityEntries,
      dryRun,
    });

    report.mismatchesAfter += result.after.issueCount;
    report.repairedTotal += result.repaired || 0;
    report.users.push({
      username: handle,
      xUserId,
      issuesBefore: before.issueCount,
      issuesAfter: result.after.issueCount,
      repaired: result.repaired || 0,
      issueTypesBefore: before.issues.map((i) => i.type),
      issueTypesAfter: result.after.issues.map((i) => i.type),
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
