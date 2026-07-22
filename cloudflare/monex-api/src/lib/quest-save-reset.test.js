import test from "node:test";
import assert from "node:assert/strict";
import { ensureCloudSaveQuestResets } from "./quest-save-reset.js";
import { getDailyDayKey, getDailyWeekKey } from "./daily-reset.js";
import { QUEST_TASK_DEFS } from "./quest-rewards.js";

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

test("ensureCloudSaveQuestResets rolls stale daily tasks and milestones at UTC+8 day boundary", async () => {
  const now = new Date();
  const todayKey = getDailyDayKey(now);
  const weekKey = getDailyWeekKey(now);
  const yesterdayKey = getDailyDayKey(new Date(now.getTime() - 36 * 60 * 60 * 1000));
  assert.notEqual(yesterdayKey, todayKey);

  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 3,
      party: [],
      box: [],
      xHandle: "trainer",
      questState: {
        dailyResetKey: yesterdayKey,
        weeklyResetKey: weekKey,
        dailyPoints: 55,
        weeklyPoints: 10,
        dailyClaimedChests: [20, 40],
        weeklyClaimedChests: [],
        grantedKeys: ["task:dailies:d1", "chest:dailies:20", "chest:dailies:60"],
        tasks: {
          dailies: [{ id: "d1", progress: 2, claimed: true }],
          weeklies: [{ id: "w1", progress: 1, claimed: false }],
          campaign: [{ id: "c1", progress: 1, claimed: true }],
        },
      },
      questMonballPaidAmounts: {
        "chest:dailies:60": 1,
        "task:campaign:c1": 15,
      },
      updatedAt: new Date(now.getTime() - 36 * 60 * 60 * 1000).toISOString(),
    }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };
  const loaded = JSON.parse(store["monex:save:u1"]);

  const next = await ensureCloudSaveQuestResets(kv, session, loaded, 10);
  assert.equal(next.questState.dailyResetKey, todayKey);
  assert.equal(next.questState.dailyPoints, 0);
  assert.deepEqual(next.questState.dailyClaimedChests, []);
  assert.equal(next.questState.tasks.dailies.length, QUEST_TASK_DEFS.dailies.length);
  assert.equal(next.questState.tasks.dailies.every((t) => t.progress === 0 && !t.claimed), true);
  assert.equal(next.questState.tasks.campaign[0].claimed, true);
  assert.equal(next.questMonballPaidAmounts["chest:dailies:60"], undefined);
  assert.equal(next.questMonballPaidAmounts["task:campaign:c1"], 15);
  assert.ok(next.revision > 3);

  const persisted = JSON.parse(store["monex:save:u1"]);
  assert.equal(persisted.questState.dailyResetKey, todayKey);
  assert.equal(persisted.questMonballPaidAmounts["chest:dailies:60"], undefined);
});

test("ensureCloudSaveQuestResets is no-op when already on current UTC+8 day", async () => {
  const now = new Date();
  const save = {
    revision: 1,
    party: [],
    box: [],
    questState: {
      dailyResetKey: getDailyDayKey(now),
      weeklyResetKey: getDailyWeekKey(now),
      dailyPoints: 0,
      weeklyPoints: 0,
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      grantedKeys: [],
      tasks: {
        dailies: QUEST_TASK_DEFS.dailies.map((def) => ({ id: def.id, progress: 0, claimed: false })),
        weeklies: [],
        campaign: [],
      },
    },
  };
  const kv = makeKv({});
  const session = { xUserId: "u1", username: "trainer" };
  const next = await ensureCloudSaveQuestResets(kv, session, save, 10);
  assert.equal(next, save);
});
