import test from "node:test";
import assert from "node:assert/strict";
import { ensureCloudSaveQuestResets } from "./quest-save-reset.js";
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

test("ensureCloudSaveQuestResets rolls stale daily tasks and milestones at UTC+8 day boundary", async () => {
  const yesterday = new Date("2026-07-15T10:00:00.000Z");
  const today = new Date("2026-07-16T04:00:00.000Z");
  assert.notEqual(getDailyDayKey(yesterday), getDailyDayKey(today));

  const store = {
    "monex:save:u1": JSON.stringify({
      revision: 3,
      party: [],
      box: [],
      xHandle: "trainer",
      questState: {
        dailyResetKey: getDailyDayKey(yesterday),
        weeklyResetKey: "2026-W29",
        dailyPoints: 55,
        weeklyPoints: 10,
        dailyClaimedChests: [20, 40],
        weeklyClaimedChests: [],
        grantedKeys: ["task:dailies:d1", "chest:dailies:20"],
        tasks: {
          dailies: [{ id: "d1", progress: 2, claimed: true }],
          weeklies: [{ id: "w1", progress: 1, claimed: false }],
          campaign: [{ id: "c1", progress: 1, claimed: true }],
        },
      },
      updatedAt: yesterday.toISOString(),
    }),
  };
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };
  const loaded = JSON.parse(store["monex:save:u1"]);

  const next = await ensureCloudSaveQuestResets(kv, session, loaded, 10);
  assert.equal(next.questState.dailyResetKey, getDailyDayKey(today));
  assert.equal(next.questState.dailyPoints, 0);
  assert.deepEqual(next.questState.dailyClaimedChests, []);
  assert.equal(next.questState.tasks.dailies.length, QUEST_TASK_DEFS.dailies.length);
  assert.equal(next.questState.tasks.dailies.every((t) => t.progress === 0 && !t.claimed), true);
  assert.equal(next.questState.tasks.campaign[0].claimed, true);
  assert.ok(next.revision > 3);

  const persisted = JSON.parse(store["monex:save:u1"]);
  assert.equal(persisted.questState.dailyResetKey, getDailyDayKey(today));
});

test("ensureCloudSaveQuestResets is no-op when already on current UTC+8 day", async () => {
  const now = new Date("2026-07-16T04:00:00.000Z");
  const save = {
    revision: 1,
    party: [],
    box: [],
    questState: {
      dailyResetKey: getDailyDayKey(now),
      weeklyResetKey: "2026-W29",
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
