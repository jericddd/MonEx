/**
 * Server-side save PUT guards — blocks client economy inflation, quest forgery,
 * and invalid progression jumps while allowing legitimate per-save gameplay deltas.
 */

import { LIMITS } from "./save-validate.js";
import {
  QUEST_TASK_DEFS,
  DAILY_QUEST_MILESTONES,
  WEEKLY_QUEST_MILESTONES,
  questGrantKey,
  questChestGrantKey,
  buildGrantFromTaskDef,
  DAILY_QUEST_CHEST_REWARDS,
  WEEKLY_QUEST_CHEST_REWARDS,
} from "./quest-rewards.js";

/** Max increase per accepted save PUT (generous for one battle/quest/chest). */
export const MAX_SAVE_DELTA = {
  money: 15_000,
  essence: 500,
  monShards: 25,
  trainerXp: 1_000,
  monballs: 12,
  adventureGlobalBest: 45,
};

/** Quest task goals mirrored from play/index.html (server enforcement). */
export const QUEST_TASK_GOALS = {
  dailies: {
    d1: 2, d2: 2, d3: 1, d4: 2, d5: 1, d6: 1, d7: 2, d8: 1,
  },
  weeklies: {
    w1: 8, w2: 8, w3: 3, w4: 3, w5: 8, w6: 5, w7: 5,
  },
  campaign: {
    c1: 1, c2: 1, c3: 1, c4: 1, c5: 1, c6: 1, c7: 1,
  },
};

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function scalarField(name) {
  if (name === "money") return "money";
  if (name === "essence") return "essence";
  if (name === "monShards") return "monShards";
  if (name === "trainerXp") return "trainerXp";
  return null;
}

/**
 * Clamp economy scalars: allow decreases freely; cap increases per save.
 */
export function clampEconomyScalars(existing, incoming) {
  const out = { ...incoming };
  for (const field of ["money", "essence", "monShards", "trainerXp"]) {
    const before = clampInt(existing?.[field] ?? 0, 0, LIMITS[field] || 99_999_999);
    const raw = clampInt(incoming?.[field] ?? before, 0, LIMITS[field] || 99_999_999);
    if (raw <= before) {
      out[field] = raw;
      continue;
    }
    const maxDelta = MAX_SAVE_DELTA[field] ?? 0;
    out[field] = Math.min(raw, before + maxDelta);
  }
  return out;
}

/**
 * Adventure global best can only advance modestly per save (blocks stage-skip exploits).
 */
export function clampAdventureProgress(existing, incoming) {
  const before = clampInt(existing?.adventureGlobalBest ?? 1, 1, 99_999);
  const raw = clampInt(incoming?.adventureGlobalBest ?? before, 1, 99_999);
  if (raw <= before) return { ...incoming, adventureGlobalBest: raw };
  const maxDelta = MAX_SAVE_DELTA.adventureGlobalBest;
  return {
    ...incoming,
    adventureGlobalBest: Math.min(raw, before + maxDelta),
  };
}

/**
 * Resource chest timestamp may only move forward (max 24h + skew per collect).
 */
export function clampResourceChestTimestamp(existing, incoming, now = Date.now()) {
  const before = Number(existing?.resourceChestLastCollectAt) || 0;
  const raw = Number(incoming?.resourceChestLastCollectAt) || 0;
  if (!Number.isFinite(raw) || raw <= 0) {
    return { ...incoming, resourceChestLastCollectAt: before || null };
  }
  const earliest = before > 0 ? before : now - LIMITS.resourceChestMaxMs;
  const latest = now + LIMITS.clockSkewMs;
  let next = Math.min(Math.max(raw, before), latest);
  if (before > 0 && next - before > LIMITS.resourceChestMaxMs) {
    next = before + LIMITS.resourceChestMaxMs;
  }
  return { ...incoming, resourceChestLastCollectAt: next };
}

function taskGoal(tab, taskId) {
  return QUEST_TASK_GOALS[tab]?.[taskId] ?? null;
}

function taskDef(tab, taskId) {
  return (QUEST_TASK_DEFS[tab] || []).find((t) => t.id === taskId) || null;
}

function chestReward(track, milestone) {
  if (track === "daily") return DAILY_QUEST_CHEST_REWARDS[milestone];
  if (track === "weekly") return WEEKLY_QUEST_CHEST_REWARDS[milestone];
  return null;
}

function maxPointsForChests(track) {
  const milestones = track === "weekly" ? WEEKLY_QUEST_MILESTONES : DAILY_QUEST_MILESTONES;
  return milestones[milestones.length - 1];
}

/**
 * Validate quest claims: strip forged claimed flags; only allow new grantedKeys when earned.
 */
export function reconcileQuestState(existing, incoming) {
  const ex = existing?.questState && typeof existing.questState === "object" ? existing.questState : {};
  const inc = incoming?.questState && typeof incoming.questState === "object" ? incoming.questState : null;
  if (!inc) return incoming;

  const existingKeys = new Set(
    Array.isArray(ex.grantedKeys) ? ex.grantedKeys.map(String) : []
  );
  const incomingKeys = new Set(
    Array.isArray(inc.grantedKeys) ? inc.grantedKeys.map(String) : []
  );
  const allowedKeys = new Set(existingKeys);

  const tasks = { dailies: [], weeklies: [], campaign: [] };
  for (const tab of ["dailies", "weeklies", "campaign"]) {
    const exTasks = new Map((ex.tasks?.[tab] || []).map((t) => [t.id, t]));
    for (const task of inc.tasks?.[tab] || []) {
      const id = String(task.id || "");
      const goal = taskGoal(tab, id);
      const progress = clampInt(task.progress ?? 0, 0, 9999);
      let claimed = !!task.claimed;
      const key = questGrantKey(tab, id);

      if (claimed && goal != null && progress < goal && !existingKeys.has(key)) {
        claimed = false;
      }
      if (claimed && goal != null && progress >= goal && !existingKeys.has(key)) {
        allowedKeys.add(key);
      }
      if (existingKeys.has(key)) {
        claimed = true;
      }
      tasks[tab].push({ id, progress, claimed });
    }
    for (const [id, exTask] of exTasks) {
      if (tasks[tab].some((t) => t.id === id)) continue;
      tasks[tab].push({
        id,
        progress: clampInt(exTask.progress ?? 0, 0, 9999),
        claimed: !!exTask.claimed || existingKeys.has(questGrantKey(tab, id)),
      });
    }
  }

  const dailyPoints = clampInt(inc.dailyPoints ?? ex.dailyPoints ?? 0, 0, 100);
  const weeklyPoints = clampInt(inc.weeklyPoints ?? ex.weeklyPoints ?? 0, 0, 100);

  const dailyClaimed = [];
  for (const ms of inc.dailyClaimedChests || []) {
    const milestone = clampInt(ms, 0, 100);
    if (!DAILY_QUEST_MILESTONES.includes(milestone)) continue;
    const key = questChestGrantKey("dailies", milestone);
    if (existingKeys.has(key)) {
      dailyClaimed.push(milestone);
      continue;
    }
    if (dailyPoints >= milestone) {
      dailyClaimed.push(milestone);
      allowedKeys.add(key);
    }
  }
  for (const ms of ex.dailyClaimedChests || []) {
    if (dailyClaimed.includes(ms)) continue;
    if (existingKeys.has(questChestGrantKey("dailies", ms))) dailyClaimed.push(ms);
  }

  const weeklyClaimed = [];
  for (const ms of inc.weeklyClaimedChests || []) {
    const milestone = clampInt(ms, 0, 100);
    if (!WEEKLY_QUEST_MILESTONES.includes(milestone)) continue;
    const key = questChestGrantKey("weeklies", milestone);
    if (existingKeys.has(key)) {
      weeklyClaimed.push(milestone);
      continue;
    }
    if (weeklyPoints >= milestone) {
      weeklyClaimed.push(milestone);
      allowedKeys.add(key);
    }
  }
  for (const ms of ex.weeklyClaimedChests || []) {
    if (weeklyClaimed.includes(ms)) continue;
    if (existingKeys.has(questChestGrantKey("weeklies", ms))) weeklyClaimed.push(ms);
  }

  return {
    ...incoming,
    questState: {
      ...inc,
      tasks,
      dailyPoints,
      weeklyPoints,
      dailyClaimedChests: [...new Set(dailyClaimed)].sort((a, b) => a - b),
      weeklyClaimedChests: [...new Set(weeklyClaimed)].sort((a, b) => a - b),
      grantedKeys: [...allowedKeys].slice(0, 120),
    },
  };
}

/** Cap inventory growth per save (blocks mass mon injection). */
export function clampInventoryGrowth(existing, incoming, maxAdded = 15) {
  const exCount = (existing?.party?.length || 0) + (existing?.box?.length || 0);
  const inCount = (incoming?.party?.length || 0) + (incoming?.box?.length || 0);
  if (inCount <= exCount + maxAdded) return incoming;
  return {
    ...incoming,
    party: (existing?.party || []).slice(),
    box: (existing?.box || []).slice(),
  };
}

/**
 * Apply all server-side save guards before persist.
 */
export function guardSavePayload(existing, incoming, options = {}) {
  if (!incoming || typeof incoming !== "object") return incoming;
  const ex = existing && typeof existing === "object" ? existing : {};
  let out = { ...incoming };
  out = clampEconomyScalars(ex, out);
  out = clampAdventureProgress(ex, out);
  out = clampResourceChestTimestamp(ex, out, options.now);
  out = reconcileQuestState(ex, out);
  out = clampInventoryGrowth(ex, out);
  return out;
}

/** Sum max grant from newly allowed quest keys (for monball delta validation). */
export function maxGrantFromNewQuestKeys(existingKeys, allowedKeys) {
  let monballs = 0;
  for (const key of allowedKeys) {
    if (existingKeys.has(key)) continue;
    if (key.startsWith("task:")) {
      const [, tab, taskId] = key.split(":");
      const def = taskDef(tab, taskId);
      const grant = buildGrantFromTaskDef(def);
      if (grant?.monballs) monballs += grant.monballs;
    } else if (key.startsWith("chest:")) {
      const [, track, ms] = key.split(":");
      const chest = chestReward(track, Number(ms));
      if (chest?.grant?.monballs) monballs += chest.grant.monballs;
    }
  }
  return monballs;
}

export function maxPointsForChestsExport(track) {
  return maxPointsForChests(track);
}
