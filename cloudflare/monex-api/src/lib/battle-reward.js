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

const MAX_CLAIM_RETRIES = 3;
const CLAIM_PREFIX = "monex:battle-claim:";
const CLAIM_TTL_SECONDS = 60 * 60 * 24;

const PATROL_ENCOUNTER_IDS = new Set(["trash", "common", "uncommon", "rare"]);
const PATROL_MULT = { trash: 0.65, common: 1, uncommon: 1.35, rare: 1.8 };
const PATROL_GEAR_CHANCE = { trash: 0, common: 0.06, uncommon: 0.16, rare: 0.38 };

const QUEST_TRACKS = {
  adventure_win: { tabs: ["dailies", "weeklies"], taskIds: { dailies: "d1", weeklies: "w1" }, goals: { dailies: 2, weeklies: 8 } },
  patrol_win: { tabs: ["dailies", "weeklies"], taskIds: { dailies: "d4", weeklies: "w2" }, goals: { dailies: 2, weeklies: 8 } },
  boss_win: { tabs: ["dailies", "weeklies"], taskIds: { dailies: "d6", weeklies: "w4" }, goals: { dailies: 1, weeklies: 3 }, bossOnly: true },
};

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
  const def = QUEST_TRACKS[track];
  if (!def || amount <= 0) return;
  for (const tab of def.tabs) {
    const taskId = def.taskIds[tab];
    const goal = def.goals[tab];
    if (!taskId || !goal) continue;
    if (def.bossOnly && !opts.boss) continue;
    const task = findTask(questState, tab, taskId);
    if (task?.claimed) continue;
    const next = Math.min(goal, (task?.progress || 0) + amount);
    upsertTask(questState, tab, taskId, { progress: next });
  }
}

function syncCampaignQuestProgress(questState, adventureGlobalBest) {
  const g = Math.max(0, Math.floor(Number(adventureGlobalBest) || 0));
  for (const [taskId, target] of Object.entries(CAMPAIGN_STAGE_TARGETS)) {
    const task = findTask(questState, "campaign", taskId);
    if (!task || task.claimed) continue;
    upsertTask(questState, "campaign", taskId, {
      progress: g >= target ? 1 : 0,
    });
  }
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

async function persistBattleSave(kv, session, save, expectedRevision, startingMonballs, attempt = 0) {
  const now = Date.now();
  let payload = buildSavePayload(
    { ...save, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  await reconcileMonballsForCloudSave(kv, session, payload, startingMonballs);
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, { expectedRevision });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      return persistBattleSave(kv, session, latest, latest.revision, startingMonballs, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "reward_conflict", save: err.existingSave };
    }
    throw err;
  }
}

export async function claimBattleReward(
  kv,
  session,
  { mode, win, encounterId, claimId, expectedRevision },
  startingMonballs = 10
) {
  const battleMode = mode === "patrol" ? "patrol" : "adventure";
  const id = String(claimId || "").trim();
  if (!id) return { ok: false, error: "claim_id_required" };
  if (!win) return { ok: false, error: "win_required" };

  const receiptKey = claimKey(session.xUserId, id);
  const prior = await kv.get(receiptKey);
  if (prior) {
    try {
      const parsed = JSON.parse(prior);
      if (parsed?.save) return { ok: true, alreadyClaimed: true, reward: parsed.reward, save: parsed.save };
    } catch {
      /* continue */
    }
  }

  const { save } = await loadCloudSave(kv, session.xUserId);
  let computed;
  if (battleMode === "patrol") {
    computed = computePatrolReward(save, encounterId);
  } else {
    computed = computeAdventureReward(save);
  }

  const reward = computed.reward;
  let nextSave = applyRewardToSave(save, reward);
  const questState = normalizeQuestState(nextSave);

  if (battleMode === "patrol") {
    bumpQuestTrack(questState, "patrol_win", 1);
  } else {
    nextSave = advanceAdventureProgress(nextSave, computed.globalP);
    bumpQuestTrack(questState, "adventure_win", 1);
    if (computed.boss) bumpQuestTrack(questState, "boss_win", 1, { boss: true });
    syncCampaignQuestProgress(questState, nextSave.adventureGlobalBest);
  }

  nextSave.questState = questState;

  const result = await persistBattleSave(kv, session, nextSave, expectedRevision, startingMonballs);
  if (!result.ok) return result;

  const serialized = serializeReward(reward);
  await kv.put(
    receiptKey,
    JSON.stringify({ reward: serialized, save: result.save, at: new Date().toISOString() }),
    { expirationTtl: CLAIM_TTL_SECONDS }
  );

  return {
    ok: true,
    mode: battleMode,
    reward: serialized,
    save: result.save,
    alreadyClaimed: false,
  };
}
