/** Quest reward definitions and helpers (mirrors play/index.html). */

export const DAILY_QUEST_MILESTONES = [20, 40, 60, 80, 100];
export const WEEKLY_QUEST_MILESTONES = [20, 40, 60, 80, 100];

export const DAILY_QUEST_CHEST_REWARDS = {
  20: { label: "100 Gold", grant: { gold: 100 } },
  40: { label: "15 KB's Onion", grant: { essence: 15 } },
  60: { label: "1 Monball + 20 Trainer XP", grant: { monballs: 1, trainerXp: 20 } },
  80: { label: "2 Shards", grant: { monShards: 2 } },
  100: { label: "250 Gold + 25 Onion + 50 Trainer XP", grant: { gold: 250, essence: 25, trainerXp: 50 } },
};

export const WEEKLY_QUEST_CHEST_REWARDS = {
  20: { label: "300 Gold", grant: { gold: 300 } },
  40: { label: "40 KB's Onion", grant: { essence: 40 } },
  60: { label: "4 Monballs + 60 Trainer XP", grant: { monballs: 4, trainerXp: 60 } },
  80: { label: "6 Shards", grant: { monShards: 6 } },
  100: { label: "600 Gold + 60 Onion + 120 Trainer XP + 2 Monballs", grant: { gold: 600, essence: 60, trainerXp: 120, monballs: 2 } },
};

/** @deprecated Use DAILY_QUEST_MILESTONES */
export const QUEST_MILESTONES = DAILY_QUEST_MILESTONES;

/** @deprecated Use DAILY_QUEST_CHEST_REWARDS */
export const QUEST_CHEST_REWARDS = DAILY_QUEST_CHEST_REWARDS;

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
  ],
  weeklies: [
    { id: "w1", points: 20, rewardKey: "gold", rewardAmount: 250 },
    { id: "w2", points: 15, rewardKey: "essence", rewardAmount: 25 },
    { id: "w3", points: 15, rewardKey: "shards", rewardAmount: 3 },
    { id: "w4", points: 15, rewardKey: "gold", rewardAmount: 200 },
  ],
  campaign: [
    { id: "c1", points: 15, rewardKey: "monball", rewardAmount: 2 },
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
