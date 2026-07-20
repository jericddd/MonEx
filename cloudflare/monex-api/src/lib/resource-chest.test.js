import test from "node:test";
import assert from "node:assert/strict";
import { previewResourceChest, collectResourceChest } from "./resource-chest.js";
import { getTrainerLevelInfo, trainerLevelRewardGrant } from "./trainer-rewards.js";

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

test("previewResourceChest scales rewards by elapsed time", () => {
  const now = Date.parse("2026-07-13T12:00:00.000Z");
  const save = {
    currentChapter: 2,
    resourceChestLastCollectAt: now - 12 * 60 * 60 * 1000,
  };
  const preview = previewResourceChest(save, now);
  assert.equal(preview.progress, 0.5);
  assert.equal(preview.gold, 360);
  assert.ok(preview.canCollect);
});

test("collectResourceChest grants rewards and resets timer", async () => {
  const now = Date.parse("2026-07-13T12:00:00.000Z");
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 100,
      essence: 0,
      trainerXp: 0,
      monballs: 10,
      currentChapter: 2,
      currentStage: 1,
      adventureGlobalBest: 50,
      party: [],
      box: [],
      gearInventory: [],
      resourceChestLastCollectAt: now - 24 * 60 * 60 * 1000,
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] }, grantedKeys: [] },
      updatedAt: new Date(now - 1000).toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await collectResourceChest(
    kv,
    { xUserId: "u1", username: "trainer" },
    { expectedRevision: 1, now },
    10
  );

  assert.equal(result.ok, true);
  assert.equal(result.grant.gold, 720);
  const afterXp = 0 + result.grant.trainerXp;
  const info = getTrainerLevelInfo(afterXp);
  let bonusGold = 0;
  for (let lv = 2; lv <= info.level; lv++) bonusGold += trainerLevelRewardGrant(lv).gold;
  assert.equal(result.save.money, 100 + 720 + bonusGold);
  assert.equal(result.save.trainerRewardLevel, info.level);
  assert.equal(result.save.questState.tasks.dailies[0].progress, 1);
  assert.ok(Number(result.save.resourceChestLastCollectAt) > 0);
});
