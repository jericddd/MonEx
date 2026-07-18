import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMonLevelUpToSave,
  applyMonRarityAscendToSave,
  getLevelCost,
  levelUpMon,
  ascendMonRarity,
} from "./mon-level-up.js";
import { guardSavePayload, clampMonProgressCeiling } from "./save-economy-guard.js";

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

const QUEST_NOW = Date.parse("2026-07-18T12:00:00.000Z");

test("getLevelCost matches client formula", () => {
  assert.deepEqual(getLevelCost(5), { gold: 250, essence: 20 });
  assert.deepEqual(getLevelCost(1), { gold: 50, essence: 8 });
});

test("applyMonLevelUpToSave spends gold+essence and raises level", () => {
  const save = {
    money: 1000,
    essence: 100,
    monShards: 0,
    party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "inst_chog", max_hp: 120, current_hp: 50 }],
    box: [],
    questState: { tasks: { dailies: [], weeklies: [], campaign: [] }, grantedKeys: [] },
  };
  const result = applyMonLevelUpToSave(save, { instanceId: "inst_chog" });
  assert.equal(result.ok, true);
  assert.equal(result.save.money, 750);
  assert.equal(result.save.essence, 80);
  assert.equal(result.save.party[0].level, 6);
  assert.equal(result.save.party[0].current_hp, 120);
  const d2 = result.save.questState.tasks.dailies.find((t) => t.id === "d2");
  assert.equal(d2?.progress, 1);
});

test("applyMonLevelUpToSave rejects insufficient funds", () => {
  const save = {
    money: 10,
    essence: 100,
    party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
    box: [],
  };
  const result = applyMonLevelUpToSave(save, { instanceId: "inst_chog" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "insufficient_funds");
});

test("applyMonLevelUpToSave rejects max level", () => {
  const save = {
    money: 99999,
    essence: 99999,
    party: [{ name: "Chog", rarity: "Common", level: 20, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
    box: [],
  };
  const result = applyMonLevelUpToSave(save, { instanceId: "inst_chog" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "max_level");
});

test("free-upgrade path blocked: PUT cannot raise level while keeping wallet", () => {
  const existing = {
    money: 1000,
    essence: 100,
    adventureGlobalBest: 1,
    party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
    box: [],
    questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
  };
  // Client frankenstein: spent locally then merge restored money + kept level 6
  const incoming = {
    ...existing,
    money: 1000,
    essence: 100,
    party: [{ name: "Chog", rarity: "Common", level: 6, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
    questState: {
      grantedKeys: [],
      dailyKey: "2026-07-18",
      weeklyKey: "2026-W29",
      dailyPoints: 0,
      weeklyPoints: 0,
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      tasks: { dailies: [], weeklies: [], campaign: [] },
    },
  };
  const out = guardSavePayload(existing, incoming, { now: QUEST_NOW });
  assert.equal(out.party[0].level, 5, "PUT must clamp forged level increases");
  assert.equal(out.money, 1000);
});

test("clampMonProgressCeiling blocks rarity ascend via PUT", () => {
  const existing = {
    party: [{ name: "Chog", rarity: "Legendary", level: 60, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
    box: [],
  };
  const incoming = {
    party: [{ name: "Chog", rarity: "Mythic", level: 60, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
    box: [],
  };
  const out = clampMonProgressCeiling(existing, incoming);
  assert.equal(out.party[0].rarity, "Legendary");
});

test("levelUpMon CAS persists spend+level atomically", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 2,
      money: 1000,
      essence: 100,
      monShards: 0,
      monballs: 10,
      party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
      box: [],
      gearInventory: [],
      questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await levelUpMon(
    kv,
    { xUserId: "u1", username: "trainer" },
    { instanceId: "inst_chog" },
    { expectedRevision: 2, startingMonballs: 10 }
  );

  assert.equal(result.ok, true);
  assert.equal(result.save.revision, 3);
  assert.equal(result.save.money, 750);
  assert.equal(result.save.essence, 80);
  assert.equal(result.save.party[0].level, 6);
});

test("levelUpMon retries through revision conflict without free upgrade", async () => {
  let reads = 0;
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 1000,
      essence: 100,
      monballs: 10,
      party: [{ name: "Chog", rarity: "Common", level: 5, instanceId: "inst_chog", max_hp: 100, current_hp: 100 }],
      box: [],
      gearInventory: [],
      questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = {
    async get(key) {
      if (key === "monex:save:u1") {
        reads += 1;
        // First persist attempt races: revision already advanced by another write.
        if (reads === 2) {
          store[key] = JSON.stringify({
            ...JSON.parse(store[key]),
            revision: 2,
            money: 1100,
            essence: 120,
          });
        }
      }
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
  };

  const result = await levelUpMon(
    kv,
    { xUserId: "u1", username: "trainer" },
    { instanceId: "inst_chog" },
    { expectedRevision: 1, startingMonballs: 10 }
  );

  assert.equal(result.ok, true);
  // Re-applied onto revision-2 snapshot: 1100-250 / 120-20 / level 6
  assert.equal(result.save.money, 850);
  assert.equal(result.save.essence, 100);
  assert.equal(result.save.party[0].level, 6);
});

test("applyMonRarityAscendToSave spends shards at level cap", () => {
  const save = {
    money: 0,
    essence: 0,
    monShards: 50,
    party: [{ name: "Chog", rarity: "Legendary", level: 60, instanceId: "inst_chog", max_hp: 200, current_hp: 10 }],
    box: [],
  };
  const result = applyMonRarityAscendToSave(save, { instanceId: "inst_chog" });
  assert.equal(result.ok, true);
  assert.equal(result.save.monShards, 10);
  assert.equal(result.save.party[0].rarity, "Mythic");
  assert.equal(result.save.party[0].current_hp, 200);
});

test("ascendMonRarity persists via CAS", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 0,
      money: 0,
      essence: 0,
      monShards: 40,
      monballs: 10,
      party: [{ name: "Chog", rarity: "Legendary", level: 60, instanceId: "inst_chog", max_hp: 200, current_hp: 200 }],
      box: [],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await ascendMonRarity(
    kv,
    { xUserId: "u1", username: "trainer" },
    { instanceId: "inst_chog" },
    { startingMonballs: 10 }
  );

  assert.equal(result.ok, true);
  assert.equal(result.save.monShards, 0);
  assert.equal(result.save.party[0].rarity, "Mythic");
});
