/**
 * Re-credit gold for a confirmed $MONEX gold-pack purchase missing from cloud save.
 *
 * Usage:
 *   node scripts/recover-pack-purchase-gold.mjs --dry-run jeux_simon
 *   node scripts/recover-pack-purchase-gold.mjs --tx 0xabc... jeux_simon
 *   node scripts/recover-pack-purchase-gold.mjs jeux_simon
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *
 * Safety:
 * - Only credits when purchase ledger / used-tx shows confirmed gold grant
 * - Idempotency via short accountCompensationsApplied id (<=64 chars, {amount,at})
 * - Credits ledger grant.gold (or package catalog amount), not an arbitrary number
 *
 * Standard-norm (same as campaign/patrol comps):
 *   id like "pack_gold_gp40k_<tx8>" — NOT a full 0x… hash (sanitize truncates at 64)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeTxHash } from "../src/lib/monex-payment-config.js";
import { findGoldPackage, DEFAULT_GOLD_PACKAGES } from "../src/lib/gold-packages.js";
import { resolveProductionUser, normalizeUsername } from "./lib/resolve-production-user.mjs";

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

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let txHash = null;
  const txIdx = args.indexOf("--tx");
  if (txIdx >= 0) txHash = args[txIdx + 1] || null;
  const usernameArg = args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--tx") || "";
  return { dryRun, txHash, usernameArg };
}

function resolveGoldAmount(record) {
  const fromGrant = Math.floor(Number(record?.grant?.gold));
  if (Number.isFinite(fromGrant) && fromGrant > 0) return fromGrant;
  const pkg = findGoldPackage({}, record?.packageId, { includeInactive: true })
    || DEFAULT_GOLD_PACKAGES.find((p) => p.id === record?.packageId);
  const fromPkg = Math.floor(Number(pkg?.gold));
  return Number.isFinite(fromPkg) && fromPkg > 0 ? fromPkg : 0;
}

function annotate(record, recovery) {
  if (!record || typeof record !== "object") return record;
  return { ...record, recovery };
}

async function main() {
  requireEnv();
  const { dryRun, txHash: txArg, usernameArg } = parseArgs(process.argv);
  const username = normalizeUsername(usernameArg);
  if (!username) {
    console.error("Usage: node scripts/recover-pack-purchase-gold.mjs [--dry-run] [--tx 0x...] <username>");
    process.exit(1);
  }

  const resolved = await resolveProductionUser(getValue, listKeys, username, []);
  if (!resolved?.xUserId) {
    console.error(JSON.stringify({ ok: false, error: "user_not_found", username }, null, 2));
    process.exit(1);
  }

  const xUserId = String(resolved.xUserId);
  const purchasesKey = `monex:purchases:user:${xUserId}`;
  const saveKey = `monex:save:${xUserId}`;
  const purchasesRaw = await getValue(purchasesKey);
  const purchases = purchasesRaw ? JSON.parse(purchasesRaw) : [];
  const list = Array.isArray(purchases) ? purchases : [];

  let record = null;
  if (txArg) {
    const want = normalizeTxHash(txArg);
    record = list.find((row) => normalizeTxHash(row?.txHash) === want) || null;
    if (!record) {
      const usedRaw = await getValue(`monex:tx-used:${want}`);
      if (usedRaw) {
        try {
          const used = JSON.parse(usedRaw);
          if (String(used?.xUserId) === xUserId && used?.packageKind === "gold") record = used;
        } catch {
          /* ignore */
        }
      }
    }
  } else {
    record = list.find((row) => row?.packageKind === "gold" && row?.status === "confirmed") || null;
  }

  if (!record || record.packageKind !== "gold") {
    console.error(JSON.stringify({
      ok: false,
      error: "gold_purchase_not_found",
      username,
      xUserId,
      txHash: txArg || null,
      purchases: list.map((r) => ({ txHash: r.txHash, packageId: r.packageId, packageKind: r.packageKind, status: r.status })),
    }, null, 2));
    process.exit(1);
  }

  const txHash = normalizeTxHash(record.txHash);
  const gold = resolveGoldAmount(record);
  if (!txHash || !gold) {
    console.error(JSON.stringify({ ok: false, error: "invalid_purchase_record", record }, null, 2));
    process.exit(1);
  }

  // Keep under sanitize 64-char key limit (full tx hash does not fit).
  // Normalize package id to alphanumerics only so gp_40k → gp40k (stable).
  const pkgShort = String(record.packageId || "gold").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  const txShort = txHash.slice(2, 18);
  const compId = `pack_gold_${pkgShort}_${txShort}`.slice(0, 64);

  const saveRaw = await getValue(saveKey);
  if (!saveRaw) {
    console.error(JSON.stringify({ ok: false, error: "save_not_found", xUserId }, null, 2));
    process.exit(1);
  }
  // Do not round-trip through validateAndSanitizeSave before writing comps —
  // it collapses compensation values to {amount,at} and clamps amount to monball limits.
  const save = JSON.parse(saveRaw);
  const comps = save.accountCompensationsApplied && typeof save.accountCompensationsApplied === "object"
    ? { ...save.accountCompensationsApplied }
    : {};

  const ledgerAlready = Boolean(record?.recovery?.compensationId || record?.recovery?.goldCredited);
  if (comps[compId] || ledgerAlready) {
    console.log(JSON.stringify({
      ok: true,
      alreadyRecovered: true,
      username,
      xUserId,
      txHash,
      money: save.money,
      revision: save.revision,
      compensationId: comps[compId] ? compId : (record?.recovery?.compensationId || compId),
      compensation: comps[compId] || null,
      ledgerRecovery: record?.recovery || null,
    }, null, 2));
    return;
  }

  const moneyBefore = Number(save.money) || 0;
  const revisionBefore = Number(save.revision) || 0;
  const moneyAfter = moneyBefore + gold;
  const revisionAfter = revisionBefore + 1;
  const now = new Date().toISOString();

  const preview = {
    ok: true,
    dryRun,
    username,
    xUserId,
    txHash,
    packageId: record.packageId,
    goldCredited: gold,
    moneyBefore,
    moneyAfter,
    revisionBefore,
    revisionAfter,
    compensationId: compId,
  };

  if (dryRun) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  // Standard-norm shape (matches campaign/patrol): { amount, at } only.
  // amount=1 is an applied marker; real gold delta is on the purchase ledger.
  comps[compId] = { amount: 1, at: now };

  const nextSave = {
    ...save,
    money: moneyAfter,
    revision: revisionAfter,
    updatedAt: now,
    accountCompensationsApplied: comps,
  };
  await putValue(saveKey, JSON.stringify(nextSave));

  const recovery = {
    creditedAt: now,
    compensationId: compId,
    goldCredited: gold,
    moneyBefore,
    moneyAfter,
    revisionBefore,
    revisionAfter,
  };
  const nextPurchases = list.map((row) =>
    normalizeTxHash(row?.txHash) === txHash ? annotate(row, recovery) : row
  );
  await putValue(purchasesKey, JSON.stringify(nextPurchases));

  const usedKey = `monex:tx-used:${txHash}`;
  const usedRaw = await getValue(usedKey);
  if (usedRaw) {
    try {
      await putValue(usedKey, JSON.stringify(annotate(JSON.parse(usedRaw), recovery)));
    } catch {
      /* leave */
    }
  }

  const verify = JSON.parse(await getValue(saveKey));
  console.log(JSON.stringify({
    ...preview,
    moneyAfter: verify.money,
    revisionAfter: verify.revision,
    compensationPresent: Boolean(verify.accountCompensationsApplied?.[compId]),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
