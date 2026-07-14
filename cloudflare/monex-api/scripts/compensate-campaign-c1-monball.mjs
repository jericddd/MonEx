/**
 * Compensate missing Chapter 1 Stage 10 campaign monballs for one user.
 *
 * Usage:
 *   node scripts/compensate-campaign-c1-monball.mjs --dry-run username
 *   node scripts/compensate-campaign-c1-monball.mjs username
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateAndSanitizeSave } from "../src/lib/save-validate.js";
import { resolveProductionUser, normalizeUsername } from "./lib/resolve-production-user.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

async function resolveUser(usernameArg, activityEntries = []) {
  const resolved = await resolveProductionUser(getValue, listKeys, usernameArg, activityEntries);
  if (!resolved?.xUserId) return null;
  const save = resolved.save
    ? validateAndSanitizeSave(resolved.save, { username: resolved.username })
    : validateAndSanitizeSave({}, { username: resolved.username });
  return {
    xUserId: resolved.xUserId,
    username: resolved.username,
    save,
    resolvedVia: resolved.resolvedVia,
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const usernameArg = args.find((arg) => !arg.startsWith("--")) || "";
  return { dryRun, usernameArg };
}

async function main() {
  requireEnv();
  const { dryRun, usernameArg } = parseArgs(process.argv);
  if (!usernameArg) {
    console.error("Usage: node scripts/compensate-campaign-c1-monball.mjs [--dry-run] <x_username>");
    process.exit(1);
  }

  const activityRaw = await getValue(ACTIVITY_KEY);
  const activityEntries = activityRaw ? JSON.parse(activityRaw).entries || [] : [];
  const user = await resolveUser(usernameArg, activityEntries);
  if (!user) {
    throw new Error(
      `User @${normalizeUsername(usernameArg)} not found in production KV (tried catch-username index, cloud save, session, activity log)`
    );
  }

  const evaluation = evaluateCampaignC1Compensation(user.save);
  const kv = makeKvAdapter();
  const session = { xUserId: user.xUserId, username: user.username };
  const result = await compensateCampaignC1Monball(kv, session, user.save, 10, { dryRun });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        dryRun,
        username: user.username,
        xUserId: user.xUserId,
        resolvedVia: user.resolvedVia,
        evaluation,
        applied: result.applied,
        reason: result.reason,
        monballsBefore: user.save.monballs,
        monballsAfter: result.save?.monballs ?? user.save.monballs,
        compensationRecord: result.save?.accountCompensationsApplied || user.save.accountCompensationsApplied || {},
      },
      null,
      2
    )
  );

  if (!evaluation.eligible && !dryRun) {
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
