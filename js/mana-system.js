/**
 * Progression-based mana — mirrors cloudflare/monex-api/src/lib/mana-system.js.
 */
(() => {
  "use strict";

  const GEAR_SLOTS = ["weapon", "armor", "helmet", "boots"];

  const MANA_SYSTEM_CONFIG = {
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

  function getBaseMaxManaFromLevel(level, rarity = "Common") {
    const lvl = Math.max(1, Math.floor(level || 1));
    const rarityBonus = MANA_SYSTEM_CONFIG.rarityBonus[rarity] || 0;
    const raw = MANA_SYSTEM_CONFIG.baseMana
      + (lvl - 1) * MANA_SYSTEM_CONFIG.manaPerLevel
      + rarityBonus;
    return clampInt(raw, 1, MANA_SYSTEM_CONFIG.maxManaCap);
  }

  function getGearManaBonus(mon) {
    if (!mon?.equipment) return 0;
    const lvl = Math.floor(mon.level || 1);
    const ascMult = getAscensionStatMult(mon);
    let total = 0;
    GEAR_SLOTS.forEach((slot) => {
      const gear = mon.equipment[slot];
      const base = gear?.bonuses?.mana;
      if (!base) return;
      total += Math.round(scaleStatWithLevel(base, lvl) * ascMult);
    });
    return total;
  }

  function getBattleManaBonusFromStatus(status) {
    let bonus = 0;
    for (const st of status || []) {
      if (st.statMods?.mana != null) bonus += st.statMods.mana;
    }
    return bonus;
  }

  function computeMonMaxMana(mon) {
    const base = getBaseMaxManaFromLevel(mon?.level, mon?.rarity);
    const gear = getGearManaBonus(mon);
    return clampInt(base + gear, 1, MANA_SYSTEM_CONFIG.maxManaCap);
  }

  function getBattleMaxMana(fighter) {
    const statusBonus = getBattleManaBonusFromStatus(fighter?.status);
    return clampInt((fighter?.maxMana || 0) + statusBonus, 1, MANA_SYSTEM_CONFIG.maxManaCap);
  }

  function getSkillManaBaseCost(skill) {
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

  function getSkillManaCost(skill, level = 1) {
    const base = getSkillManaBaseCost(skill);
    if (!base) return 0;
    const lvl = Math.max(1, Math.floor(level || 1));
    const scaled = Math.round(
      base * (1 + MANA_SYSTEM_CONFIG.skillCostLevelMult * (lvl - 1))
        + MANA_SYSTEM_CONFIG.skillCostLevelFlat * (lvl - 1),
    );
    return clampInt(scaled, 0, 999);
  }

  function getNormalAttackManaGain(level = 1) {
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

  function refreshMonManaStats(mon) {
    if (!mon) return;
    mon.max_mana = computeMonMaxMana(mon);
  }

  const api = {
    MANA_SYSTEM_CONFIG,
    GEAR_SLOTS,
    getBaseMaxManaFromLevel,
    getGearManaBonus,
    computeMonMaxMana,
    getBattleMaxMana,
    getSkillManaBaseCost,
    getSkillManaCost,
    getNormalAttackManaGain,
    refreshMonManaStats,
  };

  if (typeof window !== "undefined") window.MonExManaSystem = api;
  if (typeof globalThis !== "undefined") globalThis.MonExManaSystem = api;
})();
