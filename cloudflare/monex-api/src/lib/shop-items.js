/** Shop catalog mirrored from play/index.html SHOP_ITEMS. */

export const SHOP_ITEMS = [
  {
    id: "shop_weapon_t1",
    category: "weapon",
    name: "Training Blade",
    gearGrant: { tier: 1, slot: "weapon", gearLevelTier: 1 },
    cost: { gold: 3500 },
  },
  {
    id: "shop_weapon_t2",
    category: "weapon",
    name: "Field Blade",
    gearGrant: { randomRarity: true, slot: "weapon", gearLevelTier: 2 },
    cost: { gold: 8500, essence: 20 },
  },
  {
    id: "shop_armor_t1",
    category: "armor",
    name: "Training Vest",
    gearGrant: { tier: 1, slot: "armor", gearLevelTier: 1 },
    cost: { gold: 3200 },
  },
  {
    id: "shop_armor_t2",
    category: "armor",
    name: "Field Vest",
    gearGrant: { randomRarity: true, slot: "armor", gearLevelTier: 2 },
    cost: { gold: 7800, essence: 18 },
  },
  {
    id: "monball5",
    category: "mats",
    name: "Monball Pack",
    blocked: true,
    cost: { gold: 2000 },
    grant: { monballs: 5 },
  },
  {
    id: "essence25",
    category: "mats",
    name: "KB's Onion Pack",
    cost: { gold: 900 },
    grant: { essence: 25 },
  },
  {
    id: "shards3",
    category: "mats",
    name: "Shard Pack",
    cost: { gold: 1800, essence: 15 },
    grant: { monShards: 3 },
  },
];

export function findShopItem(itemId) {
  return SHOP_ITEMS.find((item) => item.id === itemId) || null;
}

export function multiplyShopCost(cost, qty) {
  const mult = Math.max(1, Math.floor(Number(qty) || 1));
  const out = {};
  if (cost?.gold) out.gold = cost.gold * mult;
  if (cost?.essence) out.essence = cost.essence * mult;
  if (cost?.monShards) out.monShards = cost.monShards * mult;
  return out;
}

export function canAffordShopCost(save, totalCost) {
  if (!totalCost) return false;
  if (totalCost.gold && (save.money || 0) < totalCost.gold) return false;
  if (totalCost.essence && (save.essence || 0) < totalCost.essence) return false;
  if (totalCost.monShards && (save.monShards || 0) < totalCost.monShards) return false;
  return true;
}

export function spendShopCost(save, totalCost) {
  const next = { ...save };
  if (totalCost.gold) next.money = Math.max(0, (next.money || 0) - totalCost.gold);
  if (totalCost.essence) next.essence = Math.max(0, (next.essence || 0) - totalCost.essence);
  if (totalCost.monShards) next.monShards = Math.max(0, (next.monShards || 0) - totalCost.monShards);
  return next;
}
