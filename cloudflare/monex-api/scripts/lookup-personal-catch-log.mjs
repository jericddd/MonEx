/**
 * Look up a player's personal catch log # for support / sync investigations.
 *
 * Usage:
 *   node scripts/lookup-personal-catch-log.mjs trainer 5
 *   node scripts/lookup-personal-catch-log.mjs @trainer 5
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolvePersonalCatchLog } from "../src/lib/personal-catch-log.js";

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

function makeRemoteKv() {
  return {
    async get(key) {
      return getValue(key);
    },
  };
}

function usage() {
  console.log(`Usage: node scripts/lookup-personal-catch-log.mjs <username> <log#>`);
  process.exit(1);
}

const username = process.argv[2];
const logNumber = process.argv[3];
if (!username || !logNumber) usage();

requireEnv();

const kv = makeRemoteKv();
const result = await resolvePersonalCatchLog(kv, {
  username: username.replace(/^@/, ""),
  logNumber,
});

if (!result.ok) {
  console.error(JSON.stringify({ ok: false, error: result.error, logNumber: Number(logNumber) }, null, 2));
  process.exit(1);
}

const summary = {
  ok: true,
  logNumber: result.logNumber,
  username: result.username,
  xUserId: result.xUserId,
  tweetId: result.tweetId,
  durableRef: result.ref,
  activity: result.activity
    ? {
        id: result.activity.id,
        at: result.activity.at,
        spend: result.activity.spend,
        monballsBefore: result.activity.monballsBefore,
        monballsLeft: result.activity.monballsLeft,
        caughtCount: result.activity.caughtCount,
        personalLogNumber: result.activity.personalLogNumber,
        completionStatus: result.activity.completionStatus,
      }
    : null,
  receipt: result.receipt
    ? {
        catchId: result.receipt.catchId,
        claimModel: result.receipt.claimModel,
        spendApplied: result.receipt.spendApplied,
        completionStatus: result.receipt.completionStatus,
        deliveryStatus: result.receipt.deliveryStatus,
        monballsBefore: result.receipt.monballsBefore,
        monballsLeft: result.receipt.monballsLeft,
        spend: result.receipt.spend,
        personalLogNumber: result.receipt.personalLogNumber,
      }
    : null,
};

console.log(JSON.stringify(summary, null, 2));
