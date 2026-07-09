/**
 * Grant Monballs to a user on production (catch API state + cloud save).
 *
 * Usage:
 *   node scripts/grant-monballs.mjs jericddd 100
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
const SESSION_PREFIX = "monex:session:";
const MONBALL_MAX = 9999;

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

function findUserIdInState(state, username) {
  for (const [xUserId, user] of Object.entries(state.users || {})) {
    if (user?.username?.toLowerCase() === username) return xUserId;
  }
  return null;
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

function clampMonballs(n) {
  return Math.max(0, Math.min(MONBALL_MAX, Math.floor(Number(n) || 0)));
}

async function grantCatchState(username, amount) {
  const raw = await getValue(STATE_KEY);
  const state = raw ? JSON.parse(raw) : { processedTweetIds: [], users: {} };
  if (!state.users) state.users = {};

  let xUserId = findUserIdInState(state, username);
  if (!xUserId) xUserId = await findUserIdFromSessions(username);
  if (!xUserId) xUserId = await findUserIdFromSaves(username);

  if (!xUserId) {
    return { updated: false, xUserId: null, before: null, after: null };
  }

  if (!state.users[xUserId]) {
    state.users[xUserId] = {
      username,
      monballs: clampMonballs(amount),
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    };
    await putValue(STATE_KEY, JSON.stringify(state));
    return { updated: true, xUserId, before: 0, after: clampMonballs(amount) };
  }

  const before = clampMonballs(state.users[xUserId].monballs ?? 0);
  const after = clampMonballs(before + amount);
  state.users[xUserId].monballs = after;
  state.users[xUserId].username = username;
  state.users[xUserId].updatedAt = new Date().toISOString();
  await putValue(STATE_KEY, JSON.stringify(state));
  return { updated: true, xUserId, before, after };
}

async function grantCloudSave(xUserId, username, amount) {
  if (!xUserId) return { updated: false, before: null, after: null };

  const key = `${SAVE_PREFIX}${xUserId}`;
  const raw = await getValue(key);
  const save = raw ? JSON.parse(raw) : {
    party: [],
    box: [],
    monballs: 10,
    money: 5000,
    essence: 0,
    monShards: 0,
    trainerXp: 0,
    xHandle: username,
  };

  const before = clampMonballs(save.monballs ?? 0);
  const after = clampMonballs(before + amount);
  save.monballs = after;
  save.xHandle = save.xHandle || username;
  save.updatedAt = new Date().toISOString();
  await putValue(key, JSON.stringify(save));
  return { updated: true, before, after };
}

async function main() {
  requireEnv();
  const username = normalizeUsername(process.argv[2]);
  const amount = clampMonballs(process.argv[3] ?? "100");
  if (!username) {
    console.error("Usage: node scripts/grant-monballs.mjs <x_username> [amount]");
    process.exit(1);
  }
  if (!amount) {
    console.error("Amount must be a positive number");
    process.exit(1);
  }

  const catchState = await grantCatchState(username, amount);
  const cloudSave = await grantCloudSave(catchState.xUserId, username, amount);

  if (!catchState.xUserId && !cloudSave.updated) {
    throw new Error(`User @${username} not found in KV (no state, session, or save)`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      username,
      amount,
      xUserId: catchState.xUserId,
      catchApi: catchState,
      cloudSave,
      message: `Granted ${amount} Monballs to @${username}.`,
    })
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
