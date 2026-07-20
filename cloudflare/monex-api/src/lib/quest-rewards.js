/** Quest reward definitions and helpers (mirrors play/index.html). */

export const DAILY_QUEST_MILESTONES = [20, 40, 60, 80, 100];
export const WEEKLY_QUEST_MILESTONES = [20, 40, 60, 80, 100];
/** Soft chest track ends at 100; total earnable points exceed that for skip flexibility. */
export const DAILY_QUEST_MAX_POINTS = 150;
export const WEEKLY_QUEST_MAX_POINTS = 150;

export const DAILY_QUEST_CHEST_REWARDS = {
  20: { label: "100 Gold", grant: { gold: 100 } },
  40: { label: "15 KB's Onion", grant: { essence: 15 } },
  60: { label: "1 Monball + 150 Gold", grant: { monballs: 1, gold: 150 } },
  80: { label: "2 Shards", grant: { monShards: 2 } },
  100: { label: "250 Gold + 25 Onion + 50 Trainer XP", grant: { gold: 250, essence: 25, trainerXp: 50 } },
};

export const WEEKLY_QUEST_CHEST_REWARDS = {
  20: { label: "300 Gold", grant: { gold: 300 } },
  40: { label: "40 KB's Onion", grant: { essence: 40 } },
  60: { label: "4 Monballs + 700 Gold", grant: { monballs: 4, gold: 700 } },
  80: { label: "6 Shards", grant: { monShards: 6 } },
  100: { label: "6 Monballs + 1000 Gold + 150 Trainer XP + 60 KB's Onion", grant: { monballs: 6, gold: 1000, trainerXp: 150, essence: 60 } },
};

/** @deprecated Use DAILY_QUEST_MILESTONES */
export const QUEST_MILESTONES = DAILY_QUEST_MILESTONES;

/** @deprecated Use DAILY_QUEST_CHEST_REWARDS */
export const QUEST_CHEST_REWARDS = DAILY_QUEST_CHEST_REWARDS;

/** Quest task goals mirrored from play/index.html (server enforcement). */
export const QUEST_TASK_GOALS = {
  dailies: {
    d1: 2, d2: 2, d3: 1, d4: 2, d5: 1, d6: 1, d7: 2, d8: 1,
    d9: 1, d10: 3, d11: 4, d12: 4, d13: 5,
  },
  weeklies: {
    w1: 13, w2: 13, w3: 5, w4: 5, w5: 13, w6: 5, w7: 8,
    w8: 8, w9: 10, w10: 12, w11: 20, w12: 5,
  },
  campaign: {
    c1: 1, c2: 1, c3: 1, c4: 1, c5: 1, c6: 1, c7: 1,
  },
};

/** Quest track → all task ids that share progress (mirrors play/index.html QUEST_TASK_DEFS track field). */
export const QUEST_TRACK_TASKS = Object.freeze({
  adventure_win: [
    { tab: "dailies", id: "d1" },
    { tab: "dailies", id: "d13" },
    { tab: "weeklies", id: "w1" },
    { tab: "weeklies", id: "w11" },
  ],
  patrol_win: [
    { tab: "dailies", id: "d4" },
    { tab: "dailies", id: "d11" },
    { tab: "weeklies", id: "w2" },
  ],
  boss_win: [
    { tab: "dailies", id: "d6" },
    { tab: "weeklies", id: "w4" },
    { tab: "weeklies", id: "w7" },
  ],
  mon_level_up: [
    { tab: "dailies", id: "d2" },
    { tab: "dailies", id: "d12" },
    { tab: "weeklies", id: "w10" },
  ],
  gear_equip: [
    { tab: "dailies", id: "d7" },
    { tab: "weeklies", id: "w5" },
  ],
  daily_login: [
    { tab: "dailies", id: "d8" },
    { tab: "weeklies", id: "w6" },
  ],
});

/** Bump all quest tasks sharing a track id (server mutation paths). */
export function bumpQuestTrackProgress(questState, track, amount = 1) {
  const entries = QUEST_TRACK_TASKS[track];
  if (!entries || amount <= 0) return questState;
  const qs = questState && typeof questState === "object" ? { ...questState } : {};
  const tasks = {
    dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
    weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
    campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
  };
  const add = Math.max(1, Math.floor(Number(amount) || 1));
  for (const { tab, id } of entries) {
    const list = tasks[tab];
    if (!list) continue;
    const goal = QUEST_TASK_GOALS[tab]?.[id] ?? 1;
    const idx = list.findIndex((t) => t?.id === id);
    if (idx >= 0) {
      const task = list[idx];
      if (task.claimed) continue;
      list[idx] = {
        ...task,
        progress: Math.min(goal, (task.progress || 0) + add),
      };
    } else {
      list.push({ id, progress: Math.min(goal, add), claimed: false });
    }
  }
  return { ...qs, tasks };
}

export const QUEST_TASK_DEFS = {
  dailies: [
    { id: "d1", points: 15, rewardKey: "gold", rewardAmount: 100 },
    { id: "d2", points: 15, rewardKey: "essence", rewardAmount: 15 },
    { id: "d3", points: 10, rewardKey: "gold", rewardAmount: 80 },
    { id: "d4", points: 10, rewardKey: "gold", rewardAmount: 50 },
    { id: "d5", points: 10, rewardKey: "trainerXp", rewardAmount: 40 },
    { id: "d6", points: 15, rewardKey: "gold", rewardAmount: 120 },
    { id: "d7", points: 15, rewardKey: "essence", rewardAmount: 12 },
    { id: "d8", points: 15, rewardKey: "trainerXp", rewardAmount: 30 },
    { id: "d9", points: 10, rewardKey: "essence", rewardAmount: 10 },
    { id: "d10", points: 8, rewardKey: "gold", rewardAmount: 60 },
    { id: "d11", points: 9, rewardKey: "gold", rewardAmount: 70 },
    { id: "d12", points: 9, rewardKey: "essence", rewardAmount: 12 },
    { id: "d13", points: 9, rewardKey: "gold", rewardAmount: 100 },
  ],
  weeklies: [
    { id: "w1", points: 20, rewardKey: "gold", rewardAmount: 250 },
    { id: "w2", points: 15, rewardKey: "essence", rewardAmount: 25 },
    { id: "w3", points: 15, rewardKey: "shards", rewardAmount: 3 },
    { id: "w4", points: 15, rewardKey: "gold", rewardAmount: 200 },
    { id: "w5", points: 15, rewardKey: "essence", rewardAmount: 35 },
    { id: "w6", points: 15, rewardKey: "trainerXp", rewardAmount: 80 },
    { id: "w7", points: 15, rewardKey: "gold", rewardAmount: 350 },
    { id: "w8", points: 8, rewardKey: "shards", rewardAmount: 2 },
    { id: "w9", points: 8, rewardKey: "gold", rewardAmount: 200 },
    { id: "w10", points: 8, rewardKey: "essence", rewardAmount: 30 },
    { id: "w11", points: 8, rewardKey: "gold", rewardAmount: 400 },
    { id: "w12", points: 8, rewardKey: "trainerXp", rewardAmount: 60 },
  ],
  campaign: [
    { id: "c1", points: 15, rewardKey: "monball", rewardAmount: 15 },
    { id: "c2", points: 15, rewardKey: "gold", rewardAmount: 250 },
    { id: "c3", points: 20, rewardKey: "shards", rewardAmount: 3 },
    { id: "c4", points: 15, rewardKey: "essence", rewardAmount: 30 },
    { id: "c5", points: 20, rewardKey: "gold", rewardAmount: 400 },
    { id: "c6", points: 15, rewardKey: "trainerXp", rewardAmount: 100 },
    { id: "c7", points: 20, rewardKey: "monball", rewardAmount: 5 },
  ],
};

export function questGrantKey(tab, taskId) {
  return `task:${tab}:${taskId}`;
}

export function questChestGrantKey(track, milestone) {
  return `chest:${track}:${milestone}`;
}

function normalizeClaimedChests(list, allowed) {
  return (Array.isArray(list) ? list : [])
    .map((n) => Number(n))
    .filter((n) => allowed.includes(n));
}

export function buildGrantFromTaskDef(def) {
  if (!def?.rewardKey || !def.rewardAmount) return null;
  const grant = {};
  if (def.rewardKey === "gold") grant.gold = def.rewardAmount;
  else if (def.rewardKey === "essence") grant.essence = def.rewardAmount;
  else if (def.rewardKey === "shards") grant.monShards = def.rewardAmount;
  else if (def.rewardKey === "monball") grant.monballs = def.rewardAmount;
  else if (def.rewardKey === "trainerXp") grant.trainerXp = def.rewardAmount;
  return Object.keys(grant).length ? grant : null;
}

export function mergeGrants(target, grant) {
  if (!grant) return target;
  const out = { ...target };
  if (grant.gold) out.gold = (out.gold || 0) + grant.gold;
  if (grant.essence) out.essence = (out.essence || 0) + grant.essence;
  if (grant.monballs) out.monballs = (out.monballs || 0) + grant.monballs;
  if (grant.monShards) out.monShards = (out.monShards || 0) + grant.monShards;
  if (grant.trainerXp) out.trainerXp = (out.trainerXp || 0) + grant.trainerXp;
  return out;
}

export function describeGrant(grant) {
  if (!grant) return "";
  const parts = [];
  if (grant.gold) parts.push(`${grant.gold} Gold`);
  if (grant.essence) parts.push(`${grant.essence} KB's Onion`);
  if (grant.monballs) parts.push(`${grant.monballs} Monball${grant.monballs > 1 ? "s" : ""}`);
  if (grant.monShards) parts.push(`${grant.monShards} Shard${grant.monShards > 1 ? "s" : ""}`);
  if (grant.trainerXp) parts.push(`${grant.trainerXp} Trainer XP`);
  return parts.join(", ");
}

/**
 * Find quest/milestone claims that never received a tracked grant.
 * Returns { grants: merged grant object, keys: string[] }.
 */
export function findUngrantedQuestRewards(questState) {
  if (!questState || typeof questState !== "object") {
    return { grants: null, keys: [] };
  }
  const granted = new Set(
    Array.isArray(questState.grantedKeys)
      ? questState.grantedKeys.map((k) => String(k))
      : []
  );
  let grants = null;
  const keys = [];

  for (const tab of ["dailies", "weeklies", "campaign"]) {
    const defs = QUEST_TASK_DEFS[tab] || [];
    const tasks = Array.isArray(questState.tasks?.[tab]) ? questState.tasks[tab] : [];
    for (const def of defs) {
      const task = tasks.find((t) => t?.id === def.id);
      const key = questGrantKey(tab, def.id);
      if (!task?.claimed || granted.has(key)) continue;
      grants = mergeGrants(grants, buildGrantFromTaskDef(def));
      keys.push(key);
    }
  }

  const dailyClaimed = normalizeClaimedChests(
    questState.dailyClaimedChests ?? questState.claimedChests,
    DAILY_QUEST_MILESTONES
  );
  for (const ms of DAILY_QUEST_MILESTONES) {
    const key = questChestGrantKey("dailies", ms);
    const legacyKey = `chest:${ms}`;
    if (!dailyClaimed.includes(ms)) continue;
    if (granted.has(key) || granted.has(legacyKey)) continue;
    grants = mergeGrants(grants, DAILY_QUEST_CHEST_REWARDS[ms]?.grant);
    keys.push(key);
  }

  const weeklyClaimed = normalizeClaimedChests(
    questState.weeklyClaimedChests,
    WEEKLY_QUEST_MILESTONES
  );
  for (const ms of WEEKLY_QUEST_MILESTONES) {
    const key = questChestGrantKey("weeklies", ms);
    if (!weeklyClaimed.includes(ms) || granted.has(key)) continue;
    grants = mergeGrants(grants, WEEKLY_QUEST_CHEST_REWARDS[ms]?.grant);
    keys.push(key);
  }

  return { grants: grants && Object.keys(grants).length ? grants : null, keys };
}
