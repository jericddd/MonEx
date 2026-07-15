import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_QUEST_FORCE_RESET_ID,
  DAILY_QUEST_UTC8_RESET_ID,
  applyOneTimeDailyQuestResetIfNeeded,
  hasAppliedQuestOneTimeReset,
  reconcileOneTimeDailyQuestReset,
} from "./quest-one-time-reset.js";
import { applyQuestResetsToState } from "./quest-reset.js";
import { getDailyDayKey } from "./daily-reset.js";
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

test("applyOneTimeDailyQuestResetIfNeeded clears today's dailies but preserves campaign", () => {
  const now = new Date("2026-07-15T04:00:00.000Z");
  const save = {
    revision: 2,
    money: 5000,
    questMonballPaidAmounts: { "task:campaign:c1": 15 },
    questState: {
      dailyResetKey: getDailyDayKey(now),
      weeklyResetKey: "2026-W29",
      dailyPoints: 45,
      weeklyPoints: 20,
      dailyClaimedChests: [20, 40],
      weeklyClaimedChests: [],
      grantedKeys: ["task:dailies:d1", "task:campaign:c1", "chest:dailies:20"],
      tasks: {
        dailies: [{ id: "d1", progress: 2, claimed: true }],
        weeklies: [{ id: "w1", progress: 1, claimed: false }],
        campaign: [{ id: "c1", progress: 1, claimed: true }],
      },
    },
  };

  const { save: next, changed } = applyOneTimeDailyQuestResetIfNeeded(save, now);

  assert.equal(changed, true);
  assert.equal(hasAppliedQuestOneTimeReset(next), true);
  assert.equal(next.questState.dailyPoints, 0);
  assert.deepEqual(next.questState.dailyClaimedChests, []);
  assert.equal(next.questState.tasks.dailies.every((task) => task.progress === 0 && !task.claimed), true);
  assert.equal(next.questState.tasks.dailies.length, QUEST_TASK_DEFS.dailies.length);
  assert.equal(next.questState.tasks.campaign[0].claimed, true);
  assert.equal(next.questState.tasks.weeklies[0].progress, 1);
  assert.equal(next.questState.grantedKeys.includes("task:campaign:c1"), true);
  assert.equal(next.questState.grantedKeys.includes("task:dailies:d1"), false);
  assert.equal(next.questMonballPaidAmounts["task:campaign:c1"], 15);
  assert.equal(next.money, 5000);
});

test("applyOneTimeDailyQuestResetIfNeeded runs only once per reset id", () => {
  const now = new Date("2026-07-15T04:00:00.000Z");
  const first = applyOneTimeDailyQuestResetIfNeeded(
    {
      questState: {
        dailyResetKey: getDailyDayKey(now),
        tasks: { dailies: [{ id: "d1", progress: 2, claimed: true }], weeklies: [], campaign: [] },
        grantedKeys: ["task:dailies:d1"],
        dailyPoints: 15,
        dailyClaimedChests: [],
      },
    },
    now
  );
  assert.equal(first.changed, true);

  first.save.questState.tasks.dailies[0].progress = 2;
  first.save.questState.tasks.dailies[0].claimed = true;
  const second = applyOneTimeDailyQuestResetIfNeeded(first.save, now);
  assert.equal(second.changed, false);
  assert.equal(second.save.questState.tasks.dailies[0].progress, 2);
  assert.equal(second.save.questState.tasks.dailies[0].claimed, true);
});

test("second one-time reset id forces fresh dailies for already-migrated accounts", () => {
  const now = new Date("2026-07-16T04:00:00.000Z");
  const save = {
    questOneTimeResetsApplied: [DAILY_QUEST_FORCE_RESET_ID],
    questState: {
      dailyResetKey: getDailyDayKey(now),
      weeklyResetKey: "2026-W29",
      dailyPoints: 40,
      weeklyPoints: 0,
      dailyClaimedChests: [20],
      weeklyClaimedChests: [],
      grantedKeys: ["task:dailies:d1", "chest:dailies:20"],
      tasks: {
        dailies: [{ id: "d1", progress: 2, claimed: true }],
        weeklies: [],
        campaign: [],
      },
    },
  };
  const { save: next, changed } = applyOneTimeDailyQuestResetIfNeeded(save, now);
  assert.equal(changed, true);
  assert.equal(hasAppliedQuestOneTimeReset(next, DAILY_QUEST_UTC8_RESET_ID), true);
  assert.equal(next.questState.dailyPoints, 0);
  assert.deepEqual(next.questState.dailyClaimedChests, []);
  assert.equal(next.questState.tasks.dailies.every((task) => task.progress === 0 && !task.claimed), true);
});

test("regular daily reset still runs on the next UTC+8 day after one-time reset", () => {
  const resetDay = new Date("2026-07-15T04:00:00.000Z");
  const { save } = applyOneTimeDailyQuestResetIfNeeded(
    {
      questOneTimeResetsApplied: [],
      questState: {
        dailyResetKey: getDailyDayKey(resetDay),
        weeklyResetKey: "2026-W29",
        dailyPoints: 30,
        weeklyPoints: 0,
        dailyClaimedChests: [20],
        weeklyClaimedChests: [],
        grantedKeys: ["task:dailies:d1"],
        tasks: {
          dailies: [{ id: "d1", progress: 2, claimed: true }],
          weeklies: [],
          campaign: [],
        },
      },
    },
    resetDay
  );

  const nextDay = new Date("2026-07-16T04:00:00.000Z");
  save.questState.tasks.dailies[0].progress = 1;
  save.questState.tasks.dailies[0].claimed = false;
  save.questState.dailyPoints = 10;

  const changed = applyQuestResetsToState(save.questState, nextDay);
  assert.equal(changed, true);
  assert.equal(save.questState.dailyResetKey, getDailyDayKey(nextDay));
  assert.equal(save.questState.dailyPoints, 0);
  assert.equal(save.questState.tasks.dailies.every((task) => task.progress === 0 && !task.claimed), true);
  assert.equal(hasAppliedQuestOneTimeReset(save), true);
  assert.equal(save.questOneTimeResetsApplied.includes(DAILY_QUEST_FORCE_RESET_ID), true);
});

test("reconcileOneTimeDailyQuestReset persists migration flag once", async () => {
  const now = new Date("2026-07-15T04:00:00.000Z");
  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 1,
      party: [],
      box: [],
      questState: {
        dailyResetKey: getDailyDayKey(now),
        tasks: {
          dailies: [{ id: "d1", progress: 2, claimed: true }],
          weeklies: [],
          campaign: [],
        },
        grantedKeys: ["task:dailies:d1"],
        dailyPoints: 15,
        dailyClaimedChests: [],
      },
      updatedAt: now.toISOString(),
    }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };

  const first = await reconcileOneTimeDailyQuestReset(kv, session, JSON.parse(store["monex:save:u1"]), now);
  assert.equal(hasAppliedQuestOneTimeReset(first), true);
  assert.equal(first.questState.tasks.dailies[0].claimed, false);

  first.questState.tasks.dailies[0].progress = 2;
  first.questState.tasks.dailies[0].claimed = true;
  const second = await reconcileOneTimeDailyQuestReset(kv, session, first, now);
  assert.equal(second.questState.tasks.dailies[0].claimed, true);
  assert.equal(second.revision, first.revision);
});
