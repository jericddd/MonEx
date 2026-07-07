/**
 * Wipe all MonEx production KV data (cloud saves, X log, sessions, pending catches).
 * Uses Cloudflare API — only needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 *
 * Usage: node scripts/reset-production-kv.mjs
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
const ACTIVITY_KEY = "monex:activity";
const POLL_KEY = "monex:poll:sinceId";
const POLL_STATUS_KEY = "monex:poll:lastStatus";
const RESET_EPOCH_KEY = "monex:resetEpoch";

const PREFIXES_TO_DELETE = ["monex:save:", "monex:session:", "monex:oauth:", "monex:rl:"];

function requireEnv() {
  if (!API_TOKEN) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  if (!ACCOUNT_ID) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  if (!NAMESPACE_ID) throw new Error("Could not resolve KV namespace id from wrangler.toml");
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
  if (!res.ok || !data.success) {
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

async function deleteKey(key) {
  const res = await fetch(apiUrl(`/values/${encodeURIComponent(key)}`), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  });
  if (res.status === 404) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = data.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`Cloudflare API delete ${key}: ${msg}`);
  }
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

async function bulkDelete(keys) {
  const chunkSize = 10000;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    await cfFetch("/bulk/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
  }
}

async function bumpResetEpoch() {
  const raw = await getValue(RESET_EPOCH_KEY);
  const current = parseInt(raw || "0", 10) || 0;
  const next = current + 1;
  await putValue(RESET_EPOCH_KEY, String(next));
  return next;
}

async function main() {
  requireEnv();
  console.log(`Resetting KV namespace ${NAMESPACE_ID}...`);

  const resetEpoch = await bumpResetEpoch();
  console.log(`resetEpoch → ${resetEpoch}`);

  await putValue(STATE_KEY, JSON.stringify({ processedTweetIds: [], users: {} }));
  await putValue(ACTIVITY_KEY, JSON.stringify({ entries: [] }));

  for (const key of [POLL_KEY, POLL_STATUS_KEY]) {
    try {
      await deleteKey(key);
    } catch (err) {
      if (!String(err.message).includes("404")) console.warn(`delete ${key}:`, err.message);
    }
  }

  let deletedKeys = 0;
  for (const prefix of PREFIXES_TO_DELETE) {
    const keys = await listKeys(prefix);
    if (keys.length) {
      await bulkDelete(keys);
      deletedKeys += keys.length;
      console.log(`Deleted ${keys.length} keys under ${prefix}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    resetEpoch,
    deletedKeys,
    message: "All user progress and X wild log cleared. Clients refresh on next visit.",
  }));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
