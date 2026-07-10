/**
 * Send a mailbox reward to one user or all cloud saves.
 *
 * Usage:
 *   node scripts/send-mailbox-reward.mjs --title "Sorry!" --resource monball --quantity 5 --dry-run
 *   node scripts/send-mailbox-reward.mjs --title "Event" --resource gold --quantity 100 messedupmental
 *   node scripts/send-mailbox-reward.mjs --title "Gift" --resource kbs_onion --quantity 20
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanUsername } from "../src/lib/backfill-pending.js";
import {
  normalizeMailResourceType,
  sendMailboxRewardToSave,
} from "../src/lib/send-mailbox-reward.js";

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

function readFlag(args, name) {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = hasFlag(args, "--dry-run");
  const allUsers = hasFlag(args, "--all-users");
  const title = readFlag(args, "--title") || process.env.MAIL_TITLE || "";
  const resource = readFlag(args, "--resource") || process.env.MAIL_RESOURCE || "";
  const quantity = readFlag(args, "--quantity") || process.env.MAIL_QUANTITY || "";
  const positional = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    const prev = args[i - 1];
    return !(prev === "--title" || prev === "--resource" || prev === "--quantity");
  });
  const username = cleanUsername(positional[0] || process.env.MAIL_USERNAME || "");
  return { dryRun, allUsers, title, resource, quantity, username };
}

async function main() {
  requireEnv();
  const { dryRun, allUsers, title, resource, quantity, username } = parseArgs(process.argv);
  if (!username && !allUsers) {
    console.error("Refusing bulk send: pass a username or --all-users");
    process.exit(1);
  }
  const resourceType = normalizeMailResourceType(resource);
  const qty = Math.floor(Number(quantity));

  if (!title.trim()) {
    console.error("Missing --title");
    process.exit(1);
  }
  if (!resourceType) {
    console.error("Invalid --resource. Use gold, kbs_onion, or monball");
    process.exit(1);
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    console.error("Invalid --quantity (must be a positive number)");
    process.exit(1);
  }

  const keys = await listKeys(SAVE_PREFIX);
  const results = [];
  let scanned = 0;
  let delivered = 0;
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

    const preview = sendMailboxRewardToSave(save, {
      title,
      resourceType: resource,
      quantity: qty,
    });
    if (!preview.changed) continue;
    delivered += 1;

    const row = {
      xUserId: key.slice(SAVE_PREFIX.length),
      username: handle || "(unknown)",
      mailId: preview.item.id,
      mailTitle: preview.item.title,
      resource: resourceType,
      quantity: qty,
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
        title,
        resource: resourceType,
        quantity: qty,
        username: username || null,
        scanned,
        delivered,
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
