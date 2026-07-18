/**
 * Server-authoritative mon level-up + rarity ascend.
 * Spend + progress mutate atomically under revision CAS (shop-purchase pattern).
 * Client PUT /api/save must not be able to raise levels/rarity (see clampMonProgressCeiling).
 */

import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";
import { QUEST_TASK_GOALS } from "./save-economy-guard.js";
import { RARITY_ORDER } from "./save-validate.js";

const MAX_MUTATION_RETRIES = 3;

const LEVEL_CAP_BY_RARITY = Object.freeze({
  Common: 20,
  Uncommon: 30,
  Rare: 40,
  Legendary: 60,
  Mythic: 80,
});

/** Legendary → Mythic shard cost (mirrors play/index.html ASCEND_SHARD_COST). */
const ASCEND_SHARD_COST = Object.freeze({
  Legendary: 40,
});

/** Quest tasks tracked by mon_level_up (mirrors play QUEST_TASK_DEFS). */
const MON_LEVEL_UP_TASKS = Object.freeze([
  { tab: "dailies", id: "d2" },
  { tab: "dailies", id: "d12" },
  { tab: "weeklies", id: "w10" },
]);

export function getLevelCap(rarity) {
  return LEVEL_CAP_BY_RARITY[rarity] || 20;
}

/** Cost to go from current level → level+1 (paid at current level). */
export function getLevelCost(level) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  return { gold: 50 * lvl, essence: 5 + lvl * 3 };
}

export function getAscendShardCost(rarity) {
  return ASCEND_SHARD_COST[rarity] ?? null;
}

function monIdentityKey(mon) {
  if (typeof mon?.instanceId === "string" && mon.instanceId.trim()) return mon.instanceId.trim();
  if (typeof mon?.wildPendingId === "string" && mon.wildPendingId.trim()) return mon.wildPendingId.trim();
  return null;
}

function findMonInSave(save, { instanceId, wildPendingId, partyIndex } = {}) {
  const party = Array.isArray(save?.party) ? save.party : [];
  const box = Array.isArray(save?.box) ? save.box : [];
  const wantInstance = typeof instanceId === "string" ? instanceId.trim() : "";
  const wantPending = typeof wildPendingId === "string" ? wildPendingId.trim() : "";

  const match = (mon) => {
    if (!mon) return false;
    if (wantInstance && monIdentityKey(mon) === wantInstance) return true;
    if (wantPending && typeof mon.wildPendingId === "string" && mon.wildPendingId.trim() === wantPending) {
      return true;
    }
    return false;
  };

  if (wantInstance || wantPending) {
    for (let i = 0; i < party.length; i++) {
      if (match(party[i])) return { list: "party", index: i, mon: party[i] };
    }
    for (let i = 0; i < box.length; i++) {
      if (match(box[i])) return { list: "box", index: i, mon: box[i] };
    }
    return null;
  }

  const idx = Math.floor(Number(partyIndex));
  if (Number.isFinite(idx) && idx >= 0 && idx < party.length && party[idx]) {
    return { list: "party", index: idx, mon: party[idx] };
  }
  return null;
}

function bumpMonLevelUpQuestProgress(questState, amount = 1) {
  const qs = questState && typeof questState === "object" ? { ...questState } : {};
  const tasks = {
    dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
    weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
    campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
  };
  const add = Math.max(1, Math.floor(Number(amount) || 1));
  for (const { tab, id } of MON_LEVEL_UP_TASKS) {
    const goal = QUEST_TASK_GOALS[tab]?.[id] ?? 1;
    const list = tasks[tab];
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

function replaceMonInSave(save, location, nextMon) {
  const party = [...(save.party || [])];
  const box = [...(save.box || [])];
  if (location.list === "party") party[location.index] = nextMon;
  else box[location.index] = nextMon;
  return { ...save, party, box };
}

/** Apply one level-up onto a save snapshot (initial + conflict retry). */
export function applyMonLevelUpToSave(save, target) {
  if (!save || typeof save !== "object") return { ok: false, error: "invalid_save" };
  const found = findMonInSave(save, target);
  if (!found) return { ok: false, error: "mon_not_found" };

  const mon = { ...found.mon };
  const rarity = RARITY_ORDER.includes(mon.rarity) ? mon.rarity : "Common";
  const level = Math.max(1, Math.floor(Number(mon.level) || 1));
  const cap = getLevelCap(rarity);
  if (level >= cap) return { ok: false, error: "max_level" };

  const cost = getLevelCost(level);
  const money = Math.max(0, Math.floor(Number(save.money) || 0));
  const essence = Math.max(0, Math.floor(Number(save.essence) || 0));
  if (money < cost.gold || essence < cost.essence) {
    return { ok: false, error: "insufficient_funds", cost };
  }

  const nextLevel = level + 1;
  const maxHp = Math.max(1, Math.floor(Number(mon.max_hp) || 1));
  const nextMon = {
    ...mon,
    rarity,
    level: nextLevel,
    current_hp: maxHp,
  };

  let nextSave = replaceMonInSave(save, found, nextMon);
  nextSave = {
    ...nextSave,
    money: money - cost.gold,
    essence: essence - cost.essence,
    questState: bumpMonLevelUpQuestProgress(nextSave.questState, 1),
  };

  return {
    ok: true,
    save: nextSave,
    cost,
    mon: {
      instanceId: nextMon.instanceId || null,
      wildPendingId: nextMon.wildPendingId || null,
      name: nextMon.name,
      level: nextLevel,
      rarity,
      list: found.list,
      index: found.index,
    },
  };
}

/** Apply Legendary→Mythic rarity ascend onto a save snapshot. */
export function applyMonRarityAscendToSave(save, target) {
  if (!save || typeof save !== "object") return { ok: false, error: "invalid_save" };
  const found = findMonInSave(save, target);
  if (!found) return { ok: false, error: "mon_not_found" };

  const mon = { ...found.mon };
  const rarity = RARITY_ORDER.includes(mon.rarity) ? mon.rarity : "Common";
  const cost = getAscendShardCost(rarity);
  if (cost == null) return { ok: false, error: "cannot_ascend" };

  const level = Math.max(1, Math.floor(Number(mon.level) || 1));
  const cap = getLevelCap(rarity);
  if (level < cap) return { ok: false, error: "level_cap_required", cap };

  const rarityIdx = RARITY_ORDER.indexOf(rarity);
  const nextRarity = rarityIdx >= 0 && rarityIdx < RARITY_ORDER.length - 1
    ? RARITY_ORDER[rarityIdx + 1]
    : null;
  if (!nextRarity) return { ok: false, error: "cannot_ascend" };

  const monShards = Math.max(0, Math.floor(Number(save.monShards) || 0));
  if (monShards < cost) {
    return { ok: false, error: "insufficient_funds", cost: { monShards: cost } };
  }

  const maxHp = Math.max(1, Math.floor(Number(mon.max_hp) || 1));
  const nextMon = {
    ...mon,
    rarity: nextRarity,
    current_hp: maxHp,
  };

  const nextSave = {
    ...replaceMonInSave(save, found, nextMon),
    monShards: monShards - cost,
  };

  return {
    ok: true,
    save: nextSave,
    cost: { monShards: cost },
    mon: {
      instanceId: nextMon.instanceId || null,
      wildPendingId: nextMon.wildPendingId || null,
      name: nextMon.name,
      level,
      rarity: nextRarity,
      list: found.list,
      index: found.index,
    },
  };
}

async function persistMutationSave(kv, session, save, expectedRevision, startingMonballs) {
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
    if (err?.code === "revision_conflict") {
      return {
        ok: false,
        error: "revision_conflict",
        existingSave: err.existingSave,
        currentRevision: err.currentRevision,
      };
    }
    throw err;
  }
}

async function runMonMutation(kv, session, { expectedRevision, startingMonballs, apply }) {
  let expectedRev =
    expectedRevision != null && Number.isFinite(Number(expectedRevision))
      ? Number(expectedRevision)
      : null;

  for (let attempt = 0; attempt <= MAX_MUTATION_RETRIES; attempt++) {
    const { save } = await loadCloudSave(kv, session.xUserId);
    if (expectedRev == null) {
      expectedRev = Number.isFinite(Number(save?.revision)) ? Number(save.revision) : 0;
    }

    const applied = apply(save);
    if (!applied.ok) return applied;

    const persisted = await persistMutationSave(
      kv,
      session,
      applied.save,
      expectedRev,
      startingMonballs
    );

    if (persisted.ok) {
      return {
        ok: true,
        cost: applied.cost,
        mon: applied.mon,
        save: persisted.save,
      };
    }

    if (persisted.error !== "revision_conflict" || attempt >= MAX_MUTATION_RETRIES) {
      return {
        ok: false,
        error: "upgrade_conflict",
        save: persisted.existingSave,
      };
    }

    expectedRev = persisted.currentRevision ?? persisted.existingSave?.revision ?? expectedRev;
  }

  return { ok: false, error: "upgrade_conflict" };
}

export async function levelUpMon(kv, session, target, options = {}) {
  const startingMonballs = options.startingMonballs ?? 10;
  const expectedRevision = options.expectedRevision;
  return runMonMutation(kv, session, {
    expectedRevision,
    startingMonballs,
    apply: (save) => applyMonLevelUpToSave(save, target || {}),
  });
}

export async function ascendMonRarity(kv, session, target, options = {}) {
  const startingMonballs = options.startingMonballs ?? 10;
  const expectedRevision = options.expectedRevision;
  return runMonMutation(kv, session, {
    expectedRevision,
    startingMonballs,
    apply: (save) => applyMonRarityAscendToSave(save, target || {}),
  });
}
