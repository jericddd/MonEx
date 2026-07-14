import test from "node:test";
import assert from "node:assert/strict";
import { claimQuestTask } from "./quest-claim.js";
import { getDailyDayKey, getDailyWeekKey } from "./daily-reset.js";

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
  const now = new Date();
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
        dailyResetKey: getDailyDayKey(now),
        weeklyResetKey: getDailyWeekKey(now),
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
      updatedAt: now.toISOString(),
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
  const now = new Date();
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 0,
      money: 0,
      questState: {
        dailyResetKey: getDailyDayKey(now),
        weeklyResetKey: getDailyWeekKey(now),
        grantedKeys: [],
        tasks: { dailies: [{ id: "d1", progress: 0, claimed: false }], weeklies: [], campaign: [] },
      },
      party: [],
      box: [],
      updatedAt: now.toISOString(),
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

test("claimQuestTask resets stale daily bundle before validating claim", async () => {
  const today = getDailyDayKey(new Date());
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
        dailyResetKey: today,
        weeklyResetKey: "2020-W01",
        grantedKeys: ["task:dailies:d1"],
        dailyPoints: 0,
        weeklyPoints: 0,
        dailyClaimedChests: [],
        weeklyClaimedChests: [],
        tasks: {
          dailies: [{ id: "d1", progress: 2, claimed: true }],
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

  assert.equal(result.ok, false);
  assert.equal(result.error, "progress_insufficient");
  const stored = JSON.parse(await kv.get("monex:save:u1"));
  assert.equal(stored.questState.tasks.dailies[0].claimed, false);
  assert.equal(stored.questState.tasks.dailies[0].progress, 0);
  assert.ok(!stored.questState.grantedKeys.includes("task:dailies:d1"));
});
