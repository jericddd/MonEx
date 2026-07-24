import test from "node:test";
import assert from "node:assert/strict";
import {
  getMonPower,
  getPartyPower,
  getBaseAtk,
  getMaxHP,
  countUnlockedSkills,
  POWER_RATING_WEIGHTS,
} from "./power-rating.js";

test("getBaseAtk / getMaxHP match play rarity tables", () => {
  assert.equal(getBaseAtk(10, "Common"), Math.floor(10 * 4.2) + 14);
  assert.equal(getBaseAtk(10, "Legendary"), Math.floor(10 * 4.2) + 14 + 28);
  assert.equal(getMaxHP(10, "Common"), Math.floor(120 + 10 * 46));
  assert.equal(getMaxHP(10, "Mythic"), Math.floor(120 + 10 * 46 + 165));
});

test("frozen power damps HP and includes skills/ascension", () => {
  const mon = {
    level: 20,
    rarity: "Legendary",
    ascensionStars: 2,
    stats: { spd: 110, crit: 40, dodge: 40, block: 40, hit: 40, pierce: 40 },
    skills: [
      { type: "ultimate", name: "Ult" },
      { type: "passive", name: "P" },
      { type: "active", name: "A1" },
      { type: "active", name: "A2" },
      { type: "active", name: "A3" },
      { type: "heal", name: "H" },
    ],
    equipment: {},
  };
  const power = getMonPower(mon);
  const atk = getBaseAtk(20, "Legendary");
  const hp = getMaxHP(20, "Legendary");
  const w = POWER_RATING_WEIGHTS;
  // Without damping, hp alone would dominate; ensure atk pillar is meaningful.
  assert.ok(atk * w.atk > hp * w.hp * 0.5);
  assert.ok(power > atk * w.atk);
  assert.equal(countUnlockedSkills(mon), 6);
  assert.ok(power >= Math.floor(6 * w.skill + 2 * w.ascension));
});

test("gear bonuses raise power", () => {
  const base = {
    level: 15,
    rarity: "Rare",
    ascensionStars: 0,
    stats: { spd: 100, crit: 30, dodge: 30, block: 30, hit: 30, pierce: 30 },
    skills: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }],
    equipment: {},
  };
  const geared = {
    ...base,
    equipment: {
      weapon: { bonuses: { atk: 20 } },
      armor: { bonuses: { hp: 100 } },
    },
  };
  assert.ok(getMonPower(geared) > getMonPower(base));
});

test("party power sums mon power", () => {
  const a = {
    level: 5,
    rarity: "Common",
    stats: { spd: 90, crit: 20, dodge: 20, block: 20, hit: 20, pierce: 20 },
    skills: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }],
  };
  const b = { ...a, level: 8 };
  assert.equal(getPartyPower([a, b]), getMonPower(a) + getMonPower(b));
  assert.equal(getPartyPower([]), 0);
});
