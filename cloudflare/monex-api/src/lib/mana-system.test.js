import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeMonMaxMana,
  getBaseMaxManaFromLevel,
  getGearManaBonus,
  getNormalAttackManaGain,
  getSkillManaCost,
} from "./mana-system.js";

describe("mana-system (server)", () => {
  it("level 1 mon without gear has configured base mana", () => {
    assert.equal(getBaseMaxManaFromLevel(1, "Common"), 80);
    const mon = {
      level: 1,
      rarity: "Common",
      equipment: { weapon: null, armor: null, helmet: null, boots: null },
    };
    assert.equal(computeMonMaxMana(mon), 80);
  });

  it("gear mana stacks into max mana", () => {
    const mon = {
      level: 20,
      rarity: "Rare",
      ascensionStars: 2,
      equipment: {
        weapon: null,
        armor: { bonuses: { mana: 15 } },
        helmet: { bonuses: { mana: 10 } },
        boots: null,
      },
    };
    assert.ok(getGearManaBonus(mon) > 20);
    assert.equal(computeMonMaxMana(mon), getBaseMaxManaFromLevel(20, "Rare") + getGearManaBonus(mon));
  });

  it("skill costs and mana gain scale with level", () => {
    const skill = { cleanse: true };
    assert.ok(getSkillManaCost(skill, 30) > getSkillManaCost(skill, 1));
    assert.ok(getNormalAttackManaGain(30) > getNormalAttackManaGain(1));
  });
});
