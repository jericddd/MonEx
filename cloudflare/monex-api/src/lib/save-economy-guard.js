/**
 * Server-side save PUT guards — blocks client economy inflation, quest forgery,
 * and invalid progression jumps while allowing legitimate per-save gameplay deltas.
 */

import {
  LIMITS,
  RARITY_ORDER,
  GEAR_SLOTS,
  sanitizeReleaseLog,
  sanitizeReleasedRecoveryIds,
} from "./save-validate.js";
import {
  mergeAccountBattleCompletions,
  maxAdventureGlobalFromCompletions,
  repairAdventurePlayhead,
  sanitizeAccountBattleCompletions,
} from "./battle-completion.js";
import { preservePatrolProgress } from "./patrol-attempt.js";
import {
  applyOneTimeDailyQuestResetIfNeeded,
  overlayMigratedDailyQuestState,
} from "./quest-one-time-reset.js";
import { applyQuestResetsToState } from "./quest-reset.js";
import {
  QUEST_TASK_DEFS,
  QUEST_TASK_GOALS,
  DAILY_QUEST_MILESTONES,
  WEEKLY_QUEST_MILESTONES,
  DAILY_QUEST_MAX_POINTS,
  WEEKLY_QUEST_MAX_POINTS,
  questGrantKey,
  questChestGrantKey,
  buildGrantFromTaskDef,
  DAILY_QUEST_CHEST_REWARDS,
  WEEKLY_QUEST_CHEST_REWARDS,
} from "./quest-rewards.js";

export { QUEST_TASK_GOALS };

/**
 * Max increase per accepted save PUT.
 * Economy / adventure progress are mutation-API only — PUT may decrease (spend)
 * but must not invent gains.
 */
export const MAX_SAVE_DELTA = {
  money: 0,
  essence: 0,
  monShards: 0,
  trainerXp: 0,
  monballs: 12,
  adventureGlobalBest: 0,
};

/** Max quest progress increase per save PUT (blocks progress: 9999 forgery). */
export const MAX_QUEST_PROGRESS_DELTA = 20;

/** Max quest points increase per save PUT. */
export const MAX_QUEST_POINTS_DELTA = 25;

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
export function reconcileQuestState(existing, incoming, options = {}) {
  const now = options.now ?? Date.now();
  const ex = existing?.questState && typeof existing.questState === "object" ? existing.questState : {};
  const inc = incoming?.questState && typeof incoming.questState === "object" ? incoming.questState : null;
  if (!inc) return incoming;

  const qs = {
    ...inc,
    dailyClaimedChests: [...(inc.dailyClaimedChests || [])],
    weeklyClaimedChests: [...(inc.weeklyClaimedChests || [])],
    grantedKeys: [...(inc.grantedKeys || [])],
    tasks: {
      dailies: (inc.tasks?.dailies || []).map((t) => ({ ...t })),
      weeklies: (inc.tasks?.weeklies || []).map((t) => ({ ...t })),
      campaign: (inc.tasks?.campaign || []).map((t) => ({ ...t })),
    },
  };
  const paidMap =
    incoming.questMonballPaidAmounts && typeof incoming.questMonballPaidAmounts === "object"
      ? { ...incoming.questMonballPaidAmounts }
      : {};
  const resetKind = applyQuestResetsToState(qs, new Date(now), {
    repairDesync: true,
    paidMap,
  });

  const existingKeys = new Set(
    Array.isArray(ex.grantedKeys) ? ex.grantedKeys.map(String) : []
  );
  const incomingKeys = new Set(
    Array.isArray(qs.grantedKeys) ? qs.grantedKeys.map(String) : []
  );
  const allowedKeys = new Set(existingKeys);

  const tasks = { dailies: [], weeklies: [], campaign: [] };
  const dailyResetChanged = qs.dailyResetKey != null && qs.dailyResetKey !== ex.dailyResetKey;
  const weeklyResetChanged = qs.weeklyResetKey != null && qs.weeklyResetKey !== ex.weeklyResetKey;

  for (const tab of ["dailies", "weeklies", "campaign"]) {
    const exTasks = new Map((ex.tasks?.[tab] || []).map((t) => [t.id, t]));
    const resetChanged = tab === "weeklies" ? weeklyResetChanged : tab === "dailies" ? dailyResetChanged : false;
    for (const task of qs.tasks?.[tab] || []) {
      const id = String(task.id || "");
      const goal = taskGoal(tab, id);
      const exTask = exTasks.get(id) || {};
      const exProgress = clampInt(exTask.progress ?? 0, 0, goal ?? 9999);
      let progress = clampInt(task.progress ?? 0, 0, goal ?? 9999);
      if (goal != null) progress = Math.min(progress, goal);
      if (!resetChanged) {
        progress = Math.max(exProgress, progress);
        if (progress > exProgress + MAX_QUEST_PROGRESS_DELTA) {
          progress = exProgress + MAX_QUEST_PROGRESS_DELTA;
        }
      }
      if (goal != null) progress = Math.min(progress, goal);
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
      if (resetChanged) continue;
      tasks[tab].push({
        id,
        progress: clampInt(exTask.progress ?? 0, 0, 9999),
        claimed: !!exTask.claimed || existingKeys.has(questGrantKey(tab, id)),
      });
    }
  }

  const dailyPoints = clampInt(qs.dailyPoints ?? ex.dailyPoints ?? 0, 0, DAILY_QUEST_MAX_POINTS);
  const weeklyPoints = clampInt(qs.weeklyPoints ?? ex.weeklyPoints ?? 0, 0, WEEKLY_QUEST_MAX_POINTS);
  const exDailyPoints = clampInt(ex.dailyPoints ?? 0, 0, DAILY_QUEST_MAX_POINTS);
  const exWeeklyPoints = clampInt(ex.weeklyPoints ?? 0, 0, WEEKLY_QUEST_MAX_POINTS);
  const cappedDailyPoints = dailyResetChanged
    ? dailyPoints
    : Math.min(dailyPoints, exDailyPoints + MAX_QUEST_POINTS_DELTA);
  const cappedWeeklyPoints = weeklyResetChanged
    ? weeklyPoints
    : Math.min(weeklyPoints, exWeeklyPoints + MAX_QUEST_POINTS_DELTA);

  const dailyClaimed = [];
  for (const ms of qs.dailyClaimedChests || []) {
    const milestone = clampInt(ms, 0, 100);
    if (!DAILY_QUEST_MILESTONES.includes(milestone)) continue;
    const key = questChestGrantKey("dailies", milestone);
    if (existingKeys.has(key)) {
      dailyClaimed.push(milestone);
      continue;
    }
    if (cappedDailyPoints >= milestone) {
      dailyClaimed.push(milestone);
      allowedKeys.add(key);
    }
  }
  for (const ms of ex.dailyClaimedChests || []) {
    if (dailyClaimed.includes(ms)) continue;
    if (existingKeys.has(questChestGrantKey("dailies", ms))) dailyClaimed.push(ms);
  }

  const weeklyClaimed = [];
  for (const ms of qs.weeklyClaimedChests || []) {
    const milestone = clampInt(ms, 0, 100);
    if (!WEEKLY_QUEST_MILESTONES.includes(milestone)) continue;
    const key = questChestGrantKey("weeklies", milestone);
    if (existingKeys.has(key)) {
      weeklyClaimed.push(milestone);
      continue;
    }
    if (cappedWeeklyPoints >= milestone) {
      weeklyClaimed.push(milestone);
      allowedKeys.add(key);
    }
  }
  for (const ms of ex.weeklyClaimedChests || []) {
    if (weeklyClaimed.includes(ms)) continue;
    if (existingKeys.has(questChestGrantKey("weeklies", ms))) weeklyClaimed.push(ms);
  }

  const out = {
    ...incoming,
    questState: {
      ...qs,
      tasks,
      dailyPoints: cappedDailyPoints,
      weeklyPoints: cappedWeeklyPoints,
      dailyClaimedChests: [...new Set(dailyClaimed)].sort((a, b) => a - b),
      weeklyClaimedChests: [...new Set(weeklyClaimed)].sort((a, b) => a - b),
      grantedKeys: [...allowedKeys].slice(0, 120),
    },
  };
  if (resetKind) {
    out.questMonballPaidAmounts = paidMap;
  }
  return out;
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
 * Block catastrophic inventory shrink on save PUT (cross-device stale overwrite).
 * Releases are one-at-a-time in the client, so a drop of more than maxRemoved
 * in a single PUT is treated as stale-client data loss and rejected.
 */
export const MAX_INVENTORY_SHRINK = 5;

export function clampInventoryShrink(existing, incoming, maxRemoved = MAX_INVENTORY_SHRINK) {
  const exParty = Array.isArray(existing?.party) ? existing.party : [];
  const exBox = Array.isArray(existing?.box) ? existing.box : [];
  const inParty = Array.isArray(incoming?.party) ? incoming.party : [];
  const inBox = Array.isArray(incoming?.box) ? incoming.box : [];
  const exCount = exParty.length + exBox.length;
  const inCount = inParty.length + inBox.length;
  if (exCount <= 0) return incoming;
  if (inCount >= exCount - maxRemoved) return incoming;
  return {
    ...incoming,
    party: exParty.slice(),
    box: exBox.slice(),
  };
}

function monIdentityKey(mon) {
  if (typeof mon?.instanceId === "string" && mon.instanceId.trim()) return mon.instanceId.trim();
  if (typeof mon?.wildPendingId === "string" && mon.wildPendingId.trim()) return mon.wildPendingId.trim();
  return null;
}

/** Per-mon progress floor from existing inventory — blocks stale tabs from regressing levels. */
export function buildMonProgressIndex(party, box) {
  const index = new Map();
  for (const mon of [...(party || []), ...(box || [])]) {
    const key = monIdentityKey(mon);
    if (!key) continue;
    const prev = index.get(key) || { level: 1, ascensionStars: 0 };
    index.set(key, {
      level: Math.max(prev.level, Math.max(1, Math.floor(Number(mon.level) || 1))),
      ascensionStars: Math.max(
        prev.ascensionStars,
        Math.max(0, Math.floor(Number(mon.ascensionStars) || 0))
      ),
    });
  }
  return index;
}

function applyMonProgressFloor(mon, progressIndex) {
  const key = monIdentityKey(mon);
  if (!key || !progressIndex.has(key)) return mon;
  const floor = progressIndex.get(key);
  const level = Math.max(1, Math.floor(Number(mon.level) || 1));
  const ascensionStars = Math.max(0, Math.floor(Number(mon.ascensionStars) || 0));
  if (level >= floor.level && ascensionStars >= floor.ascensionStars) return mon;
  return {
    ...mon,
    level: Math.max(level, floor.level),
    ascensionStars: Math.max(ascensionStars, floor.ascensionStars),
  };
}

export function preserveMonProgress(existing, incoming) {
  const progressIndex = buildMonProgressIndex(existing?.party, existing?.box);
  if (!progressIndex.size) return incoming;
  return {
    ...incoming,
    party: (incoming?.party || []).map((mon) => applyMonProgressFloor(mon, progressIndex)),
    box: (incoming?.box || []).map((mon) => applyMonProgressFloor(mon, progressIndex)),
  };
}

function rarityRank(rarity) {
  const idx = RARITY_ORDER.indexOf(rarity);
  return idx >= 0 ? idx : 0;
}

/**
 * Full-save PUT must never invent upgrades. Level / stars / rarity may only rise
 * via server mutation APIs (POST /api/mon/level-up, /api/mon/ascend-rarity).
 * New mons (unknown identity) keep their incoming progress.
 */
function applyMonProgressCeiling(mon, progressIndex) {
  const key = monIdentityKey(mon);
  if (!key || !progressIndex.has(key)) return mon;
  const ceiling = progressIndex.get(key);
  const level = Math.max(1, Math.floor(Number(mon.level) || 1));
  const ascensionStars = Math.max(0, Math.floor(Number(mon.ascensionStars) || 0));
  const rarity = RARITY_ORDER.includes(mon.rarity) ? mon.rarity : "Common";
  const ceilingRarity = RARITY_ORDER.includes(ceiling.rarity) ? ceiling.rarity : "Common";

  let next = mon;
  if (level > ceiling.level) {
    next = { ...next, level: ceiling.level };
  }
  if (ascensionStars > ceiling.ascensionStars) {
    next = { ...next, ascensionStars: ceiling.ascensionStars };
  }
  if (rarityRank(rarity) > rarityRank(ceilingRarity)) {
    next = { ...next, rarity: ceilingRarity };
  }
  return next;
}

export function buildMonProgressCeilingIndex(party, box) {
  const index = new Map();
  for (const mon of [...(party || []), ...(box || [])]) {
    const key = monIdentityKey(mon);
    if (!key) continue;
    const prev = index.get(key) || { level: 1, ascensionStars: 0, rarity: "Common" };
    const rarity = RARITY_ORDER.includes(mon.rarity) ? mon.rarity : "Common";
    const prevRarity = RARITY_ORDER.includes(prev.rarity) ? prev.rarity : "Common";
    index.set(key, {
      level: Math.max(prev.level, Math.max(1, Math.floor(Number(mon.level) || 1))),
      ascensionStars: Math.max(
        prev.ascensionStars,
        Math.max(0, Math.floor(Number(mon.ascensionStars) || 0))
      ),
      rarity: rarityRank(rarity) >= rarityRank(prevRarity) ? rarity : prevRarity,
    });
  }
  return index;
}

export function clampMonProgressCeiling(existing, incoming) {
  const progressIndex = buildMonProgressCeilingIndex(existing?.party, existing?.box);
  if (!progressIndex.size) return incoming;
  return {
    ...incoming,
    party: (incoming?.party || []).map((mon) => applyMonProgressCeiling(mon, progressIndex)),
    box: (incoming?.box || []).map((mon) => applyMonProgressCeiling(mon, progressIndex)),
  };
}

function overlayMonScalars(baseMon, incomingMon) {
  if (!incomingMon) return baseMon;
  const next = { ...baseMon };
  // Allow HP/mana combat writebacks via PUT; layout/equipment/progress come from mutation APIs.
  if (incomingMon.current_hp != null) next.current_hp = incomingMon.current_hp;
  if (incomingMon.max_hp != null) next.max_hp = incomingMon.max_hp;
  if (incomingMon.current_mana != null) next.current_mana = incomingMon.current_mana;
  if (incomingMon.max_mana != null) next.max_mana = incomingMon.max_mana;
  // Keep server equipment / stars / level / rarity (already floored/ceilinged elsewhere).
  next.equipment = baseMon.equipment;
  next.level = baseMon.level;
  next.rarity = baseMon.rarity;
  next.ascensionStars = baseMon.ascensionStars;
  if (baseMon.ascensionSkillPending) next.ascensionSkillPending = baseMon.ascensionSkillPending;
  if (baseMon.skills) next.skills = baseMon.skills;
  if (baseMon.ultimate) next.ultimate = baseMon.ultimate;
  return next;
}

/**
 * Full-save PUT cannot rearrange party/box seats or change equipment loadouts.
 * Mutation APIs write those changes directly.
 * Removals are allowed only when the mon is in the release blocklist.
 */
export function preserveInventoryLayout(existing, incoming) {
  const exParty = Array.isArray(existing?.party) ? existing.party : [];
  const exBox = Array.isArray(existing?.box) ? existing.box : [];

  // Gear enhance levels: never raise via PUT for known gear ids.
  // New gear ids cannot be invented via PUT (battle/chest/shop/synth APIs only).
  const enhanceCeiling = new Map();
  const knownGearIds = new Set();
  const indexGear = (gear) => {
    if (!gear?.id) return;
    knownGearIds.add(gear.id);
    const lvl = Math.max(0, Math.floor(Number(gear.enhanceLevel) || 0));
    enhanceCeiling.set(gear.id, Math.max(enhanceCeiling.get(gear.id) || 0, lvl));
  };
  for (const mon of [...exParty, ...exBox]) {
    for (const slot of GEAR_SLOTS) indexGear(mon?.equipment?.[slot]);
  }
  for (const gear of existing?.gearInventory || []) indexGear(gear);

  const clampGearEnhance = (gear) => {
    if (!gear?.id || !enhanceCeiling.has(gear.id)) return gear;
    const ceiling = enhanceCeiling.get(gear.id);
    const lvl = Math.max(0, Math.floor(Number(gear.enhanceLevel) || 0));
    if (lvl <= ceiling) return gear;
    return { ...gear, enhanceLevel: ceiling };
  };

  const nextBag = (incoming?.gearInventory || [])
    .filter((gear) => gear?.id && knownGearIds.has(gear.id))
    .map(clampGearEnhance);

  if (!exParty.length && !exBox.length) {
    return { ...incoming, gearInventory: nextBag };
  }

  const incomingByKey = new Map();
  for (const mon of [...(incoming?.party || []), ...(incoming?.box || [])]) {
    const key = monIdentityKey(mon);
    if (key) incomingByKey.set(key, mon);
  }

  const released = buildReleasedIdSet(existing, incoming);
  const mapList = (list) => (list || [])
    .filter((mon) => {
      const key = monIdentityKey(mon);
      if (key && released.has(key)) return false;
      return true;
    })
    .map((mon) => {
      const key = monIdentityKey(mon);
      return overlayMonScalars(mon, key ? incomingByKey.get(key) : null);
    });

  return {
    ...incoming,
    party: mapList(exParty),
    box: mapList(exBox),
    gearInventory: nextBag,
  };
}

/**
 * Trainer reward level is settled server-side with level bonuses — PUT cannot advance it.
 */
export function clampTrainerRewardLevel(existing, incoming) {
  const before = clampInt(existing?.trainerRewardLevel ?? 1, 1, 9999);
  const raw = clampInt(incoming?.trainerRewardLevel ?? before, 1, 9999);
  if (raw <= before) return { ...incoming, trainerRewardLevel: raw };
  return { ...incoming, trainerRewardLevel: before };
}

/**
 * Append-only merge for release history. New entries from the client are kept;
 * existing server log entries are never dropped by a stale tab.
 */
export function mergeReleaseLog(existing, incoming) {
  const prior = sanitizeReleaseLog(existing?.releaseLog);
  const next = sanitizeReleaseLog(incoming?.releaseLog);
  const seen = new Set(prior.map((entry) => entry.id));
  const merged = [...prior];
  for (const entry of next) {
    if (seen.has(entry.id)) continue;
    merged.push(entry);
    seen.add(entry.id);
  }
  return merged
    .sort((a, b) => Date.parse(b.at || "") - Date.parse(a.at || ""))
    .slice(0, LIMITS.releaseLogMax);
}

/**
 * Append-only merge for released recovery ids. Once a mon is released, its
 * recovery keys must never be re-imported from the activity log.
 */
export function mergeReleasedRecoveryIds(existing, incoming) {
  const prior = sanitizeReleasedRecoveryIds(existing?.releasedRecoveryIds);
  const next = sanitizeReleasedRecoveryIds(incoming?.releasedRecoveryIds);
  const seen = new Set(prior);
  const merged = [...prior];
  for (const id of next) {
    if (seen.has(id)) continue;
    merged.push(id);
    seen.add(id);
  }
  return merged.slice(0, LIMITS.releasedRecoveryIdsMax);
}

function monPersistenceKeys(mon) {
  const keys = [];
  if (typeof mon?.instanceId === "string" && mon.instanceId.trim()) keys.push(mon.instanceId.trim());
  if (typeof mon?.wildPendingId === "string" && mon.wildPendingId.trim()) keys.push(mon.wildPendingId.trim());
  return keys;
}

function buildReleasedIdSet(existing, incoming) {
  const released = new Set(mergeReleasedRecoveryIds(existing, incoming));
  for (const entry of mergeReleaseLog(existing, incoming)) {
    if (entry.recoveryId) released.add(entry.recoveryId);
    if (entry.instanceId) released.add(entry.instanceId);
    const match = String(entry.recoveryId || "").match(/^recovery_(.+)_(\d+)$/);
    if (match) released.add(`activity:${match[1]}:${match[2]}`);
  }
  return released;
}

/**
 * Stale full-save PUTs must never re-add Mons the player already released.
 * Strip any inventory member whose persistence keys appear in the release blocklist.
 */
export function stripReleasedMonsFromInventory(existing, incoming) {
  const released = buildReleasedIdSet(existing, incoming);
  if (!released.size) return incoming;
  const keepMon = (mon) => !monPersistenceKeys(mon).some((key) => released.has(key));
  return {
    ...incoming,
    party: (incoming?.party || []).filter(keepMon),
    box: (incoming?.box || []).filter(keepMon),
  };
}

/**
 * Battle completion ledger and adventure progress cannot regress on client PUT.
 */
export function preserveBattleCompletionState(existing, incoming, now = Date.now()) {
  const ex = existing && typeof existing === "object" ? existing : {};
  const inc = incoming && typeof incoming === "object" ? incoming : {};
  const mergedCompletions = mergeAccountBattleCompletions(ex.accountBattleCompletions, inc.accountBattleCompletions);
  const floorGlobal = maxAdventureGlobalFromCompletions(mergedCompletions);
  let out = {
    ...inc,
    accountBattleCompletions: mergedCompletions,
  };

  const beforeBest = clampInt(ex.adventureGlobalBest ?? 0, 0, 99_999);
  const rawBest = clampInt(inc.adventureGlobalBest ?? beforeBest, 0, 99_999);
  const minBest = Math.max(beforeBest, floorGlobal);
  if (rawBest < minBest) {
    out.adventureGlobalBest = minBest;
  }

  out = preservePatrolProgress(ex, out, now, mergedCompletions);

  return repairAdventurePlayhead(out).save;
}

/**
 * Apply all server-side save guards before persist.
 */
export function guardSavePayload(existing, incoming, options = {}) {
  if (!incoming || typeof incoming !== "object") return incoming;
  const now = options.now ?? Date.now();
  let ex = existing && typeof existing === "object" ? existing : {};
  const oneTimeReset = applyOneTimeDailyQuestResetIfNeeded(ex, new Date(now));
  if (oneTimeReset.changed) ex = oneTimeReset.save;

  let out = { ...incoming };
  out = preserveBattleCompletionState(ex, out, options.now ?? Date.now());
  out = clampEconomyScalars(ex, out);
  out = clampAdventureProgress(ex, out);
  out = clampTrainerRewardLevel(ex, out);
  out = clampResourceChestTimestamp(ex, out, options.now);
  out = reconcileQuestState(ex, out, options);
  out = clampInventoryGrowth(ex, out);
  out = clampInventoryShrink(ex, out);
  // Floor first (block stale regress), then ceiling (block client-forged upgrades).
  out = preserveMonProgress(ex, out);
  out = clampMonProgressCeiling(ex, out);
  // Seats + equipment are mutation-API only — PUT may only overlay combat scalars.
  out = preserveInventoryLayout(ex, out);
  out.releaseLog = mergeReleaseLog(ex, out);
  out.releasedRecoveryIds = mergeReleasedRecoveryIds(ex, out);
  out = stripReleasedMonsFromInventory(ex, out);
  if (oneTimeReset.changed) {
    out = overlayMigratedDailyQuestState(ex, out);
  }
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
