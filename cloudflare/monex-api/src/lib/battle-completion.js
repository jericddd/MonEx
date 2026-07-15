/**
 * Permanent battle/patrol completion ledger stored on cloud save.
 * KV receipts are a cache; this object is the source of truth for idempotency.
 */

import { getGlobalAdventureProgress, globalProgressToChapterStage } from "./equipment-unlock.js";

export const COMPLETION_ID_MAX = 96;
export const COMPLETION_LEDGER_MAX = 200;

export function buildCampaignCompletionId(chapter, stage) {
  const ch = Math.max(1, Math.floor(Number(chapter) || 1));
  const st = Math.max(1, Math.floor(Number(stage) || 1));
  return `campaign:chapter-${ch}:stage-${st}:first-clear`;
}

export function buildPatrolCompletionId(patrolScansDay, patrolScansUsed, encounterId) {
  const day = String(patrolScansDay || "unknown").trim().slice(0, 32) || "unknown";
  const scan = Math.max(1, Math.floor(Number(patrolScansUsed) || 1));
  const enc = String(encounterId || "common").trim().slice(0, 24) || "common";
  return `patrol:day-${day}:scan-${scan}:${enc}`;
}

export function buildPatrolCompletionTokenId(token) {
  const value = String(token || "").trim().slice(0, 64);
  if (!value) return null;
  return `patrol:token:${value}`.slice(0, COMPLETION_ID_MAX);
}

export function isPatrolTokenCompletionId(completionId) {
  return String(completionId || "").startsWith("patrol:token:");
}

export function isLegacyPatrolScanCompletionId(completionId) {
  return String(completionId || "").startsWith("patrol:day-");
}

export function parseLegacyAdventureClaimId(claimId) {
  const match = String(claimId || "").match(/^adv-(\d+)-(\d+)-/);
  if (!match) return null;
  return buildCampaignCompletionId(Number(match[1]), Number(match[2]));
}

export function normalizeBattleCompletionId({ mode, claimId, chapter, stage, patrolScansDay, patrolScansUsed, encounterId } = {}) {
  const raw = String(claimId || "").trim();
  if (raw.startsWith("campaign:chapter-") || raw.startsWith("patrol:day-") || raw.startsWith("patrol:token:")) {
    return raw.slice(0, COMPLETION_ID_MAX);
  }

  if (mode === "patrol") {
    if (raw.startsWith("patrol-")) {
      const parts = raw.split("-");
      const enc = parts[1] || encounterId || "common";
      return buildPatrolCompletionId(patrolScansDay, patrolScansUsed, enc);
    }
    return buildPatrolCompletionId(patrolScansDay, patrolScansUsed, encounterId);
  }

  const legacy = parseLegacyAdventureClaimId(raw);
  if (legacy) return legacy;
  if (Number.isFinite(Number(chapter)) && Number.isFinite(Number(stage))) {
    return buildCampaignCompletionId(chapter, stage);
  }
  return raw.slice(0, COMPLETION_ID_MAX) || null;
}

export function sanitizeAccountBattleCompletions(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const id = String(key || "").trim().slice(0, COMPLETION_ID_MAX);
    if (!id || !val || typeof val !== "object") continue;
    const reward = val.reward && typeof val.reward === "object" ? val.reward : {};
    out[id] = {
      at: typeof val.at === "string" ? val.at.slice(0, 32) : null,
      mode: val.mode === "patrol" ? "patrol" : "adventure",
      reward: {
        gold: Math.max(0, Math.floor(Number(reward.gold) || 0)),
        essence: Math.max(0, Math.floor(Number(reward.essence) || 0)),
        monShards: Math.max(0, Math.floor(Number(reward.monShards) || 0)),
        trainerXp: Math.max(0, Math.floor(Number(reward.trainerXp) || 0)),
        gear: reward.gear && typeof reward.gear === "object" ? reward.gear : null,
      },
    };
    if (Object.keys(out).length >= COMPLETION_LEDGER_MAX) break;
  }
  return out;
}

export function mergeAccountBattleCompletions(existing, incoming) {
  const ex = sanitizeAccountBattleCompletions(existing);
  const inc = sanitizeAccountBattleCompletions(incoming);
  return { ...ex, ...inc };
}

export function getCompletionFromSave(save, completionId) {
  if (!completionId) return null;
  const ledger = sanitizeAccountBattleCompletions(save?.accountBattleCompletions);
  return ledger[completionId] || null;
}

export function maxAdventureGlobalFromCompletions(completions) {
  let max = 0;
  for (const id of Object.keys(sanitizeAccountBattleCompletions(completions))) {
    const match = id.match(/^campaign:chapter-(\d+):stage-(\d+):first-clear$/);
    if (!match) continue;
    const globalP = getGlobalAdventureProgress(Number(match[1]), Number(match[2]));
    if (globalP > max) max = globalP;
  }
  return max;
}

/** Best cleared global stage from save field and completion ledger. */
export function getEffectiveAdventureGlobalBest(save) {
  if (!save || typeof save !== "object") return 0;
  const fromField = Math.max(0, Math.floor(Number(save.adventureGlobalBest) || 0));
  const fromLedger = maxAdventureGlobalFromCompletions(save.accountBattleCompletions);
  return Math.max(fromField, fromLedger);
}

/**
 * If cleared stages are recorded but playhead rolled back (stale autosave),
 * advance currentChapter/currentStage to the next uncleared stage.
 */
export function repairAdventurePlayhead(save) {
  if (!save || typeof save !== "object") {
    return { save, changed: false };
  }

  const effectiveBest = getEffectiveAdventureGlobalBest(save);
  const chapterBefore = Math.max(1, Math.floor(Number(save.currentChapter) || 1));
  const stageBefore = Math.max(1, Math.floor(Number(save.currentStage) || 1));
  const currentGlobal = getGlobalAdventureProgress(chapterBefore, stageBefore);

  let nextChapter = chapterBefore;
  let nextStage = stageBefore;
  let changed = false;

  if (effectiveBest > 0 && currentGlobal <= effectiveBest) {
    const next = globalProgressToChapterStage(effectiveBest + 1);
    nextChapter = next.chapter;
    nextStage = next.stage;
    changed = true;
  }

  const nextBest = Math.max(effectiveBest, Math.floor(Number(save.adventureGlobalBest) || 0));
  if (nextBest !== Math.floor(Number(save.adventureGlobalBest) || 0)) {
    changed = true;
  }

  const bestPos = globalProgressToChapterStage(Math.max(nextBest, 1));
  const highestBefore = Math.floor(Number(save.highestStageCleared) || 0);

  if (!changed && nextChapter === chapterBefore && nextStage === stageBefore && nextBest === Math.floor(Number(save.adventureGlobalBest) || 0)) {
    return { save, changed: false };
  }

  return {
    save: {
      ...save,
      currentChapter: nextChapter,
      currentStage: nextStage,
      adventureGlobalBest: nextBest,
      highestStageCleared: Math.max(highestBefore, bestPos.stage),
    },
    changed: true,
  };
}

export function logBattleCompletionEvent(event, fields = {}) {
  try {
    console.log(JSON.stringify({ evt: event, ...fields }));
  } catch {
    /* ignore */
  }
}
