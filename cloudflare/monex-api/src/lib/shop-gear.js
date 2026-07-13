import { sanitizeGear, GEAR_SLOTS } from "./save-validate.js";

const HOUSES = ["chog", "molandak", "moyaki"];
const SLOT_PRIMARY = {
  weapon: "atk",
  armor: "hp",
  helmet: "mana",
  boots: "spd",
};

function rollInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nextGearId() {
  return `gear_shop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Minimal server-side gear roll for shop purchases — passes sanitizeGear.
 */
export function generateShopGear(gearGrant) {
  if (!gearGrant?.slot || !GEAR_SLOTS.includes(gearGrant.slot)) return null;
  const tier = gearGrant.randomRarity ? rollInt(1, 5) : (gearGrant.tier || 1);
  const house = gearGrant.house || HOUSES[rollInt(0, HOUSES.length - 1)];
  const gearLevelTier = gearGrant.gearLevelTier || 1;
  const primaryStat = SLOT_PRIMARY[gearGrant.slot] || "atk";
  const primaryValue = rollInt(5 + tier * 3, 15 + tier * 8);
  const bonuses = { [primaryStat]: primaryValue };
  return sanitizeGear({
    id: nextGearId(),
    slot: gearGrant.slot,
    tier,
    house,
    gearLevelTier,
    bonuses,
    baseBonuses: bonuses,
    primaryRoll: {
      stat: primaryStat,
      value: primaryValue,
      min: primaryValue,
      max: primaryValue,
    },
    enhanceLevel: 0,
    gearVersion: 1,
    iconVersion: 1,
  });
}
