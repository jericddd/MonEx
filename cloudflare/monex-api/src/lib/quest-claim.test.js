import test from "node:test";
import assert from "node:assert/strict";
import { claimQuestTask, claimQuestChest } from "./quest-claim.js";
import { getDailyDayKey, getDailyWeekKey } from "./daily-reset.js";
import { findUnpaidMonballQuestGrants, reconcileUnpaidMonballQuestGrants } from "./quest-monball-grants.js";
import { QUEST_ONE_TIME_DAILY_RESET_IDS } from "./quest-one-time-reset.js";

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

function baseCatchState(monballs = 0) {
  return {
    processedTweetIds: [],
    users: {
      u1: {
        username: "trainer",
        monballs,
        pendingMons: [],
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

function seedCatchUser(store, monballs = 0) {
  store["monex:catch-user:u1"] = JSON.stringify({
    username: "trainer",
    monballs,
    pendingMons: [],
    updatedAt: new Date(1000).toISOString(),
  });
}

test("claimQuestTask grants campaign monballs atomically", async () => {
  const now = new Date();
  const store = {
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 1000,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      monballs: 0,
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
          dailies: [],
          weeklies: [],
          campaign: [{ id: "c1", progress: 1, claimed: false }],
        },
      },
      updatedAt: now.toISOString(),
    }),
  };
  seedCatchUser(store, 0);
  const kv = makeKv(store);

  const result = await claimQuestTask(
    kv,
    { xUserId: "u1", username: "trainer" },
    { tab: "campaign", taskId: "c1", expectedRevision: 1 },
    0
  );

  assert.equal(result.ok, true);
  assert.equal(result.grant.monballs, 15);
  assert.equal(result.save.monballs, 15);
  assert.equal(result.save.questState.tasks.campaign[0].claimed, true);
  assert.equal(result.save.questMonballPaidAmounts["task:campaign:c1"], 15);

  const catchRaw = JSON.parse(await kv.get("monex:catch-user:u1"));
  assert.equal(catchRaw.monballs, 15);
});

test("reconcileUnpaidMonballQuestGrants backfills missing campaign monballs once", async () => {
  const now = new Date();
  const save = {
    revision: 3,
    monballs: 0,
    party: [],
    box: [],
    questState: {
      grantedKeys: ["task:campaign:c1"],
      tasks: {
        campaign: [{ id: "c1", progress: 1, claimed: true }],
      },
    },
    updatedAt: now.toISOString(),
  };
  const store = {
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
    "monex:save:u1": JSON.stringify(save),
  };
  seedCatchUser(store, 0);
  const kv = makeKv(store);

  const owed = findUnpaidMonballQuestGrants(save.questState, {});
  assert.equal(owed.length, 1);
  assert.equal(owed[0].amount, 15);

  const reconciled = await reconcileUnpaidMonballQuestGrants(
    kv,
    { xUserId: "u1", username: "trainer" },
    save,
    10
  );
  assert.equal(reconciled.monballs, 15);
  assert.equal(reconciled.questMonballPaidAmounts["task:campaign:c1"], 15);

  const secondPass = await reconcileUnpaidMonballQuestGrants(
    kv,
    { xUserId: "u1", username: "trainer" },
    reconciled,
    10
  );
  assert.equal(secondPass.monballs, 15);
  assert.equal(findUnpaidMonballQuestGrants(secondPass.questState, secondPass.questMonballPaidAmounts).length, 0);
});

test("claimQuestTask grants reward server-side when progress meets goal", async () => {
  const now = new Date();
  const kv = makeKv({
    "monex:state": JSON.stringify(baseCatchState(10)),
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
      questOneTimeResetsApplied: [...QUEST_ONE_TIME_DAILY_RESET_IDS],
      updatedAt: now.toISOString(),
    }),
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
    "monex:state": JSON.stringify(baseCatchState(10)),
    "monex:save:u1": JSON.stringify({
      revision: 0,
      money: 0,
      monballs: 10,
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

test("claimQuestTask retries claim payload after revision conflict instead of dropping grant", async () => {
  const now = new Date();
  const kv = makeKv({
    "monex:state": JSON.stringify(baseCatchState(10)),
    "monex:save:u1": JSON.stringify({
      revision: 5,
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
      questOneTimeResetsApplied: [...QUEST_ONE_TIME_DAILY_RESET_IDS],
      updatedAt: now.toISOString(),
    }),
  });

  const result = await claimQuestTask(
    kv,
    { xUserId: "u1", username: "trainer" },
    { tab: "dailies", taskId: "d1", expectedRevision: 4 },
    10
  );

  assert.equal(result.ok, true);
  assert.equal(result.save.money, 1100);
  assert.equal(result.save.questState.tasks.dailies[0].claimed, true);
  assert.ok(result.save.questState.grantedKeys.includes("task:dailies:d1"));
});

test("claimQuestTask resets stale daily bundle before validating claim", async () => {
  const today = getDailyDayKey(new Date());
  const kv = makeKv({
    "monex:state": JSON.stringify(baseCatchState(10)),
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

test("claimQuestChest completes milestone when monball was paid but chest not marked claimed", async () => {
  const now = new Date();
  const store = {
    "monex:state": JSON.stringify(baseCatchState(10)),
    "monex:save:u1": JSON.stringify({
      revision: 4,
      money: 1000,
      essence: 0,
      monShards: 0,
      trainerXp: 100,
      trainerRewardLevel: 2,
      monballs: 11,
      party: [],
      box: [],
      questState: {
        dailyResetKey: getDailyDayKey(now),
        weeklyResetKey: getDailyWeekKey(now),
        grantedKeys: ["chest:dailies:60"],
        dailyPoints: 74,
        weeklyPoints: 0,
        dailyClaimedChests: [],
        weeklyClaimedChests: [],
        tasks: { dailies: [], weeklies: [], campaign: [] },
      },
      questMonballPaidAmounts: { "chest:dailies:60": 1 },
      questOneTimeResetsApplied: [...QUEST_ONE_TIME_DAILY_RESET_IDS],
      updatedAt: now.toISOString(),
    }),
  };
  seedCatchUser(store, 11);
  const kv = makeKv(store);

  const result = await claimQuestChest(
    kv,
    { xUserId: "u1", username: "trainer" },
    { track: "dailies", milestone: 60, expectedRevision: 4 },
    10
  );

  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.ok(result.save.questState.dailyClaimedChests.includes(60));
  assert.equal(result.save.money, 1150);
  assert.equal(result.save.trainerXp, 100);
  assert.equal(result.save.monballs, 11);
});

test("claimQuestChest daily 60 grants monball and gold together", async () => {
  const now = new Date();
  const store = {
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
    "monex:save:u1": JSON.stringify({
      revision: 2,
      money: 1000,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      monballs: 5,
      party: [],
      box: [],
      questState: {
        dailyResetKey: getDailyDayKey(now),
        weeklyResetKey: getDailyWeekKey(now),
        grantedKeys: [],
        dailyPoints: 65,
        weeklyPoints: 0,
        dailyClaimedChests: [],
        weeklyClaimedChests: [],
        tasks: { dailies: [], weeklies: [], campaign: [] },
      },
      questOneTimeResetsApplied: [...QUEST_ONE_TIME_DAILY_RESET_IDS],
      updatedAt: now.toISOString(),
    }),
  };
  seedCatchUser(store, 5);
  const kv = makeKv(store);

  const result = await claimQuestChest(
    kv,
    { xUserId: "u1", username: "trainer" },
    { track: "dailies", milestone: 60, expectedRevision: 2 },
    10
  );

  assert.equal(result.ok, true);
  assert.equal(result.save.monballs, 6);
  assert.equal(result.save.money, 1150);
  assert.ok(result.save.questState.dailyClaimedChests.includes(60));
});