import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";
import { LIMITS, GEAR_SLOTS } from "./save-validate.js";
import { generateShopGear } from "./shop-gear.js";
import {
  getGlobalAdventureProgress,
  globalProgressToChapterStage,
  isEquipmentUnlocked,
  STAGES_PER_CHAPTER,
} from "./equipment-unlock.js";
import {
  buildCampaignCompletionId,
  buildPatrolCompletionId,
  getCompletionFromSave,
  isLegacyPatrolScanCompletionId,
  isPatrolTokenCompletionId,
  logBattleCompletionEvent,
  mergeAccountBattleCompletions,
  normalizeBattleCompletionId,
  repairAdventurePlayhead,
  sanitizeAccountBattleCompletions,
} from "./battle-completion.js";
import { applyQuestResetsToState } from "./quest-reset.js";
import { QUEST_TRACK_TASKS } from "./quest-rewards.js";
import { QUEST_TASK_GOALS } from "./save-economy-guard.js";
import {
  applyPatrolDailyResetOnSave,
  consumePatrolAttempt,
  mergePatrolProgressOntoLatest,
  syncLegacyPatrolScanCount,
} from "./patrol-attempt.js";

const MAX_CLAIM_RETRIES = 3;
const CLAIM_PREFIX = "monex:battle-claim:";
const CLAIM_TTL_SECONDS = 60 * 60 * 24;

const PATROL_ENCOUNTER_IDS = new Set(["trash", "common", "uncommon", "rare"]);
const PATROL_MULT = { trash: 0.65, common: 1, uncommon: 1.35, rare: 1.8 };
const PATROL_GEAR_CHANCE = { trash: 0, common: 0.06, uncommon: 0.16, rare: 0.38 };

const CAMPAIGN_STAGE_TARGETS = {
  c1: 10, c2: 20, c3: 40, c4: 50, c5: 80, c6: 81, c7: 120,
};

function claimKey(xUserId, claimId) {
  return `${CLAIM_PREFIX}${xUserId}:${String(claimId || "").trim()}`;
}

export function isBossStage(stage) {
  const st = Math.floor(Number(stage) || 0);
  return st > 1 && st > 0 && st % 4 === 0;
}

function rollInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollGearDropRarity(isBoss) {
  const r = Math.random();
  if (isBoss) {
    if (r < 0.08) return 1;
    if (r < 0.20) return 2;
    if (r < 0.40) return 3;
    if (r < 0.70) return 4;
    return 5;
  }
  if (r < 0.30) return 1;
  if (r < 0.55) return 2;
  if (r < 0.75) return 3;
  if (r < 0.90) return 4;
  return 5;
}

function rollBattleGear(chapter, isBoss) {
  if (chapter < 2) return null;
  const tier = rollGearDropRarity(isBoss);
  const slot = GEAR_SLOTS[rollInt(0, GEAR_SLOTS.length - 1)];
  return generateShopGear({
    slot,
    tier,
    gearLevelTier: Math.max(1, chapter),
    randomRarity: tier > 3,
  });
}

function normalizeQuestState(save) {
  const qs = save.questState && typeof save.questState === "object" ? save.questState : {};
  return {
    tab: qs.tab || "dailies",
    dailyPoints: qs.dailyPoints || 0,
    weeklyPoints: qs.weeklyPoints || 0,
    dailyClaimedChests: Array.isArray(qs.dailyClaimedChests) ? [...qs.dailyClaimedChests] : [],
    weeklyClaimedChests: Array.isArray(qs.weeklyClaimedChests) ? [...qs.weeklyClaimedChests] : [],
    grantedKeys: Array.isArray(qs.grantedKeys) ? [...qs.grantedKeys] : [],
    dailyResetKey: qs.dailyResetKey ?? null,
    weeklyResetKey: qs.weeklyResetKey ?? null,
    tasks: {
      dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
      weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
      campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
    },
  };
}

function findTask(questState, tab, taskId) {
  return (questState.tasks[tab] || []).find((t) => t?.id === taskId) || null;
}

function upsertTask(questState, tab, taskId, patch) {
  const tasks = questState.tasks[tab] || [];
  const idx = tasks.findIndex((t) => t?.id === taskId);
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], ...patch };
  } else {
    tasks.push({ id: taskId, progress: 0, claimed: false, ...patch });
  }
  questState.tasks[tab] = tasks;
}

function bumpQuestTrack(questState, track, amount = 1, opts = {}) {
  const entries = QUEST_TRACK_TASKS[track];
  if (!entries || amount <= 0) return;
  if (track === "boss_win" && !opts.boss) return;
  for (const { tab, id } of entries) {
    const goal = QUEST_TASK_GOALS[tab]?.[id];
    if (!goal) continue;
    const task = findTask(questState, tab, id);
    if (task?.claimed) continue;
    const next = Math.min(goal, (task?.progress || 0) + amount);
    upsertTask(questState, tab, id, { progress: next });
  }
}

function syncCampaignQuestProgress(questState, adventureGlobalBest) {
  const g = Math.max(0, Math.floor(Number(adventureGlobalBest) || 0));
  for (const [taskId, target] of Object.entries(CAMPAIGN_STAGE_TARGETS)) {
    const task = findTask(questState, "campaign", taskId);
    if (task?.claimed) continue;
    upsertTask(questState, "campaign", taskId, {
      progress: g >= target ? 1 : 0,
    });
  }
}

export function mergeBattleClaimOntoLatest(latest, original, intended) {
  const merged = { ...latest };
  const delta = (field) => (intended[field] || 0) - (original[field] || 0);
  for (const field of ["money", "essence", "monShards", "trainerXp"]) {
    const d = delta(field);
    if (d !== 0) merged[field] = (latest[field] || 0) + d;
  }

  const latestGear = [...(latest.gearInventory || [])];
  const intendedGear = intended.gearInventory || [];
  const originalLen = (original.gearInventory || []).length;
  for (let i = originalLen; i < intendedGear.length; i++) {
    if (intendedGear[i]) latestGear.push(intendedGear[i]);
  }
  merged.gearInventory = latestGear.slice(0, LIMITS.gearInventoryMax);

  if ((intended.adventureGlobalBest || 0) > (latest.adventureGlobalBest || 0)) {
    merged.adventureGlobalBest = intended.adventureGlobalBest;
    merged.highestStageCleared = intended.highestStageCleared;
    merged.currentChapter = intended.currentChapter;
    merged.currentStage = intended.currentStage;
  }

  const base = normalizeQuestState(latest);
  const target = normalizeQuestState(intended);
  applyQuestResetsToState(base);
  for (const tab of ["dailies", "weeklies", "campaign"]) {
    for (const task of target.tasks[tab] || []) {
      const existing = findTask(base, tab, task.id);
      if (existing?.claimed) continue;
      upsertTask(base, tab, task.id, {
        progress: Math.max(existing?.progress || 0, task.progress || 0),
        claimed: existing?.claimed || false,
      });
    }
  }
  merged.questState = base;
  merged.accountBattleCompletions = mergeAccountBattleCompletions(
    latest.accountBattleCompletions,
    intended.accountBattleCompletions
  );
  const patrol = mergePatrolProgressOntoLatest(latest, original, intended);
  merged.patrolScansUsed = patrol.patrolScansUsed;
  merged.patrolScansDay = patrol.patrolScansDay;
  return merged;
}

function buildSaveAfterPatrolLoss(save, completionId) {
  return {
    ...save,
    accountBattleCompletions: mergeAccountBattleCompletions(save.accountBattleCompletions, {
      [completionId]: {
        at: new Date().toISOString(),
        mode: "patrol",
        reward: { gold: 0, essence: 0, monShards: 0, trainerXp: 0, gear: null },
      },
    }),
  };
}

function applyPatrolAttemptForClaim(save, completionId, now = Date.now()) {
  const reset = applyPatrolDailyResetOnSave(save, now);
  if (isPatrolTokenCompletionId(completionId)) {
    return consumePatrolAttempt(reset, now);
  }
  if (isLegacyPatrolScanCompletionId(completionId)) {
    return { ok: true, save: syncLegacyPatrolScanCount(reset, completionId, now) };
  }
  return consumePatrolAttempt(reset, now);
}

function buildSaveAfterBattleClaim(save, computed, battleMode, completionId, serializedReward) {
  const reward = computed.reward;
  let nextSave = applyRewardToSave(save, reward);
  const questState = normalizeQuestState(nextSave);
  applyQuestResetsToState(questState);

  if (battleMode === "patrol") {
    bumpQuestTrack(questState, "patrol_win", 1);
  } else {
    nextSave = advanceAdventureProgress(nextSave, computed.globalP);
    bumpQuestTrack(questState, "adventure_win", 1);
    if (computed.boss) bumpQuestTrack(questState, "boss_win", 1, { boss: true });
    syncCampaignQuestProgress(questState, nextSave.adventureGlobalBest);
  }

  nextSave.questState = questState;
  nextSave.accountBattleCompletions = mergeAccountBattleCompletions(save.accountBattleCompletions, {
    [completionId]: {
      at: new Date().toISOString(),
      mode: battleMode,
      reward: serializedReward,
    },
  });
  return nextSave;
}

function resolveBattleStageForClaim(save, { chapter, stage, claimId } = {}) {
  let reqChapter = Number(chapter);
  let reqStage = Number(stage);
  if (!Number.isFinite(reqChapter) || !Number.isFinite(reqStage)) {
    const match = String(claimId || "").match(/^adv-(\d+)-(\d+)-/);
    if (match) {
      reqChapter = Number(match[1]);
      reqStage = Number(match[2]);
    }
  }
  if (!Number.isFinite(reqChapter) || reqChapter < 1) {
    reqChapter = Math.max(1, Math.floor(save.currentChapter || 1));
  }
  if (!Number.isFinite(reqStage) || reqStage < 1) {
    reqStage = Math.max(1, Math.floor(save.currentStage || 1));
  }

  const best = Math.max(0, Math.floor(Number(save.adventureGlobalBest) || 0));
  const reqGlobal = getGlobalAdventureProgress(reqChapter, reqStage);
  if (reqGlobal > best + 1) {
    return { ok: false, error: "stage_not_reachable" };
  }
  return {
    ok: true,
    saveForCompute: {
      ...save,
      currentChapter: reqChapter,
      currentStage: reqStage,
    },
  };
}

export function computeAdventureReward(save) {
  const chapter = Math.max(1, Math.floor(save.currentChapter || 1));
  const stage = Math.max(1, Math.floor(save.currentStage || 1));
  const boss = isBossStage(stage);
  const mult = boss ? 2 : 1;
  const globalP = getGlobalAdventureProgress(chapter, stage);
  const equipmentUnlocked = isEquipmentUnlocked(save.adventureGlobalBest ?? globalP);

  const reward = {
    gold: (80 + globalP * 12) * mult,
    essence: (10 + globalP * 4) * mult,
    trainerXp: Math.floor((50 + globalP * 25) * (boss ? 1.5 : 1)),
    monShards: 0,
    gear: null,
  };

  if (boss && equipmentUnlocked) {
    reward.gear = rollBattleGear(chapter, true);
    reward.monShards = 1 + Math.floor(globalP / 15);
  } else if (boss) {
    reward.monShards = 2 + Math.floor(globalP / 10);
  } else if (equipmentUnlocked && Math.random() < 0.12) {
    reward.gear = rollBattleGear(chapter, false);
  } else if (globalP >= 3 && Math.random() < 0.25) {
    reward.monShards = 1;
  }

  return { reward, chapter, stage, boss, globalP };
}

export function computePatrolReward(save, encounterId) {
  const id = PATROL_ENCOUNTER_IDS.has(encounterId) ? encounterId : "common";
  const chapter = Math.max(1, Math.floor(save.currentChapter || 1));
  const globalP = getGlobalAdventureProgress(chapter, 1);
  const mult = PATROL_MULT[id] || 1;

  const reward = {
    gold: Math.floor((35 + globalP * 7) * mult),
    essence: Math.floor((5 + globalP * 2) * mult),
    trainerXp: Math.floor((20 + globalP * 8) * mult),
    monShards: 0,
    gear: null,
  };

  if (id === "trash") {
    reward.gold = Math.max(30, reward.gold);
    reward.essence = Math.max(4, reward.essence);
  }

  const gearChance = PATROL_GEAR_CHANCE[id] || 0;
  if (gearChance > 0 && Math.random() < gearChance) {
    reward.gear = rollBattleGear(chapter, id === "rare");
  }
  if (Math.random() < 0.1 * mult) reward.monShards = 1;

  return { reward, encounterId: id, chapter };
}

function applyRewardToSave(save, reward) {
  const inventory = [...(save.gearInventory || [])];
  if (reward.gear) inventory.push(reward.gear);

  return {
    ...save,
    money: (save.money || 0) + (reward.gold || 0),
    essence: (save.essence || 0) + (reward.essence || 0),
    monShards: (save.monShards || 0) + (reward.monShards || 0),
    trainerXp: (save.trainerXp || 0) + (reward.trainerXp || 0),
    gearInventory: inventory.slice(0, LIMITS.gearInventoryMax),
  };
}

function advanceAdventureProgress(save, globalP) {
  let chapter = Math.max(1, Math.floor(save.currentChapter || 1));
  let stage = Math.max(1, Math.floor(save.currentStage || 1));
  const adventureGlobalBest = Math.max(
    Math.floor(Number(save.adventureGlobalBest) || 0),
    globalP
  );
  const best = globalProgressToChapterStage(adventureGlobalBest);

  if (stage >= STAGES_PER_CHAPTER) {
    chapter += 1;
    stage = 1;
  } else {
    stage += 1;
  }

  return {
    ...save,
    currentChapter: chapter,
    currentStage: stage,
    adventureGlobalBest,
    highestStageCleared: best.stage,
  };
}

function serializeReward(reward) {
  return {
    gold: reward.gold || 0,
    essence: reward.essence || 0,
    monShards: reward.monShards || 0,
    trainerXp: reward.trainerXp || 0,
    gear: reward.gear || null,
  };
}

async function repairAndPersistPlayheadIfNeeded(kv, session, save, startingMonballs, context = {}) {
  const { save: repaired, changed } = repairAdventurePlayhead(save);
  if (!changed) return repaired;

  const revision = Number.isFinite(Number(save.revision)) ? Number(save.revision) : undefined;
  const result = await persistBattleSave(
    kv,
    session,
    save,
    repaired,
    revision,
    startingMonballs,
    0,
    { ...context, playheadRepair: true }
  );
  if (result.ok) return result.save;
  return repaired;
}

async function persistBattleSave(
  kv,
  session,
  originalSave,
  intendedSave,
  expectedRevision,
  startingMonballs,
  attempt = 0,
  logContext = {}
) {
  const now = Date.now();
  let saveToWrite = intendedSave;
  if (attempt > 0) {
    const { save: latest } = await loadCloudSave(kv, session.xUserId);
    saveToWrite = mergeBattleClaimOntoLatest(latest, originalSave, intendedSave);
    logBattleCompletionEvent("battle_claim_retry_merge", {
      xUserId: session.xUserId,
      attempt,
      completionId: logContext.completionId,
      revisionBefore: latest.revision,
      moneyBefore: latest.money,
      moneyAfter: saveToWrite.money,
    });
  }
  let payload = buildSavePayload(
    { ...saveToWrite, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  await reconcileMonballsForCloudSave(kv, session, payload, startingMonballs);
  const effectiveRevision = expectedRevision != null && Number.isFinite(Number(expectedRevision))
    ? Number(expectedRevision)
    : undefined;
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, {
      expectedRevision: effectiveRevision,
    });
    logBattleCompletionEvent("battle_claim_persist_ok", {
      xUserId: session.xUserId,
      completionId: logContext.completionId,
      attempt,
      baseRevision: effectiveRevision,
      revision: written.revision,
      moneyBefore: originalSave.money,
      moneyAfter: written.money,
      adventureGlobalBestBefore: originalSave.adventureGlobalBest,
      adventureGlobalBestAfter: written.adventureGlobalBest,
      endpoint: "POST /api/battle/claim-reward",
    });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      const currentRevision = err.currentRevision ?? err.existingSave?.revision;
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      const nextRevision = Number.isFinite(Number(currentRevision))
        ? Number(currentRevision)
        : latest.revision;
      logBattleCompletionEvent("battle_claim_revision_conflict", {
        xUserId: session.xUserId,
        completionId: logContext.completionId,
        attempt,
        expectedRevision: effectiveRevision,
        currentRevision: nextRevision,
      });
      return persistBattleSave(
        kv,
        session,
        originalSave,
        intendedSave,
        nextRevision,
        startingMonballs,
        attempt + 1,
        logContext
      );
    }
    if (err?.code === "revision_conflict") {
      logBattleCompletionEvent("battle_claim_persist_failed", {
        xUserId: session.xUserId,
        completionId: logContext.completionId,
        error: "reward_conflict",
      });
      return { ok: false, error: "reward_conflict", save: err.existingSave };
    }
    throw err;
  }
}

export async function claimBattleReward(
  kv,
  session,
  { mode, win, encounterId, claimId, expectedRevision, chapter, stage, patrolScansDay, patrolScansUsed },
  startingMonballs = 10
) {
  const battleMode = mode === "patrol" ? "patrol" : "adventure";
  if (!win && battleMode !== "patrol") return { ok: false, error: "win_required" };

  const { save } = await loadCloudSave(kv, session.xUserId);
  const completionId = normalizeBattleCompletionId({
    mode: battleMode,
    claimId,
    chapter,
    stage,
    patrolScansDay: patrolScansDay ?? save.patrolScansDay,
    patrolScansUsed: patrolScansUsed ?? save.patrolScansUsed,
    encounterId,
  });
  if (!completionId) return { ok: false, error: "claim_id_required" };

  const ledgerHit = getCompletionFromSave(save, completionId);
  if (ledgerHit) {
    logBattleCompletionEvent("battle_claim_idempotent", {
      xUserId: session.xUserId,
      completionId,
      source: "accountBattleCompletions",
    });
    const repairedSave = await repairAndPersistPlayheadIfNeeded(
      kv,
      session,
      save,
      startingMonballs,
      { completionId }
    );
    return {
      ok: true,
      alreadyClaimed: true,
      completionId,
      reward: ledgerHit.reward,
      save: repairedSave,
    };
  }

  const receiptKey = claimKey(session.xUserId, completionId);
  const prior = await kv.get(receiptKey);
  if (prior) {
    try {
      const parsed = JSON.parse(prior);
      if (parsed?.save) {
        logBattleCompletionEvent("battle_claim_idempotent", {
          xUserId: session.xUserId,
          completionId,
          source: "kv_receipt",
        });
        const repairedSave = await repairAndPersistPlayheadIfNeeded(
          kv,
          session,
          parsed.save,
          startingMonballs,
          { completionId }
        );
        return {
          ok: true,
          alreadyClaimed: true,
          completionId,
          reward: parsed.reward,
          save: repairedSave,
        };
      }
    } catch {
      /* continue */
    }
  }

  let computed;
  let nextSave;
  const emptyReward = { gold: 0, essence: 0, monShards: 0, trainerXp: 0, gear: null };

  if (battleMode === "patrol") {
    const attemptResult = applyPatrolAttemptForClaim(save, completionId);
    if (!attemptResult.ok) {
      logBattleCompletionEvent("battle_claim_rejected", {
        xUserId: session.xUserId,
        completionId,
        error: attemptResult.error,
        patrolScansUsed: attemptResult.save?.patrolScansUsed,
        patrolScansDay: attemptResult.save?.patrolScansDay,
      });
      return attemptResult;
    }

    if (win) {
      computed = computePatrolReward(attemptResult.save, encounterId);
      const reward = computed.reward;
      const serialized = serializeReward(reward);
      nextSave = buildSaveAfterBattleClaim(attemptResult.save, computed, battleMode, completionId, serialized);
    } else {
      computed = { reward: emptyReward, encounterId: encounterId || "common" };
      nextSave = buildSaveAfterPatrolLoss(attemptResult.save, completionId);
    }
  } else {
    if (!win) return { ok: false, error: "win_required" };
    const resolved = resolveBattleStageForClaim(save, { chapter, stage, claimId });
    if (!resolved.ok) {
      logBattleCompletionEvent("battle_claim_rejected", {
        xUserId: session.xUserId,
        completionId,
        error: resolved.error,
        adventureGlobalBest: save.adventureGlobalBest,
        chapter,
        stage,
      });
      return resolved;
    }
    computed = computeAdventureReward(resolved.saveForCompute);
    const reward = computed.reward;
    const serialized = serializeReward(reward);
    nextSave = buildSaveAfterBattleClaim(save, computed, battleMode, completionId, serialized);
  }

  const reward = computed.reward;
  const serialized = serializeReward(reward);

  const revisionForWrite = Number.isFinite(Number(expectedRevision))
    ? Number(expectedRevision)
    : Number.isFinite(Number(save.revision))
      ? Number(save.revision)
      : undefined;

  logBattleCompletionEvent("battle_claim_begin", {
    xUserId: session.xUserId,
    completionId,
    mode: battleMode,
    chapter: computed.chapter ?? chapter,
    stage: computed.stage ?? stage,
    encounterId: computed.encounterId ?? encounterId,
    baseRevision: revisionForWrite,
    moneyBefore: save.money,
    rewardGold: serialized.gold,
    rewardEssence: serialized.essence,
    adventureGlobalBestBefore: save.adventureGlobalBest,
    adventureGlobalBestAfter: nextSave.adventureGlobalBest,
  });

  const result = await persistBattleSave(
    kv,
    session,
    save,
    nextSave,
    revisionForWrite,
    startingMonballs,
    0,
    { completionId }
  );
  if (!result.ok) return { ...result, completionId };

  await kv.put(
    receiptKey,
    JSON.stringify({ reward: serialized, save: result.save, completionId, at: new Date().toISOString() }),
    { expirationTtl: CLAIM_TTL_SECONDS }
  );

  return {
    ok: true,
    mode: battleMode,
    completionId,
    reward: serialized,
    save: result.save,
    alreadyClaimed: false,
  };
}

export { buildCampaignCompletionId, buildPatrolCompletionId, buildPatrolCompletionTokenId, normalizeBattleCompletionId } from "./battle-completion.js";
