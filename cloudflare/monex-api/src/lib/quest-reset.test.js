import test from "node:test";
import assert from "node:assert/strict";
import { applyQuestResetsToState } from "./quest-reset.js";

test("applyQuestResetsToState resets stale daily tasks and milestones together", () => {
  const now = new Date("2026-07-14T20:00:00.000Z");
  const qs = {
    dailyResetKey: "2026-07-14",
    weeklyResetKey: "2026-W28",
    dailyPoints: 0,
    weeklyPoints: 0,
    dailyClaimedChests: [],
    weeklyClaimedChests: [],
    grantedKeys: ["task:dailies:d1", "chest:dailies:20"],
    tasks: {
      dailies: [{ id: "d1", progress: 2, claimed: true }],
      weeklies: [{ id: "w1", progress: 0, claimed: false }],
      campaign: [],
    },
  };

  const changed = applyQuestResetsToState(qs, now);

  assert.equal(changed, true);
  assert.equal(qs.dailyResetKey, "2026-07-15");
  assert.equal(qs.dailyPoints, 0);
  assert.deepEqual(qs.dailyClaimedChests, []);
  assert.equal(qs.tasks.dailies.every((t) => t.progress === 0 && !t.claimed), true);
  assert.equal(qs.grantedKeys.includes("task:dailies:d1"), false);
});

test("applyQuestResetsToState repairs milestone/task desync", () => {
  const now = new Date("2026-07-14T20:00:00.000Z");
  const qs = {
    dailyResetKey: "2026-07-15",
    weeklyResetKey: "2026-W29",
    dailyPoints: 0,
    weeklyPoints: 0,
    dailyClaimedChests: [],
    weeklyClaimedChests: [],
    grantedKeys: [],
    tasks: {
      dailies: [{ id: "d1", progress: 2, claimed: true }],
      weeklies: [{ id: "w1", progress: 0, claimed: false }],
      campaign: [],
    },
  };

  const changed = applyQuestResetsToState(qs, now);

  assert.equal(changed, true);
  assert.equal(qs.tasks.dailies[0].progress, 0);
  assert.equal(qs.tasks.dailies[0].claimed, false);
});

test("applyQuestResetsToState resets weekly bundle and aligned dailies", () => {
  const now = new Date("2026-07-14T20:00:00.000Z");
  const qs = {
    dailyResetKey: "2026-07-14",
    weeklyResetKey: "2026-W28",
    dailyPoints: 40,
    weeklyPoints: 60,
    dailyClaimedChests: [20],
    weeklyClaimedChests: [20, 40],
    grantedKeys: ["task:weeklies:w1", "chest:weeklies:20"],
    tasks: {
      dailies: [{ id: "d1", progress: 1, claimed: false }],
      weeklies: [{ id: "w1", progress: 3, claimed: true }],
      campaign: [],
    },
  };

  const changed = applyQuestResetsToState(qs, now);

  assert.equal(changed, true);
  assert.equal(qs.weeklyPoints, 0);
  assert.equal(qs.dailyPoints, 0);
  assert.deepEqual(qs.weeklyClaimedChests, []);
  assert.deepEqual(qs.dailyClaimedChests, []);
  assert.equal(qs.tasks.weeklies.every((t) => t.progress === 0 && !t.claimed), true);
  assert.equal(qs.tasks.dailies.every((t) => t.progress === 0 && !t.claimed), true);
});
