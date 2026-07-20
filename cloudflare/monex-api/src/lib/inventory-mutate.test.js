import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAddFromBoxToSave,
  applySwapPartyWithBoxToSave,
  applyReorderPartyToSave,
  addFromBox,
  swapPartyWithBox,
} from "./party-layout.js";
import { applyEquipGearToSave, applyUnequipGearToSave } from "./equip-gear.js";
import { applyHeroAscensionToSave } from "./armory-mutate.js";
import { guardSavePayload, preserveInventoryLayout } from "./save-economy-guard.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
  };
}

test("applySwapPartyWithBoxToSave swaps seats by instance id", () => {
  const save = {
    party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "p1", max_hp: 100, current_hp: 100 }],
    box: [{ name: "Mouch", rarity: "Common", level: 3, instanceId: "b1", max_hp: 100, current_hp: 100 }],
  };
  const result = applySwapPartyWithBoxToSave(save, { partyInstanceId: "p1", boxInstanceId: "b1" });
  assert.equal(result.ok, true);
  assert.equal(result.save.party[0].instanceId, "b1");
  assert.equal(result.save.box[0].instanceId, "p1");
});

test("applyAddFromBoxToSave rejects duplicate species", () => {
  const save = {
    party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "p1", max_hp: 100, current_hp: 100 }],
    box: [{ name: "Chog", rarity: "Common", level: 2, instanceId: "b1", max_hp: 100, current_hp: 100 }],
  };
  const result = applyAddFromBoxToSave(save, { boxInstanceId: "b1" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "species_in_party");
});

test("applyReorderPartyToSave reorders by instance ids", () => {
  const save = {
    party: [
      { name: "Chog", rarity: "Common", level: 1, instanceId: "a", max_hp: 100, current_hp: 100 },
      { name: "Mouch", rarity: "Common", level: 1, instanceId: "b", max_hp: 100, current_hp: 100 },
      { name: "Molandak", rarity: "Common", level: 1, instanceId: "c", max_hp: 100, current_hp: 100 },
    ],
    box: [],
  };
  const result = applyReorderPartyToSave(save, { partyInstanceIds: ["c", "a", "b"] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.save.party.map((m) => m.instanceId), ["c", "a", "b"]);
});

test("equip and unequip move gear between inventory and mon", () => {
  const gear = {
    id: "gear_1",
    slot: "weapon",
    tier: 1,
    house: "chog",
    bonuses: { atk: 10 },
    baseBonuses: { atk: 10 },
    enhanceLevel: 0,
  };
  let save = {
    party: [{ name: "Chog", rarity: "Common", level: 10, instanceId: "p1", max_hp: 100, current_hp: 100, equipment: {} }],
    box: [],
    gearInventory: [gear],
  };
  const equipped = applyEquipGearToSave(save, { instanceId: "p1", gearId: "gear_1" });
  assert.equal(equipped.ok, true);
  assert.equal(equipped.save.gearInventory.length, 0);
  assert.equal(equipped.save.party[0].equipment.weapon.id, "gear_1");

  const unequipped = applyUnequipGearToSave(equipped.save, { instanceId: "p1", slot: "weapon" });
  assert.equal(unequipped.ok, true);
  assert.equal(unequipped.save.gearInventory.length, 1);
  assert.equal(unequipped.save.party[0].equipment.weapon, null);
});

test("preserveInventoryLayout blocks party swap via PUT", () => {
  const existing = {
    money: 100,
    party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "p1", max_hp: 100, current_hp: 40 }],
    box: [{ name: "Mouch", rarity: "Common", level: 3, instanceId: "b1", max_hp: 100, current_hp: 100 }],
    questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
  };
  const incoming = {
    money: 100,
    party: [{ name: "Mouch", rarity: "Common", level: 3, instanceId: "b1", max_hp: 100, current_hp: 100 }],
    box: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "p1", max_hp: 100, current_hp: 40 }],
    questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
  };
  const out = preserveInventoryLayout(existing, incoming);
  assert.equal(out.party[0].instanceId, "p1");
  assert.equal(out.box[0].instanceId, "b1");
  assert.equal(out.party[0].current_hp, 40);
});

test("guardSavePayload keeps equipment from existing on PUT", () => {
  const existing = {
    money: 1000,
    adventureGlobalBest: 1,
    party: [{
      name: "Chog",
      rarity: "Common",
      level: 5,
      instanceId: "p1",
      max_hp: 100,
      current_hp: 100,
      equipment: {
        weapon: {
          id: "gear_w",
          slot: "weapon",
          tier: 1,
          house: "chog",
          bonuses: { atk: 5 },
          baseBonuses: { atk: 5 },
        },
      },
    }],
    box: [],
    gearInventory: [],
    questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
  };
  const incoming = {
    ...existing,
    party: [{
      name: "Chog",
      rarity: "Common",
      level: 5,
      instanceId: "p1",
      max_hp: 100,
      current_hp: 80,
      equipment: { weapon: null },
    }],
    gearInventory: [{
      id: "gear_w",
      slot: "weapon",
      tier: 1,
      house: "chog",
      bonuses: { atk: 5 },
      baseBonuses: { atk: 5 },
    }],
  };
  const out = guardSavePayload(existing, incoming, { now: Date.parse("2026-07-20T12:00:00.000Z") });
  assert.equal(out.party[0].equipment.weapon?.id, "gear_w");
  assert.equal(out.party[0].current_hp, 80);
});

test("swapPartyWithBox CAS persists layout", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 100,
      monballs: 10,
      party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "p1", max_hp: 100, current_hp: 100 }],
      box: [{ name: "Mouch", rarity: "Common", level: 3, instanceId: "b1", max_hp: 100, current_hp: 100 }],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });
  const result = await swapPartyWithBox(
    kv,
    { xUserId: "u1", username: "trainer" },
    { partyInstanceId: "p1", boxInstanceId: "b1" },
    { expectedRevision: 1, startingMonballs: 10 }
  );
  assert.equal(result.ok, true);
  assert.equal(result.save.party[0].instanceId, "b1");
  assert.equal(result.save.revision, 2);
});

test("hero ascend removes dupes and spends gold", () => {
  const save = {
    money: 5000,
    party: [{ name: "Chog", rarity: "Legendary", level: 60, instanceId: "main", max_hp: 200, current_hp: 200, ascensionStars: 0 }],
    box: [
      { name: "Chog", rarity: "Legendary", level: 1, instanceId: "d1", max_hp: 100, current_hp: 100 },
      { name: "Chog", rarity: "Legendary", level: 1, instanceId: "d2", max_hp: 100, current_hp: 100 },
    ],
    gearInventory: [],
  };
  // Force success path is random — just assert structure ok and spend happened.
  const result = applyHeroAscensionToSave(save, {
    mainInstanceId: "main",
    dupeInstanceIds: ["d1", "d2"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.save.money, 5000 - 2000);
  assert.equal(result.save.box.length, 0);
  assert.equal(result.save.party.length, 1);
});

test("hero ascend rejects Rare duplicates for Mythic main", () => {
  const save = {
    money: 5000,
    party: [{ name: "Chog", rarity: "Mythic", level: 80, instanceId: "main", max_hp: 200, current_hp: 200, ascensionStars: 0 }],
    box: [
      { name: "Chog", rarity: "Rare", level: 1, instanceId: "d1", max_hp: 100, current_hp: 100 },
      { name: "Chog", rarity: "Rare", level: 1, instanceId: "d2", max_hp: 100, current_hp: 100 },
    ],
    gearInventory: [],
  };
  const result = applyHeroAscensionToSave(save, {
    mainInstanceId: "main",
    dupeInstanceIds: ["d1", "d2"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "dupe_rarity_mismatch");
});

test("hero ascend allows Mythic main with Legendary duplicates", () => {
  const save = {
    money: 5000,
    party: [{ name: "Chog", rarity: "Mythic", level: 80, instanceId: "main", max_hp: 200, current_hp: 200, ascensionStars: 0 }],
    box: [
      { name: "Chog", rarity: "Legendary", level: 1, instanceId: "d1", max_hp: 100, current_hp: 100 },
      { name: "Chog", rarity: "Legendary", level: 1, instanceId: "d2", max_hp: 100, current_hp: 100 },
    ],
    gearInventory: [],
  };
  const result = applyHeroAscensionToSave(save, {
    mainInstanceId: "main",
    dupeInstanceIds: ["d1", "d2"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.save.money, 5000 - 2000);
  assert.equal(result.save.box.length, 0);
});

test("party equip bumps gear_equip quest progress", () => {
  const gear = {
    id: "gear_1",
    slot: "weapon",
    tier: 1,
    house: "chog",
    bonuses: { atk: 10 },
    baseBonuses: { atk: 10 },
    enhanceLevel: 0,
  };
  const save = {
    party: [{ name: "Chog", rarity: "Common", level: 10, instanceId: "p1", max_hp: 100, current_hp: 100, equipment: {} }],
    box: [],
    gearInventory: [gear],
    questState: { tasks: { dailies: [{ id: "d7", progress: 0, claimed: false }], weeklies: [], campaign: [] } },
  };
  const result = applyEquipGearToSave(save, { instanceId: "p1", gearId: "gear_1" });
  assert.equal(result.ok, true);
  assert.equal(result.save.questState.tasks.dailies.find((t) => t.id === "d7").progress, 1);
});

test("preserveInventoryLayout strips forged gear ids from bag", () => {
  const existing = {
    party: [],
    box: [],
    gearInventory: [{ id: "known", slot: "weapon", tier: 1, house: "chog", bonuses: { atk: 1 }, baseBonuses: { atk: 1 } }],
  };
  const incoming = {
    party: [],
    box: [],
    gearInventory: [
      { id: "known", slot: "weapon", tier: 1, house: "chog", bonuses: { atk: 1 }, baseBonuses: { atk: 1 } },
      { id: "forged", slot: "weapon", tier: 5, house: "chog", bonuses: { atk: 99 }, baseBonuses: { atk: 99 } },
    ],
  };
  const out = preserveInventoryLayout(existing, incoming);
  assert.equal(out.gearInventory.length, 1);
  assert.equal(out.gearInventory[0].id, "known");
});
