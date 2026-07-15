import test from "node:test";
import assert from "node:assert/strict";
import {
  claimBattleReward,
  computeAdventureReward,
  computePatrolReward,
  isBossStage,
  mergeBattleClaimOntoLatest,
  buildCampaignCompletionId,
} from "./battle-reward.js";
import { writeCloudSave } from "./save.js";
import { getDailyDayKey } from "./daily-reset.js";

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
    claimId: "campaign:chapter-1:stage-1:first-clear",
    expectedRevision: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.completionId, "campaign:chapter-1:stage-1:first-clear");
  assert.equal(result.save.currentStage, 2);
  assert.ok(result.reward.gold > 0);
  assert.ok(result.save.accountBattleCompletions["campaign:chapter-1:stage-1:first-clear"]);

  const d1 = result.save.questState.tasks.dailies.find((t) => t.id === "d1");
  assert.equal(d1?.progress, 1);
  const d13 = result.save.questState.tasks.dailies.find((t) => t.id === "d13");
  assert.equal(d13?.progress, 1);

  const dup = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: "campaign:chapter-1:stage-1:first-clear",
    expectedRevision: result.save.revision,
  });
  assert.equal(dup.alreadyClaimed, true);
});

test("alreadyClaimed repairs playhead when stale autosave rolled it back", async () => {
  const completionId = buildCampaignCompletionId(1, 5);
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 3,
      currentChapter: 1,
      currentStage: 5,
      adventureGlobalBest: 5,
      highestStageCleared: 5,
      money: 1000,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      accountBattleCompletions: {
        [completionId]: {
          at: "2026-07-14T00:00:00.000Z",
          mode: "adventure",
          reward: { gold: 140, essence: 30, monShards: 0, trainerXp: 175, gear: null },
        },
      },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "Daniel_Freire15" };

  const result = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: completionId,
    chapter: 1,
    stage: 5,
    expectedRevision: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.alreadyClaimed, true);
  assert.equal(result.save.currentStage, 6);
  assert.equal(result.save.adventureGlobalBest, 5);
});

test("Chapter 1-26 claim adds reward and persists completion ledger", async () => {
  const moneyBefore = 5000;
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 10,
      currentChapter: 1,
      currentStage: 26,
      adventureGlobalBest: 25,
      highestStageCleared: 25,
      money: moneyBefore,
      essence: 100,
      monShards: 2,
      trainerXp: 500,
      gearInventory: [],
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };
  const completionId = buildCampaignCompletionId(1, 26);

  const result = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: completionId,
    chapter: 1,
    stage: 26,
    expectedRevision: 10,
  });

  assert.equal(result.ok, true);
  assert.equal(result.completionId, completionId);
  assert.equal(result.save.adventureGlobalBest, 26);
  assert.equal(result.save.currentStage, 27);
  assert.ok(result.save.money > moneyBefore);
  assert.ok(result.save.accountBattleCompletions[completionId]);

  const retry = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: completionId,
    chapter: 1,
    stage: 26,
    expectedRevision: result.save.revision,
  });
  assert.equal(retry.alreadyClaimed, true);
  assert.equal(retry.save.money, result.save.money);
});

test("claimBattleReward survives stale revision conflict via merge retry", async () => {
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 5,
      currentChapter: 1,
      currentStage: 26,
      adventureGlobalBest: 25,
      money: 5000,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };

  await writeCloudSave(kv, "u1", {
    ...JSON.parse(store["monex:save:u1"]),
    money: 5200,
    revision: 5,
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  }, { expectedRevision: 5 });

  const result = await claimBattleReward(kv, session, {
    mode: "adventure",
    win: true,
    claimId: buildCampaignCompletionId(1, 26),
    chapter: 1,
    stage: 26,
    expectedRevision: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.save.adventureGlobalBest, 26);
  assert.ok(result.save.money > 5200);
});

test("claimBattleReward patrol win grants resources with stable completion id", async () => {
  const patrolDay = getDailyDayKey();
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
      patrolScansDay: patrolDay,
      patrolScansUsed: 2,
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };
  const legacyId = `patrol:day-${patrolDay}:scan-2:common`;

  const result = await claimBattleReward(kv, session, {
    mode: "patrol",
    win: true,
    encounterId: "common",
    claimId: legacyId,
    expectedRevision: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.save.currentStage, 6);
  assert.equal(result.save.patrolScansUsed, 2);
  assert.ok(result.reward.gold > 0);
  assert.ok(result.save.accountBattleCompletions[legacyId]);
  const d4 = result.save.questState.tasks.dailies.find((t) => t.id === "d4");
  assert.equal(d4?.progress, 1);
  const d11 = result.save.questState.tasks.dailies.find((t) => t.id === "d11");
  assert.equal(d11?.progress, 1);
});

test("claimBattleReward patrol token win deducts attempt atomically with reward", async () => {
  const patrolDay = getDailyDayKey();
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 3,
      currentChapter: 2,
      currentStage: 5,
      adventureGlobalBest: 45,
      money: 100,
      essence: 10,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      patrolScansDay: patrolDay,
      patrolScansUsed: 4,
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };
  const completionId = "patrol:token:abc-123";

  const result = await claimBattleReward(kv, session, {
    mode: "patrol",
    win: true,
    encounterId: "rare",
    claimId: completionId,
    expectedRevision: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.completionId, completionId);
  assert.equal(result.save.patrolScansUsed, 5);
  assert.ok(result.save.money > 100);
  assert.ok(result.save.accountBattleCompletions[completionId]);

  const dup = await claimBattleReward(kv, session, {
    mode: "patrol",
    win: true,
    encounterId: "rare",
    claimId: completionId,
    expectedRevision: result.save.revision,
  });
  assert.equal(dup.alreadyClaimed, true);
  assert.equal(dup.save.patrolScansUsed, 5);
  assert.equal(dup.save.money, result.save.money);
});

test("claimBattleReward patrol token loss deducts attempt without reward", async () => {
  const patrolDay = getDailyDayKey();
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 1,
      currentChapter: 1,
      currentStage: 1,
      adventureGlobalBest: 0,
      money: 500,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      patrolScansDay: patrolDay,
      patrolScansUsed: 1,
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };
  const completionId = "patrol:token:loss-1";

  const result = await claimBattleReward(kv, session, {
    mode: "patrol",
    win: false,
    encounterId: "common",
    claimId: completionId,
    expectedRevision: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.save.patrolScansUsed, 2);
  assert.equal(result.save.money, 500);
  assert.equal(result.reward.gold, 0);
  assert.ok(result.save.accountBattleCompletions[completionId]);
});

test("claimBattleReward patrol token rejects when no attempts remain", async () => {
  const patrolDay = getDailyDayKey();
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 1,
      currentChapter: 1,
      currentStage: 1,
      adventureGlobalBest: 0,
      money: 0,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      patrolScansDay: patrolDay,
      patrolScansUsed: 50,
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };

  const result = await claimBattleReward(kv, session, {
    mode: "patrol",
    win: true,
    encounterId: "common",
    claimId: "patrol:token:should-fail",
    expectedRevision: 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "no_patrol_attempts");
});

test("claimBattleReward patrol token does not deduct attempt when save write fails", async () => {
  const patrolDay = getDailyDayKey();
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 1,
      currentChapter: 1,
      currentStage: 1,
      adventureGlobalBest: 0,
      money: 100,
      essence: 0,
      monShards: 0,
      trainerXp: 0,
      gearInventory: [],
      patrolScansDay: patrolDay,
      patrolScansUsed: 4,
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  };
  const kv = {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      if (key.startsWith("monex:save:")) {
        throw new Error("simulated_kv_failure");
      }
      store[key] = value;
    },
  };
  const session = { xUserId: "u1", username: "trainer" };

  await assert.rejects(
    () => claimBattleReward(kv, session, {
      mode: "patrol",
      win: true,
      encounterId: "common",
      claimId: "patrol:token:fail-write",
      expectedRevision: 1,
    }),
    /simulated_kv_failure/,
  );

  const saved = JSON.parse(store["monex:save:u1"]);
  assert.equal(saved.patrolScansUsed, 4);
  assert.equal(saved.money, 100);
});

test("syncCampaignQuestProgress creates missing campaign tasks", async () => {
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 1,
      currentChapter: 1,
      currentStage: 10,
      adventureGlobalBest: 9,
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
    mode: "adventure",
    win: true,
    claimId: "campaign:chapter-1:stage-10:first-clear",
    expectedRevision: 1,
  });

  assert.equal(result.ok, true);
  const c1 = result.save.questState.tasks.campaign.find((t) => t.id === "c1");
  assert.equal(c1?.progress, 1);
});

test("mergeBattleClaimOntoLatest preserves reward deltas on revision retry", () => {
  const original = {
    money: 100,
    essence: 0,
    monShards: 0,
    trainerXp: 0,
    gearInventory: [],
    adventureGlobalBest: 0,
    currentChapter: 1,
    currentStage: 1,
    questState: { tasks: { dailies: [{ id: "d1", progress: 0, claimed: false }], weeklies: [], campaign: [] } },
    accountBattleCompletions: {},
  };
  const intended = {
    money: 250,
    essence: 20,
    monShards: 1,
    trainerXp: 75,
    gearInventory: [{ id: "g1", slot: "weapon", tier: 1 }],
    adventureGlobalBest: 1,
    currentChapter: 1,
    currentStage: 2,
    highestStageCleared: 1,
    questState: {
      tasks: {
        dailies: [{ id: "d1", progress: 1, claimed: false }],
        weeklies: [],
        campaign: [{ id: "c1", progress: 0, claimed: false }],
      },
    },
    accountBattleCompletions: {
      "campaign:chapter-1:stage-1:first-clear": {
        at: "2026-07-14T00:00:00.000Z",
        mode: "adventure",
        reward: { gold: 150, essence: 20, monShards: 1, trainerXp: 75, gear: null },
      },
    },
  };
  const latest = {
    money: 500,
    essence: 5,
    monShards: 0,
    trainerXp: 10,
    gearInventory: [],
    adventureGlobalBest: 0,
    currentChapter: 1,
    currentStage: 1,
    questState: { tasks: { dailies: [{ id: "d1", progress: 0, claimed: false }], weeklies: [], campaign: [] } },
    accountBattleCompletions: {},
  };

  const merged = mergeBattleClaimOntoLatest(latest, original, intended);
  assert.equal(merged.money, 650);
  assert.equal(merged.essence, 25);
  assert.equal(merged.trainerXp, 85);
  assert.equal(merged.currentStage, 2);
  assert.equal(merged.adventureGlobalBest, 1);
  assert.equal(merged.questState.tasks.dailies[0].progress, 1);
  assert.ok(merged.accountBattleCompletions["campaign:chapter-1:stage-1:first-clear"]);
});
