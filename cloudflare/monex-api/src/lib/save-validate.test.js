import test from "node:test";
import assert from "node:assert/strict";
import { validateAndSanitizeSave, sanitizeMon, sanitizeGear } from "./save-validate.js";

test("clamps inflated currency", () => {
  const save = validateAndSanitizeSave({
    money: 999_999_999_999,
    essence: 50_000_000,
    monShards: 500_000,
    monballs: 50_000,
    trainerXp: 500_000_000,
  });
  assert.equal(save.money, 99_999_999);
  assert.equal(save.essence, 9_999_999);
  assert.equal(save.monShards, 99_999);
  assert.equal(save.monballs, 9_999);
  assert.equal(save.trainerXp, 99_999_999);
});

test("caps party length and strips invalid mons", () => {
  const mk = (name) => ({ name, rarity: "Rare", level: 10, max_hp: 200, current_hp: 200 });
  const save = validateAndSanitizeSave({
    party: [
      mk("Chog"),
      mk("Anago"),
      mk("Mouch"),
      mk("Molandak"),
      mk("Salmonad"),
      mk("Lyraffe"),
      { name: "Hacker", rarity: "Mythic", level: 99, max_hp: 9999, current_hp: 9999 },
    ],
  });
  assert.equal(save.party.length, 5);
  assert.ok(!save.party.some((m) => m.name === "Hacker"));
});

test("clamps mon level to rarity cap", () => {
  const mon = sanitizeMon({ name: "Anago", rarity: "Common", level: 99, max_hp: 100, current_hp: 100 });
  assert.equal(mon.level, 20);
});

test("sanitizes gear and inventory cap", () => {
  const gear = sanitizeGear({
    id: "gear_1",
    slot: "weapon",
    tier: 99,
    name: "Exploit Blade",
    bonuses: { atk: 50_000, fake: 999 },
    enhanceLevel: 50,
  });
  assert.equal(gear.tier, 5);
  assert.equal(gear.tierName, "Mythic");
  assert.equal(gear.name, "Mythic Weapon");
  assert.equal(gear.enhanceLevel, 21);
  assert.equal(gear.bonuses.atk, 9999);
  assert.equal(gear.bonuses.fake, undefined);

  const inv = validateAndSanitizeSave({
    gearInventory: Array.from({ length: 250 }, (_, i) => ({
      id: `g${i}`,
      slot: "boots",
      tier: 1,
      name: "Common Boots",
      bonuses: { spd: 5 },
    })),
  });
  assert.equal(inv.gearInventory.length, 250);
});

test("forces adventureBattleActive false and validates progress", () => {
  const save = validateAndSanitizeSave({
    adventureBattleActive: true,
    currentChapter: 50,
    currentStage: 10,
    adventureGlobalBest: 5,
    highestStageCleared: 99,
  });
  assert.equal(save.adventureBattleActive, false);
  assert.equal(save.adventureGlobalBest, 5);
  assert.ok(save.currentChapter <= 50);
});

test("resource chest timestamp clamped to 24h window", () => {
  const now = 1_700_000_000_000;
  const save = validateAndSanitizeSave(
    { resourceChestLastCollectAt: now - 48 * 60 * 60 * 1000 },
    {},
    { now },
  );
  assert.equal(save.resourceChestLastCollectAt, now - 24 * 60 * 60 * 1000);
});

test("preserves hero ascension fields on mons", () => {
  const mon = sanitizeMon({
    name: "Anago",
    rarity: "Legendary",
    level: 15,
    max_hp: 500,
    current_hp: 500,
    ascensionStars: 1,
    ascensionSkillPending: [
      { name: "Sharp Claws", type: "passive", element: "passive", dmgDealt: 1.2, desc: "Deals 20% more damage." },
      { name: "Flame Burst", type: "active", element: "fire", power: 1.1, desc: "Fire burst." },
    ],
  });
  assert.equal(mon.ascensionStars, 1);
  assert.equal(mon.ascensionSkillPending.length, 2);
  assert.equal(mon.ascensionSkillPending[0].name, "Sharp Claws");
  assert.equal(mon.ascensionSkillPending[0].dmgDealt, 1.2);
});

test("preserves updatedAt when sanitizing saves", () => {
  const ts = "2024-06-15T12:00:00.000Z";
  const save = validateAndSanitizeSave(
    { money: 100, updatedAt: ts },
    {},
    { now: Date.parse("2025-01-01T00:00:00.000Z") },
  );
  assert.equal(save.updatedAt, ts);
});

test("clears staging gear seed when armory is locked", () => {
  const save = validateAndSanitizeSave({
    adventureGlobalBest: 9,
    gearInventorySeedVersion: 1,
    gearInventory: [{ id: "g1", slot: "weapon", tier: 1, name: "Weapon" }],
  });
  assert.equal(save.gearInventorySeedVersion, 0);
  assert.equal(save.gearInventory.length, 1);
});

test("keeps staging gear seed when armory is unlocked", () => {
  const save = validateAndSanitizeSave({
    adventureGlobalBest: 49,
    gearInventorySeedVersion: 1,
    gearInventory: [{ id: "g1", slot: "weapon", tier: 1, name: "Weapon" }],
  });
  assert.equal(save.gearInventorySeedVersion, 1);
});
