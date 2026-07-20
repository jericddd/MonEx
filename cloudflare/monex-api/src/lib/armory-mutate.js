/**
 * Server-authoritative armory mutations (hero ascend, enhance, synth, skill unlock).
 * RNG is rolled on the server so spend + outcome stay atomic.
 */
import { runSaveMutation, monIdentityKey, findMonInSave } from "./save-mutation.js";
import { generateShopGear } from "./shop-gear.js";
import { GEAR_SLOTS, RARITY_ORDER, sanitizeGear } from "./save-validate.js";
import { QUEST_TASK_GOALS } from "./save-economy-guard.js";

const GEAR_ENHANCE_MAX = 21;
const GEAR_ENHANCE_SUCCESS_RATE = [
  100, 100, 100, 100, 100,
  65, 50, 35, 20, 15,
  40, 38, 35, 32, 28, 25, 22, 20, 18, 16,
  12,
];
const GEAR_ENHANCE_FAIL_DROP = [
  null, null, null, null, null,
  4, 4, 4, 4, 4,
  10, 10,
  10, 10, 10, 10, 10, 10, 10, 10,
  20,
];
const GEAR_ENHANCE_GOLD = [
  0, 150, 400, 900, 2200, 5500, 12000, 18000, 26000, 36000, 50000, 70000, 95000,
  125000, 160000, 200000, 250000, 310000, 380000, 460000, 550000,
];

const GEAR_SYNTH_UPGRADE_RATE = 0.75;
const GEAR_SYNTH_REROLL_RATE = 0.9;
const GEAR_SYNTH_REROLL_LOW_RATE = 0.75;
const GEAR_SYNTH_UPGRADE_GOLD = [0, 1000, 2500, 6000, 15000];
const GEAR_SYNTH_REROLL_GOLD = [0, 0, 800, 2000, 5000, 12000];

const HERO_ASCENSION_DUPES_BY_LEVEL = [2, 4, 5, 5, 5, 6];
const HERO_ASCENSION_DUPES_MAX = 6;
const HERO_ASCENSION_SUCCESS_RATE = 0.75;
const HERO_ASCENSION_GOLD_BASE = 2000;
const HERO_ASCENSION_GOLD_STEP = 1500;
const HERO_SKILL_UNLOCK_GOLD = 500;

const ARMORY_FORGE_TASKS = Object.freeze([
  { tab: "dailies", id: "d9" },
  { tab: "weeklies", id: "w3" },
  { tab: "weeklies", id: "w8" },
]);

function rarityRank(rarity) {
  const idx = RARITY_ORDER.indexOf(rarity);
  return idx >= 0 ? idx : 0;
}

function isLegendaryOrAbove(rarity) {
  return rarityRank(rarity) >= rarityRank("Legendary");
}

function getHeroAscensionDupeRequirement(stars) {
  const idx = Math.max(0, Math.floor(Number(stars) || 0));
  if (idx >= HERO_ASCENSION_DUPES_BY_LEVEL.length) return HERO_ASCENSION_DUPES_MAX;
  return HERO_ASCENSION_DUPES_BY_LEVEL[idx];
}

function getHeroAscensionGoldCost(level) {
  return HERO_ASCENSION_GOLD_BASE + (level || 0) * HERO_ASCENSION_GOLD_STEP;
}

function getGearEnhanceGoldCost(gear) {
  const tier = Math.max(1, Math.floor(Number(gear?.tier) || 1));
  const level = Math.max(0, Math.floor(Number(gear?.enhanceLevel) || 0));
  if (level >= GEAR_ENHANCE_MAX) return 0;
  const base = GEAR_ENHANCE_GOLD[tier] || GEAR_ENHANCE_GOLD[1];
  return Math.floor(base * (level + 1) * (1 + tier * 0.15));
}

function bumpArmoryQuest(questState, amount = 1) {
  const qs = questState && typeof questState === "object" ? { ...questState } : {};
  const tasks = {
    dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
    weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
    campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
  };
  const add = Math.max(1, Math.floor(Number(amount) || 1));
  for (const { tab, id } of ARMORY_FORGE_TASKS) {
    const goal = QUEST_TASK_GOALS[tab]?.[id] ?? 1;
    const list = tasks[tab];
    const idx = list.findIndex((t) => t?.id === id);
    if (idx >= 0) {
      const task = list[idx];
      if (task.claimed) continue;
      list[idx] = { ...task, progress: Math.min(goal, (task.progress || 0) + add) };
    } else {
      list.push({ id, progress: Math.min(goal, add), claimed: false });
    }
  }
  return { ...qs, tasks };
}

function removeMonsByIds(save, instanceIds) {
  const remove = new Set((instanceIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const party = [];
  const box = [];
  let gearInventory = [...(save.gearInventory || [])];
  for (const mon of save.party || []) {
    const key = monIdentityKey(mon);
    if (key && remove.has(key)) {
      for (const slot of GEAR_SLOTS) {
        const gear = sanitizeGear(mon?.equipment?.[slot]);
        if (gear) gearInventory.push(gear);
      }
      continue;
    }
    party.push(mon);
  }
  for (const mon of save.box || []) {
    const key = monIdentityKey(mon);
    if (key && remove.has(key)) {
      for (const slot of GEAR_SLOTS) {
        const gear = sanitizeGear(mon?.equipment?.[slot]);
        if (gear) gearInventory.push(gear);
      }
      continue;
    }
    box.push(mon);
  }
  return { ...save, party, box, gearInventory };
}

function replaceMon(save, location, nextMon) {
  const party = [...(save.party || [])];
  const box = [...(save.box || [])];
  if (location.list === "party") party[location.index] = nextMon;
  else box[location.index] = nextMon;
  return { ...save, party, box };
}

export function applyHeroAscensionToSave(save, { mainInstanceId, dupeInstanceIds } = {}) {
  const mainLoc = findMonInSave(save, { instanceId: mainInstanceId });
  if (!mainLoc) return { ok: false, error: "main_not_found" };
  const main = mainLoc.mon;
  if (!isLegendaryOrAbove(main.rarity)) return { ok: false, error: "not_legendary" };
  if (Array.isArray(main.ascensionSkillPending) && main.ascensionSkillPending.length) {
    return { ok: false, error: "pending_skill" };
  }

  const stars = Math.max(0, Math.floor(Number(main.ascensionStars) || 0));
  const required = getHeroAscensionDupeRequirement(stars);
  const dupeIds = Array.isArray(dupeInstanceIds)
    ? dupeInstanceIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (dupeIds.length !== required) return { ok: false, error: "invalid_dupes" };
  if (dupeIds.includes(String(mainInstanceId || "").trim())) return { ok: false, error: "invalid_dupes" };

  for (const id of dupeIds) {
    const loc = findMonInSave(save, { instanceId: id });
    if (!loc) return { ok: false, error: "dupe_not_found" };
    if (loc.mon.name !== main.name) return { ok: false, error: "dupe_species_mismatch" };
  }

  const goldCost = getHeroAscensionGoldCost(stars);
  const money = Math.max(0, Math.floor(Number(save.money) || 0));
  if (money < goldCost) return { ok: false, error: "insufficient_funds", cost: { gold: goldCost } };

  let next = removeMonsByIds(save, dupeIds);
  // Re-find main after remaps (index may shift if dupes were before it in party).
  const mainAfter = findMonInSave(next, { instanceId: mainInstanceId });
  if (!mainAfter) return { ok: false, error: "main_not_found" };

  next = { ...next, money: money - goldCost };
  const success = Math.random() < HERO_ASCENSION_SUCCESS_RATE;
  if (success) {
    const ascended = {
      ...mainAfter.mon,
      ascensionStars: stars + 1,
    };
    next = replaceMon(next, mainAfter, ascended);
    return {
      ok: true,
      save: next,
      success: true,
      cost: { gold: goldCost },
      mon: { instanceId: mainInstanceId, ascensionStars: ascended.ascensionStars },
    };
  }
  return {
    ok: true,
    save: next,
    success: false,
    cost: { gold: goldCost },
    mon: { instanceId: mainInstanceId, ascensionStars: stars },
  };
}

export function applyUnlockAscensionSkillToSave(save, { instanceId, skillIndex = 0 } = {}) {
  const found = findMonInSave(save, { instanceId });
  if (!found) return { ok: false, error: "mon_not_found" };
  const pending = Array.isArray(found.mon.ascensionSkillPending) ? found.mon.ascensionSkillPending : [];
  if (!pending.length) return { ok: false, error: "no_pending_skill" };
  const idx = Math.max(0, Math.floor(Number(skillIndex) || 0));
  const skill = pending[idx];
  if (!skill) return { ok: false, error: "invalid_skill" };

  const freePick = !!found.mon.ascensionSkillFreePick;
  const money = Math.max(0, Math.floor(Number(save.money) || 0));
  if (!freePick && money < HERO_SKILL_UNLOCK_GOLD) {
    return { ok: false, error: "insufficient_funds", cost: { gold: HERO_SKILL_UNLOCK_GOLD } };
  }

  const skills = Array.isArray(found.mon.skills) ? [...found.mon.skills] : [];
  if (skills.some((s) => s?.name === skill.name)) return { ok: false, error: "skill_already_known" };
  skills.push({ ...skill });

  const nextMon = { ...found.mon, skills };
  delete nextMon.ascensionSkillPending;
  delete nextMon.ascensionSkillFreePick;

  let next = replaceMon(save, found, nextMon);
  if (!freePick) next = { ...next, money: money - HERO_SKILL_UNLOCK_GOLD };
  return {
    ok: true,
    save: next,
    cost: freePick ? { gold: 0 } : { gold: HERO_SKILL_UNLOCK_GOLD },
  };
}

export function applyGearEnhanceToSave(save, { gearId } = {}) {
  const inventory = [...(save.gearInventory || [])];
  const idx = inventory.findIndex((g) => g?.id === gearId);
  if (idx < 0) return { ok: false, error: "gear_not_found" };
  const gear = { ...sanitizeGear(inventory[idx]) };
  if (!gear) return { ok: false, error: "invalid_gear" };

  const level = Math.max(0, Math.floor(Number(gear.enhanceLevel) || 0));
  if (level >= GEAR_ENHANCE_MAX) return { ok: false, error: "max_enhance" };

  const goldCost = getGearEnhanceGoldCost(gear);
  const money = Math.max(0, Math.floor(Number(save.money) || 0));
  if (money < goldCost) return { ok: false, error: "insufficient_funds", cost: { gold: goldCost } };

  const rate = GEAR_ENHANCE_SUCCESS_RATE[level] ?? 20;
  const failDrop = GEAR_ENHANCE_FAIL_DROP[level] ?? null;
  const success = Math.random() * 100 < rate;
  if (success) {
    gear.enhanceLevel = level + 1;
  } else if (failDrop != null && level > failDrop) {
    gear.enhanceLevel = failDrop;
  }

  inventory[idx] = gear;
  return {
    ok: true,
    save: {
      ...save,
      money: money - goldCost,
      gearInventory: inventory,
      questState: bumpArmoryQuest(save.questState, 1),
    },
    success,
    cost: { gold: goldCost },
    gear,
  };
}

function analyzeSynth(slots) {
  const main = slots[0];
  const cat1 = slots[1];
  const cat2 = slots[2];
  if (!main || !cat1 || !cat2) return null;
  const allSame = main.tier === cat1.tier && main.tier === cat2.tier;
  if (allSame && main.tier < 5) {
    return {
      type: "upgrade",
      resultTier: main.tier + 1,
      rate: GEAR_SYNTH_UPGRADE_RATE,
      gold: GEAR_SYNTH_UPGRADE_GOLD[main.tier] || 0,
      house: main.house,
      gearLevelTier: main.gearLevelTier || 1,
    };
  }
  if (main.tier >= 2) {
    const catalystTier = main.tier >= 4 ? 2 : 1;
    if (cat1.tier === catalystTier && cat2.tier === catalystTier) {
      return {
        type: "reroll",
        resultTier: main.tier,
        slot: main.slot,
        rate: GEAR_SYNTH_REROLL_RATE,
        gold: GEAR_SYNTH_REROLL_GOLD[main.tier] || 0,
        house: main.house,
        gearLevelTier: main.gearLevelTier || 1,
      };
    }
    if (main.tier === 4 && cat1.tier === 1 && cat2.tier === 1) {
      return {
        type: "reroll",
        resultTier: 4,
        slot: main.slot,
        rate: GEAR_SYNTH_REROLL_LOW_RATE,
        gold: GEAR_SYNTH_REROLL_GOLD[4] || 0,
        house: main.house,
        gearLevelTier: main.gearLevelTier || 1,
      };
    }
  }
  return { type: "invalid" };
}

export function applyGearSynthToSave(save, { gearIds } = {}) {
  const ids = Array.isArray(gearIds) ? gearIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (ids.length !== 3 || new Set(ids).size !== 3) return { ok: false, error: "invalid_recipe" };

  const inventory = [...(save.gearInventory || [])];
  const slots = ids.map((id) => inventory.find((g) => g?.id === id));
  if (slots.some((g) => !g)) return { ok: false, error: "gear_not_found" };

  const recipe = analyzeSynth(slots);
  if (!recipe || recipe.type === "invalid") return { ok: false, error: "invalid_recipe" };

  const money = Math.max(0, Math.floor(Number(save.money) || 0));
  if (money < recipe.gold) return { ok: false, error: "insufficient_funds", cost: { gold: recipe.gold } };

  const idSet = new Set(ids);
  let nextInventory = inventory.filter((g) => !idSet.has(g?.id));
  const success = Math.random() < recipe.rate;
  let resultGear = null;
  if (success) {
    const slot = recipe.type === "upgrade"
      ? GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)]
      : recipe.slot;
    resultGear = generateShopGear({
      slot,
      tier: recipe.resultTier,
      house: recipe.house,
      gearLevelTier: recipe.gearLevelTier,
    });
    if (resultGear) nextInventory.push(resultGear);
  }

  return {
    ok: true,
    save: {
      ...save,
      money: money - recipe.gold,
      gearInventory: nextInventory,
      questState: bumpArmoryQuest(save.questState, 1),
    },
    success,
    cost: { gold: recipe.gold },
    resultGear,
  };
}

export async function heroAscend(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "armory_conflict",
    apply: (save) => applyHeroAscensionToSave(save, body || {}),
  });
}

export async function unlockAscensionSkill(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "armory_conflict",
    apply: (save) => applyUnlockAscensionSkillToSave(save, body || {}),
  });
}

export async function enhanceGear(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "armory_conflict",
    apply: (save) => applyGearEnhanceToSave(save, body || {}),
  });
}

export async function synthGear(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "armory_conflict",
    apply: (save) => applyGearSynthToSave(save, body || {}),
  });
}
