import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "mana-system.js"), "utf8");

function loadManaSystem() {
  const ctx = { window: {}, globalThis: {} };
  ctx.globalThis = ctx.window;
  vm.runInNewContext(src, ctx, { filename: "mana-system.js" });
  return ctx.window.MonExManaSystem;
}

describe("mana-system (client)", () => {
  const mana = loadManaSystem();

  it("scales base max mana with level", () => {
    assert.equal(mana.getBaseMaxManaFromLevel(1, "Common"), 80);
    assert.ok(mana.getBaseMaxManaFromLevel(40, "Rare") > mana.getBaseMaxManaFromLevel(1, "Rare"));
  });

  it("adds gear mana bonuses to max mana", () => {
    const mon = {
      level: 10,
      rarity: "Rare",
      ascensionStars: 0,
      equipment: {
        weapon: null,
        armor: { bonuses: { mana: 20 } },
        helmet: null,
        boots: null,
      },
    };
    const without = mana.computeMonMaxMana({ ...mon, equipment: { weapon: null, armor: null, helmet: null, boots: null } });
    const withGear = mana.computeMonMaxMana(mon);
    assert.ok(withGear > without);
  });

  it("scales skill mana cost with level", () => {
    const skill = { type: "active", power: 1.2 };
    const low = mana.getSkillManaCost(skill, 1);
    const high = mana.getSkillManaCost(skill, 40);
    assert.ok(high > low);
  });

  it("high-level mon can afford more casts than costs grow", () => {
    const skill = { type: "heal", healPower: 0.3 };
    const lvl1Max = mana.getBaseMaxManaFromLevel(1, "Common");
    const lvl40Max = mana.getBaseMaxManaFromLevel(40, "Legendary");
    const lvl1Cost = mana.getSkillManaCost(skill, 1);
    const lvl40Cost = mana.getSkillManaCost(skill, 40);
    assert.ok(lvl40Max / lvl40Cost > lvl1Max / lvl1Cost);
  });

  it("refreshMonManaStats sets max_mana on mon", () => {
    const mon = { level: 15, rarity: "Legendary", equipment: { weapon: null, armor: null, helmet: null, boots: null } };
    mana.refreshMonManaStats(mon);
    assert.equal(mon.max_mana, mana.computeMonMaxMana(mon));
  });
});
