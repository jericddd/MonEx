/**
 * Scan production KV saves and flag inventory inflation vs activity log.
 *
 * The refresh-dupe bug appended activity mons on every /api/hydrate when
 * wildPendingId was stripped, so save inventory can far exceed true catches.
 *
 * Usage:
 *   node scripts/audit-inventory-inflation.mjs
 *   node scripts/audit-inventory-inflation.mjs --json
 *   node scripts/audit-inventory-inflation.mjs --min-ratio 2 jericddd
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  filterActivityEntries,
  extractRecoverableMons,
} from "../src/lib/recover-activity-catches.js";
import { cleanUsername } from "../src/lib/backfill-pending.js";

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
const SAVE_PREFIX = "monex:save:";

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
  const jsonOut = args.includes("--json");
  const minRatioIdx = args.indexOf("--min-ratio");
  const minRatio = minRatioIdx >= 0 && args[minRatioIdx + 1]
    ? Number(args[minRatioIdx + 1])
    : 2;
  const usernameFilter = args.find(
    (a) => !a.startsWith("--") && a !== String(minRatio)
  );
  return {
    jsonOut,
    minRatio: Number.isFinite(minRatio) && minRatio > 1 ? minRatio : 2,
    usernameFilter: usernameFilter ? cleanUsername(usernameFilter) : null,
  };
}

function countActivityMons(entries, username) {
  const matched = filterActivityEntries(entries, username, { caseSensitive: false });
  const recoverable = extractRecoverableMons(matched);
  const caughtReported = matched.reduce(
    (sum, e) => sum + (Number(e.caughtCount) || 0),
    0
  );
  return {
    sessions: matched.length,
    caughtReported,
    recoverableMons: recoverable.length,
    trueMons: recoverable.length || caughtReported,
  };
}

function classifyRow(row, minRatio) {
  const { saveMons, trueMons, ratio } = row;
  if (saveMons <= trueMons) return "ok";
  if (trueMons === 0 && saveMons > 0) return "save_without_activity";
  if (ratio >= minRatio || saveMons >= 100) return "likely_inflated";
  if (saveMons > trueMons + 5) return "suspicious";
  return "minor_delta";
}

async function main() {
  requireEnv();
  const { jsonOut, minRatio, usernameFilter } = parseArgs(process.argv);

  const [activityRaw, saveKeys] = await Promise.all([
    getValue(ACTIVITY_KEY),
    listKeys(SAVE_PREFIX),
  ]);
  const activity = activityRaw ? JSON.parse(activityRaw) : { entries: [] };
  const entries = Array.isArray(activity.entries) ? activity.entries : [];

  const rows = [];
  for (const key of saveKeys) {
    const raw = await getValue(key);
    if (!raw) continue;
    let save;
    try {
      save = JSON.parse(raw);
    } catch {
      continue;
    }
    const handle = cleanUsername(save?.xHandle);
    if (!handle) continue;
    if (usernameFilter && handle.toLowerCase() !== usernameFilter.toLowerCase()) {
      continue;
    }

    const party = save?.party?.length || 0;
    const box = save?.box?.length || 0;
    const saveMons = party + box;
    const activityStats = countActivityMons(entries, handle);
    const trueMons = activityStats.trueMons;
    const ratio = trueMons > 0 ? saveMons / trueMons : saveMons > 0 ? Infinity : 1;
    const status = classifyRow({ saveMons, trueMons, ratio }, minRatio);

    rows.push({
      username: handle,
      xUserId: key.slice(SAVE_PREFIX.length),
      party,
      box,
      saveMons,
      activitySessions: activityStats.sessions,
      activityCaughtReported: activityStats.caughtReported,
      activityRecoverableMons: activityStats.recoverableMons,
      trueMons,
      ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
      status,
      updatedAt: save?.updatedAt || null,
      revision: save?.revision ?? null,
    });
  }

  rows.sort((a, b) => (b.ratio || 0) - (a.ratio || 0) || b.saveMons - a.saveMons);

  const flagged = rows.filter((r) => r.status === "likely_inflated" || r.status === "suspicious");
  const report = {
    generatedAt: new Date().toISOString(),
    minRatio,
    usernameFilter,
    totals: {
      savesScanned: rows.length,
      flagged: flagged.length,
      likelyInflated: rows.filter((r) => r.status === "likely_inflated").length,
      suspicious: rows.filter((r) => r.status === "suspicious").length,
    },
    flagged,
    all: rows,
  };

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Inventory inflation audit");
  console.log(`Saves scanned: ${report.totals.savesScanned}`);
  console.log(`Flagged (ratio >= ${minRatio} or save >= 100 with excess): ${report.totals.flagged}`);
  console.log("");

  if (!flagged.length) {
    console.log("No inflated inventories detected at current thresholds.");
    return;
  }

  console.log("Flagged users:");
  for (const r of flagged) {
    console.log(
      `  @${r.username}  save=${r.saveMons} (party ${r.party} + box ${r.box})`
        + `  activity=${r.trueMons} (${r.activitySessions} sessions)`
        + `  ratio=${r.ratio ?? "inf"}  status=${r.status}`
    );
  }

  console.log("");
  console.log("All saves (save vs activity):");
  for (const r of rows) {
    console.log(
      `  @${r.username.padEnd(18)} save=${String(r.saveMons).padStart(4)}`
        + `  activity=${String(r.trueMons).padStart(4)}`
        + `  ratio=${String(r.ratio ?? "inf").padStart(6)}  ${r.status}`
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
