/**
 * Remove one user's entries from the global X Wild Log (monex:activity).
 * Does not wipe saves, sessions, or other users.
 *
 * Usage:
 *   node scripts/purge-activity-user.mjs yesdraken_
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
const ACTIVITY_KEY = "monex:activity";

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

function normalizeUsername(username) {
  return String(username || "").toLowerCase().replace(/^@/, "").trim();
}

async function main() {
  requireEnv();
  const target = normalizeUsername(process.argv[2]);
  if (!target) {
    console.error("Usage: node scripts/purge-activity-user.mjs <x_username>");
    process.exit(1);
  }

  const raw = await getValue(ACTIVITY_KEY);
  const log = raw ? JSON.parse(raw) : { entries: [] };
  const entries = Array.isArray(log.entries) ? log.entries : [];
  const before = entries.length;
  const kept = entries.filter((e) => normalizeUsername(e?.xUsername) !== target);
  const removed = before - kept.length;

  if (!removed) {
    console.log(JSON.stringify({ ok: true, username: target, removed: 0, remaining: before }));
    return;
  }

  log.entries = kept;
  await putValue(ACTIVITY_KEY, JSON.stringify(log));

  console.log(
    JSON.stringify({
      ok: true,
      username: target,
      removed,
      remaining: kept.length,
      message: `Removed ${removed} X log entr${removed === 1 ? "y" : "ies"} for @${target}.`,
    })
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
