/**
 * Frozen Mon power rating (see .cursor/rules/power-rating-standard-norm.mdc).
 * Server + client must stay bit-compatible on the weighted formula.
 */

export const HERO_ASCENSION_STAT_BONUS_PCT = 0.05;
export const STAT_LEVEL_GROWTH_PCT = 0.005;

export const POWER_RATING_WEIGHTS = Object.freeze({
  atk: 5,
  hp: 0.4,
  spd: 2.5,
  secondary: 3,
  skill: 45,
  ascension: 35,
});

const RARITY_ATK_BONUS = Object.freeze({
  Common: 0,
  Uncommon: 8,
  Rare: 15,
  Legendary: 28,
  Mythic: 28,
});

const RARITY_HP_BONUS = Object.freeze({
  Common: 0,
  Uncommon: 22,
  Rare: 52,
  Legendary: 105,
  Mythic: 165,
});

const GEAR_SLOTS = Object.freeze(["weapon", "armor", "helmet", "boots"]);

export function getBaseAtk(level, rarity) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  let atk = Math.floor(lvl * 4.2) + 14;
  atk += RARITY_ATK_BONUS[rarity] || 0;
  return atk;
}

export function getMaxHP(level, rarity) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  return Math.floor(120 + lvl * 46 + (RARITY_HP_BONUS[rarity] || 0));
}

export function getAscensionStatMult(ascensionStars) {
  const stars = Math.max(0, Math.floor(Number(ascensionStars) || 0));
  return 1 + stars * HERO_ASCENSION_STAT_BONUS_PCT;
}

export function scaleStatWithLevel(baseStat, level) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  return Math.round((Number(baseStat) || 0) * (1 + STAT_LEVEL_GROWTH_PCT * (lvl - 1)));
}

function gearBonusSum(mon, key, level, ascMult) {
  const eq = mon?.equipment;
  if (!eq || typeof eq !== "object") return 0;
  let total = 0;
  for (const slot of GEAR_SLOTS) {
    const gear = eq[slot];
    const raw = gear?.bonuses?.[key];
    if (!Number.isFinite(Number(raw))) continue;
    total += Math.round(scaleStatWithLevel(raw, level) * ascMult);
  }
  return total;
}

export function countUnlockedSkills(mon) {
  if (!Array.isArray(mon?.skills)) return 0;
  return mon.skills.filter((s) => s && (s.name || s.type)).length;
}

/**
 * Effective combat stats matching play getEffectiveStats + refreshMonDerivedStats HP.
 * Does not mutate the Mon.
 */
export function getEffectiveCombatForPower(mon) {
  if (!mon || typeof mon !== "object") {
    return { atk: 0, hp: 0, spd: 0, crit: 0, dodge: 0, block: 0, hit: 0, pierce: 0 };
  }
  const level = Math.max(1, Math.floor(Number(mon.level) || 1));
  const rarity = String(mon.rarity || "Common");
  const ascStars = Math.max(0, Math.floor(Number(mon.ascensionStars) || 0));
  const ascMult = getAscensionStatMult(ascStars);
  const s = mon.stats && typeof mon.stats === "object" ? mon.stats : {};
  const scaleBase = (val) => Math.round(scaleStatWithLevel(val, level) * ascMult);

  const atk = getBaseAtk(level, rarity) + gearBonusSum(mon, "atk", level, ascMult);
  const hp = getMaxHP(level, rarity) + gearBonusSum(mon, "hp", level, ascMult);

  return {
    atk,
    hp,
    spd: scaleBase(s.spd) + gearBonusSum(mon, "spd", level, ascMult),
    crit: scaleBase(s.crit) + gearBonusSum(mon, "crit", level, ascMult),
    dodge: scaleBase(s.dodge) + gearBonusSum(mon, "dodge", level, ascMult),
    block: scaleBase(s.block) + gearBonusSum(mon, "block", level, ascMult),
    hit: scaleBase(s.hit) + gearBonusSum(mon, "hit", level, ascMult),
    pierce: scaleBase(s.pierce) + gearBonusSum(mon, "pierce", level, ascMult),
  };
}

/**
 * Frozen per-Mon power rating.
 */
export function getMonPower(mon) {
  if (!mon || typeof mon !== "object") return 0;
  const eff = getEffectiveCombatForPower(mon);
  const secondary =
    (eff.crit || 0) + (eff.dodge || 0) + (eff.block || 0) + (eff.hit || 0) + (eff.pierce || 0);
  const unlockedSkills = countUnlockedSkills(mon);
  const ascensionStars = Math.max(0, Math.floor(Number(mon.ascensionStars) || 0));
  const w = POWER_RATING_WEIGHTS;
  return Math.max(
    0,
    Math.floor(
      (eff.atk || 0) * w.atk
        + (eff.hp || 0) * w.hp
        + (eff.spd || 0) * w.spd
        + secondary * w.secondary
        + unlockedSkills * w.skill
        + ascensionStars * w.ascension
    )
  );
}

export function getPartyPower(party) {
  if (!Array.isArray(party)) return 0;
  return party.reduce((sum, mon) => sum + getMonPower(mon), 0);
}
