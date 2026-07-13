import test from "node:test";
import assert from "node:assert/strict";
import {
  claimBattleReward,
  computeAdventureReward,
  computePatrolReward,
  isBossStage,
} from "./battle-reward.js";

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

test("isBossStage matches client rule", () => {
  assert.equal(isBossStage(1), false);
  assert.equal(isBossStage(4), true);
  assert.equal(isBossStage(8), true);
});

test("computeAdventureReward grants gold on boss stage", () => {
  const save = { currentChapter: 1, currentStage: 4, adventureGlobalBest: 4 };
  const { reward, boss } = computeAdventureReward(save);
  assert.equal(boss, true);
  assert.ok(reward.gold > 0);
  assert.ok(reward.essence > 0);
  assert.ok(reward.trainerXp > 0);
});

test("computePatrolReward scales by encounter", () => {
  const save = { currentChapter: 2 };
  const trash = computePatrolReward(save, "trash").reward;
  const rare = computePatrolReward(save, "rare").reward;
  assert.ok(rare.gold > trash.gold);
});

test("claimBattleReward advances adventure stage and bumps quest progress", async () => {
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 2,
      currentChapter: 1,
      currentStage: 1,
      adventureGlobalBest: 0,
      highestStageCleared: 0,
      money: 100,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };

  const result = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: "adv-1-1-1",
    expectedRevision: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.save.currentStage, 2);
  assert.ok(result.reward.gold > 0);
  const d1 = result.save.questState.tasks.dailies.find((t) => t.id === "d1");
  assert.equal(d1?.progress, 1);

  const dup = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: "adv-1-1-1",
    expectedRevision: result.save.revision,
  });
  assert.equal(dup.alreadyClaimed, true);
});

test("claimBattleReward patrol win grants resources", async () => {
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 1,
      currentChapter: 2,
      currentStage: 5,
      adventureGlobalBest: 45,
      highestStageCleared: 5,
      money: 0,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };

  const result = await claimBattleReward(kv, session, {
    mode: "patrol",
    win: true,
    encounterId: "common",
    claimId: "patrol-common-1",
    expectedRevision: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.save.currentStage, 5);
  assert.ok(result.reward.gold > 0);
  const d4 = result.save.questState.tasks.dailies.find((t) => t.id === "d4");
  assert.equal(d4?.progress, 1);
});
