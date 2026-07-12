/** Progression-based mana — mirrors js/mana-system.js */

export const GEAR_SLOTS = ["weapon", "armor", "helmet", "boots"];

export const MANA_SYSTEM_CONFIG = {
  baseMana: 80,
  manaPerLevel: 3,
  rarityBonus: { Common: 0, Uncommon: 4, Rare: 8, Legendary: 16, Mythic: 24 },
  maxManaCap: 600,
  statLevelGrowthPct: 0.005,
  ascensionStatBonusPct: 0.05,
  skillCostLevelMult: 0.012,
  skillCostLevelFlat: 0.4,
  normalAttackManaGainBase: 20,
  normalAttackManaGainPerLevel: 0.3,
  cleanseManaBase: 28,
  healManaBase: 16,
  healManaPowerMult: 18,
  activeManaBase: 12,
  activeManaPowerMult: 12,
};

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getAscensionStatMult(mon) {
  return 1 + (mon?.ascensionStars || 0) * MANA_SYSTEM_CONFIG.ascensionStatBonusPct;
}

function scaleStatWithLevel(baseStat, level) {
  const lvl = Math.max(1, Math.floor(level || 1));
  return Math.round((baseStat || 0) * (1 + MANA_SYSTEM_CONFIG.statLevelGrowthPct * (lvl - 1)));
}

export function getBaseMaxManaFromLevel(level, rarity = "Common") {
  const lvl = Math.max(1, Math.floor(level || 1));
  const rarityBonus = MANA_SYSTEM_CONFIG.rarityBonus[rarity] || 0;
  const raw = MANA_SYSTEM_CONFIG.baseMana
    + (lvl - 1) * MANA_SYSTEM_CONFIG.manaPerLevel
    + rarityBonus;
  return clampInt(raw, 1, MANA_SYSTEM_CONFIG.maxManaCap);
}

export function getGearManaBonus(mon) {
  if (!mon?.equipment) return 0;
  const lvl = Math.floor(mon.level || 1);
  const ascMult = getAscensionStatMult(mon);
  let total = 0;
  for (const slot of GEAR_SLOTS) {
    const gear = mon.equipment[slot];
    const base = gear?.bonuses?.mana;
    if (!base) continue;
    total += Math.round(scaleStatWithLevel(base, lvl) * ascMult);
  }
  return total;
}

export function computeMonMaxMana(mon) {
  const base = getBaseMaxManaFromLevel(mon?.level, mon?.rarity);
  const gear = getGearManaBonus(mon);
  return clampInt(base + gear, 1, MANA_SYSTEM_CONFIG.maxManaCap);
}

export function getSkillManaBaseCost(skill) {
  if (!skill) return 0;
  if (skill.mana != null) return skill.mana;
  if (skill.manaCost != null) return skill.manaCost;
  if (skill.cleanse) return MANA_SYSTEM_CONFIG.cleanseManaBase;
  if (skill.type === "heal") {
    return Math.round(
      MANA_SYSTEM_CONFIG.healManaBase
        + (skill.healPower || 0) * MANA_SYSTEM_CONFIG.healManaPowerMult,
    );
  }
  if (skill.type === "active") {
    return Math.round(
      MANA_SYSTEM_CONFIG.activeManaBase
        + (skill.power || 1) * MANA_SYSTEM_CONFIG.activeManaPowerMult,
    );
  }
  return 0;
}

export function getSkillManaCost(skill, level = 1) {
  const base = getSkillManaBaseCost(skill);
  if (!base) return 0;
  const lvl = Math.max(1, Math.floor(level || 1));
  const scaled = Math.round(
    base * (1 + MANA_SYSTEM_CONFIG.skillCostLevelMult * (lvl - 1))
      + MANA_SYSTEM_CONFIG.skillCostLevelFlat * (lvl - 1),
  );
  return clampInt(scaled, 0, 999);
}

export function getNormalAttackManaGain(level = 1) {
  const lvl = Math.max(1, Math.floor(level || 1));
  return clampInt(
    Math.round(
      MANA_SYSTEM_CONFIG.normalAttackManaGainBase
        + MANA_SYSTEM_CONFIG.normalAttackManaGainPerLevel * (lvl - 1),
    ),
    1,
    999,
  );
}
