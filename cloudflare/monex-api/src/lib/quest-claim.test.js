import test from "node:test";
import assert from "node:assert/strict";
import { claimQuestTask } from "./quest-claim.js";

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

test("claimQuestTask grants reward server-side when progress meets goal", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 1000,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      monballs: 10,
      party: [],
      box: [],
      questState: {
        grantedKeys: [],
        dailyPoints: 0,
        weeklyPoints: 0,
        dailyClaimedChests: [],
        weeklyClaimedChests: [],
        tasks: {
          dailies: [{ id: "d1", progress: 2, claimed: false }],
          weeklies: [],
          campaign: [],
        },
      },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await claimQuestTask(
    kv,
    { xUserId: "u1", username: "trainer" },
    { tab: "dailies", taskId: "d1", expectedRevision: 1 },
    10
  );

  assert.equal(result.ok, true);
  assert.equal(result.grantKey, "task:dailies:d1");
  assert.equal(result.save.money, 1100);
  assert.ok(result.save.questState.grantedKeys.includes("task:dailies:d1"));
  assert.equal(result.save.questState.tasks.dailies[0].claimed, true);
});

test("claimQuestTask rejects insufficient progress", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 0,
      money: 0,
      questState: {
        grantedKeys: [],
        tasks: { dailies: [{ id: "d1", progress: 0, claimed: false }], weeklies: [], campaign: [] },
      },
      party: [],
      box: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await claimQuestTask(
    kv,
    { xUserId: "u1", username: "trainer" },
    { tab: "dailies", taskId: "d1" },
    10
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "progress_insufficient");
});
