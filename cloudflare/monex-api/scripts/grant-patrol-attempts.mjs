/**
 * Grant extra patrol attempts for today by reducing patrolScansUsed on cloud save.
 *
 * Usage:
 *   node scripts/grant-patrol-attempts.mjs lucci_crypto 10
 *   node scripts/grant-patrol-attempts.mjs --dry-run lucci_crypto 10
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { grantPatrolAttemptsOnSave } from "../src/lib/patrol-attempt.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "../src/lib/save.js";
import { resolveProductionUser, normalizeUsername } from "./lib/resolve-production-user.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACTIVITY_KEY = "monex:activity";
const GRANT_PREFIX = "monex:patrol-grant:";

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
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const usernameArg = positional[0] || "";
  const amount = Math.max(0, Math.floor(Number(positional[1]) || 0));
  return { dryRun, usernameArg, amount };
}

async function main() {
  requireEnv();
  const { dryRun, usernameArg, amount } = parseArgs(process.argv);
  if (!usernameArg || !amount) {
    console.error("Usage: node scripts/grant-patrol-attempts.mjs [--dry-run] <x_username> <attempts>");
    process.exit(1);
  }

  const activityRaw = await getValue(ACTIVITY_KEY);
  let activityEntries = [];
  try {
    activityEntries = activityRaw ? JSON.parse(activityRaw).entries || [] : [];
  } catch {
    activityEntries = [];
  }

  const user = await resolveProductionUser(getValue, listKeys, usernameArg, activityEntries);
  if (!user?.xUserId) {
    throw new Error(
      `User @${normalizeUsername(usernameArg)} not found in production KV (tried catch-username index, cloud save, session, activity log)`
    );
  }

  const kv = makeKvAdapter();
  const session = { xUserId: user.xUserId, username: user.save?.xHandle || usernameArg };
  const { save } = await loadCloudSave(kv, user.xUserId);
  const grant = grantPatrolAttemptsOnSave(save, amount);
  const grantId = `${GRANT_PREFIX}${user.xUserId}:${Date.now()}`;

  const report = {
    ok: true,
    dryRun,
    username: user.username || normalizeUsername(usernameArg),
    xUserId: user.xUserId,
    resolvedVia: user.resolvedVia || [],
    requested: grant.requested,
    granted: grant.granted,
    patrolScansDay: grant.save.patrolScansDay,
    before: {
      patrolScansUsed: grant.beforeUsed,
      patrolScansRemaining: grant.beforeRemaining,
    },
    after: {
      patrolScansUsed: grant.afterUsed,
      patrolScansRemaining: grant.afterRemaining,
    },
    patrolDailyMax: grant.patrolDailyMax,
    revision: save.revision,
  };

  if (!dryRun && grant.granted > 0) {
    const now = Date.now();
    const payload = buildSavePayload(
      {
        ...grant.save,
        updatedAt: new Date(now).toISOString(),
      },
      session,
      { now }
    );
    const written = await writeCloudSave(kv, user.xUserId, payload, { skipStaleCheck: true });
    report.revision = written.revision;
    report.applied = true;
    await putValue(
      grantId,
      JSON.stringify({
        at: new Date(now).toISOString(),
        username: report.username,
        xUserId: user.xUserId,
        reason: "patrol_bug_compensation",
        requested: grant.requested,
        granted: grant.granted,
        beforeUsed: grant.beforeUsed,
        afterUsed: grant.afterUsed,
      })
    );
    report.grantReceiptKey = grantId;
  } else if (!dryRun && grant.granted === 0) {
    report.applied = false;
    report.note = "No patrol attempts to grant (user already at daily max remaining).";
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
