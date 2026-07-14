/**
 * Repair missing battle/patrol rewards using accountBattleCompletions ledger.
 *
 * Usage:
 *   node scripts/reconcile-battle-progress.mjs --username jericddd --dry-run
 *   node scripts/reconcile-battle-progress.mjs --username jericddd --confirm REPAIR
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildCampaignCompletionId,
  sanitizeAccountBattleCompletions,
} from "../src/lib/battle-completion.js";
import {
  claimBattleReward,
  computeAdventureReward,
} from "../src/lib/battle-reward.js";
import { loadCloudSave } from "../src/lib/save.js";
import {
  resolveProductionUser,
  normalizeUsername,
  countActivityForUsername,
  findSimilarCatchUsernames,
} from "./lib/resolve-production-user.mjs";

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
  const data = await cfFetch(`/values/${encodeURIComponent(key)}`);
  return data.result ?? null;
}

async function putValue(key, value) {
  await cfFetch(`/values/${encodeURIComponent(key)}`, {
    method: "PUT",
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

function makeKvApi() {
  return {
    async get(key) {
      return getValue(key);
    },
    async put(key, value) {
      await putValue(key, value);
    },
  };
}

function parseArgs(argv) {
  const args = { dryRun: true, confirm: "", username: "" };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--confirm") args.confirm = argv[++i] || "";
    else if (arg === "--username") args.username = argv[++i] || "";
    else if (!arg.startsWith("-") && !args.username) args.username = arg;
  }
  if (args.confirm === "REPAIR") args.dryRun = false;
  return args;
}

function findMissingCampaignRewards(save, chapter, stage) {
  const completionId = buildCampaignCompletionId(chapter, stage);
  const ledger = sanitizeAccountBattleCompletions(save.accountBattleCompletions);
  if (ledger[completionId]) {
    return { eligible: false, reason: "completion_already_recorded", completionId };
  }
  const best = Number(save.adventureGlobalBest) || 0;
  const targetGlobal = stage; // chapter 1: global progress equals stage number
  if (best < targetGlobal - 1) {
    return {
      eligible: false,
      reason: "stage_not_reached",
      completionId,
      adventureGlobalBest: best,
      needsAtLeast: targetGlobal - 1,
    };
  }
  const preview = computeAdventureReward({ ...save, currentChapter: chapter, currentStage: stage });
  const moneyBefore = Number(save.money) || 0;
  return {
    eligible: true,
    completionId,
    reason: best >= targetGlobal ? "ledger_missing_progress_present" : "missing_clear_and_reward",
    expectedReward: preview.reward,
    moneyBefore,
    moneyAfter: moneyBefore + (preview.reward.gold || 0),
    adventureGlobalBestBefore: best,
    adventureGlobalBestAfter: targetGlobal,
  };
}

async function main() {
  requireEnv();
  const args = parseArgs(process.argv);
  if (!args.username) throw new Error("username required");

  const kv = makeKvApi();
  const normalized = normalizeUsername(args.username);
  const activityRaw = await getValue(ACTIVITY_KEY);
  let activityEntries = [];
  try {
    activityEntries = activityRaw ? JSON.parse(activityRaw).entries || [] : [];
  } catch {
    activityEntries = [];
  }

  const user = await resolveProductionUser(getValue, listKeys, args.username, activityEntries);
  if (!user?.xUserId) {
    const similar = await findSimilarCatchUsernames(listKeys, args.username);
    const activityMatches = countActivityForUsername(activityEntries, args.username);
    console.log(JSON.stringify({
      ok: false,
      error: "user_not_found",
      username: args.username,
      normalizedUsername: normalized,
      activityCatchEntries: activityMatches,
      similarCatchUsernames: similar,
      hint: activityMatches > 0
        ? "Handle appears in X catch activity but has no linked xUserId/save yet. Ask the player to log into /play once with X, then re-run."
        : similar.length > 0
          ? `No exact match. Did you mean: ${similar.join(", ")}?`
          : "No KV record for this handle (catch index, cloud save, session, or activity). Player may need to log into /play with X first.",
    }, null, 2));
    return;
  }

  const session = { xUserId: user.xUserId, username: user.save?.xHandle || args.username };
  const { save } = await loadCloudSave(kv, user.xUserId);
  const evaluation = findMissingCampaignRewards(save, 1, 26);

  const report = {
    ok: true,
    username: args.username,
    normalizedUsername: normalized,
    xUserId: user.xUserId,
    resolvedVia: user.resolvedVia || [],
    activityCatchEntries: countActivityForUsername(activityEntries, args.username),
    dryRun: args.dryRun,
    evaluation,
    revision: save.revision,
    money: save.money,
    adventureGlobalBest: save.adventureGlobalBest,
    completionCount: Object.keys(sanitizeAccountBattleCompletions(save.accountBattleCompletions)).length,
  };

  if (!evaluation.eligible) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (args.dryRun) {
    report.action = "would_repair_chapter_1_stage_26";
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (args.confirm !== "REPAIR") {
    throw new Error('Pass --confirm REPAIR to apply repair (or use --dry-run)');
  }

  const result = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: evaluation.completionId,
    chapter: 1,
    stage: 26,
    expectedRevision: save.revision,
  });

  report.repair = {
    ok: result.ok,
    alreadyClaimed: result.alreadyClaimed || false,
    moneyAfter: result.save?.money,
    adventureGlobalBestAfter: result.save?.adventureGlobalBest,
    revisionAfter: result.save?.revision,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
