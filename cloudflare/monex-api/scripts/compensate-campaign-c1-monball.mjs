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
import { cleanUsername } from "../src/lib/backfill-pending.js";
import {
  evaluateCampaignC1Compensation,
  compensateCampaignC1Monball,
} from "../src/lib/quest-compensation.js";
import { validateAndSanitizeSave } from "../src/lib/save-validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAVE_PREFIX = "monex:save:";
const SESSION_PREFIX = "monex:session:";
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

async function findUserIdFromSessions(username) {
  const keys = await listKeys(SESSION_PREFIX);
  for (const key of keys) {
    const raw = await getValue(key);
    if (!raw) continue;
    try {
      const session = JSON.parse(raw);
      if (session?.username?.toLowerCase() === username && session?.xUserId) {
        return session.xUserId;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

async function findUserIdFromSaves(username) {
  const keys = await listKeys(SAVE_PREFIX);
  for (const key of keys) {
    const raw = await getValue(key);
    if (!raw) continue;
    try {
      const save = JSON.parse(raw);
      const handle = String(save?.xHandle || "").toLowerCase().replace(/^@/, "");
      if (handle === username) return key.slice(SAVE_PREFIX.length);
    } catch {
      /* skip */
    }
  }
  return null;
}

async function resolveUser(username) {
  const xUserId = (await findUserIdFromSessions(username)) || (await findUserIdFromSaves(username));
  if (!xUserId) return null;
  const saveRaw = await getValue(`${SAVE_PREFIX}${xUserId}`);
  const save = saveRaw
    ? validateAndSanitizeSave(JSON.parse(saveRaw), { username })
    : validateAndSanitizeSave({}, { username });
  return { xUserId, username, save };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const usernameArg = args.find((arg) => !arg.startsWith("--")) || "";
  const username = cleanUsername(usernameArg);
  return { dryRun, username };
}

async function main() {
  requireEnv();
  const { dryRun, username } = parseArgs(process.argv);
  if (!username) {
    console.error("Usage: node scripts/compensate-campaign-c1-monball.mjs [--dry-run] <x_username>");
    process.exit(1);
  }

  const user = await resolveUser(username);
  if (!user) {
    throw new Error(`User @${username} not found in production KV`);
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
