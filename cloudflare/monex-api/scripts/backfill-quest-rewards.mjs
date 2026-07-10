/**
 * Backfill missing quest rewards into mailbox for users who claimed before grant tracking.
 *
 * Usage:
 *   node scripts/backfill-quest-rewards.mjs --dry-run
 *   node scripts/backfill-quest-rewards.mjs --dry-run SomeUser
 *   node scripts/backfill-quest-rewards.mjs SomeUser
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanUsername } from "../src/lib/backfill-pending.js";
import { backfillQuestRewardsForSave } from "../src/lib/backfill-quest-rewards.js";
import { describeGrant } from "../src/lib/quest-rewards.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAVE_PREFIX = "monex:save:";

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

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const usernameArg = args.find((a) => !a.startsWith("--")) || "";
  const username = cleanUsername(usernameArg);
  return { dryRun, username };
}

async function main() {
  requireEnv();
  const { dryRun, username } = parseArgs(process.argv);
  const keys = await listKeys(SAVE_PREFIX);
  const results = [];
  let scanned = 0;
  let eligible = 0;
  let updated = 0;

  for (const key of keys) {
    const raw = await getValue(key);
    if (!raw) continue;
    let save;
    try {
      save = JSON.parse(raw);
    } catch {
      continue;
    }
    const handle = cleanUsername(save?.xHandle || "");
    if (username && handle !== username && handle.toLowerCase() !== username.toLowerCase()) continue;
    scanned += 1;

    const preview = backfillQuestRewardsForSave(save);
    if (!preview.changed) continue;
    eligible += 1;
    const row = {
      xUserId: key.slice(SAVE_PREFIX.length),
      username: handle || "(unknown)",
      keys: preview.keys,
      grants: describeGrant(preview.grants),
      mailId: preview.mailId,
    };
    results.push(row);

    if (!dryRun) {
      await putValue(key, JSON.stringify(preview.save));
      updated += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        username: username || null,
        scanned,
        eligible,
        updated: dryRun ? 0 : updated,
        results,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
