import test from "node:test";
import assert from "node:assert/strict";
import {
  clampEconomyScalars,
  clampAdventureProgress,
  clampTrainerRewardLevel,
  clampResourceChestTimestamp,
  reconcileQuestState,
  clampInventoryShrink,
  guardSavePayload,
  MAX_SAVE_DELTA,
  MAX_INVENTORY_SHRINK,
} from "./save-economy-guard.js";

test("blocks arbitrary money inflation on save PUT", () => {
  const existing = { money: 5000, essence: 100, monShards: 5, trainerXp: 200 };
  const incoming = { money: 99_999_999, essence: 9_999_999, monShards: 99_999, trainerXp: 99_999_999 };
  const out = clampEconomyScalars(existing, incoming);
  assert.equal(out.money, 5000 + MAX_SAVE_DELTA.money);
  assert.equal(out.essence, 100 + MAX_SAVE_DELTA.essence);
});

test("allows legitimate per-save reward increases", () => {
  const existing = { money: 1000, essence: 50, monShards: 2, trainerXp: 100 };
  const incoming = { money: 1350, essence: 65, monShards: 4, trainerXp: 140 };
  const out = clampEconomyScalars(existing, incoming);
  assert.equal(out.money, 1350);
  assert.equal(out.essence, 65);
});

test("allows economy decreases (spends)", () => {
  const existing = { money: 5000, essence: 100, monShards: 5, trainerXp: 200 };
  const incoming = { money: 3000, essence: 80, monShards: 3, trainerXp: 150 };
  const out = clampEconomyScalars(existing, incoming);
  assert.equal(out.money, 3000);
});

test("blocks adventure stage skip exploit", () => {
  const existing = { adventureGlobalBest: 10 };
  const incoming = { adventureGlobalBest: 500 };
  const out = clampAdventureProgress(existing, incoming);
  assert.equal(out.adventureGlobalBest, 10 + MAX_SAVE_DELTA.adventureGlobalBest);
});

test("resource chest timestamp only advances forward", () => {
  const now = Date.parse("2026-07-13T12:00:00.000Z");
  const existing = { resourceChestLastCollectAt: now - 3600_000 };
  const incoming = { resourceChestLastCollectAt: now - 7200_000 };
  const out = clampResourceChestTimestamp(existing, incoming, now);
  assert.equal(out.resourceChestLastCollectAt, existing.resourceChestLastCollectAt);
});

test("strips forged quest claims without progress", () => {
  const existing = { questState: { grantedKeys: [], tasks: { dailies: [] } } };
  const incoming = {
    questState: {
      grantedKeys: [],
      dailyPoints: 0,
      weeklyPoints: 0,
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      tasks: {
        dailies: [{ id: "d1", progress: 0, claimed: true }],
        weeklies: [],
        campaign: [],
      },
    },
  };
  const out = reconcileQuestState(existing, incoming);
  assert.equal(out.questState.tasks.dailies[0].claimed, false);
});

test("allows quest claim when progress meets goal", () => {
  const existing = { questState: { grantedKeys: [], tasks: { dailies: [] } } };
  const incoming = {
    questState: {
      grantedKeys: [],
      dailyPoints: 15,
      weeklyPoints: 0,
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      tasks: {
        dailies: [{ id: "d1", progress: 2, claimed: true }],
        weeklies: [],
        campaign: [],
      },
    },
  };
  const out = reconcileQuestState(existing, incoming);
  assert.equal(out.questState.tasks.dailies[0].claimed, true);
  assert.ok(out.questState.grantedKeys.includes("task:dailies:d1"));
});

test("caps forged quest progress jumps per save", () => {
  const existing = {
    questState: {
      grantedKeys: [],
      dailyResetKey: "2026-07-13",
      tasks: {
        dailies: [{ id: "d1", progress: 0, claimed: false }],
        weeklies: [],
        campaign: [],
      },
    },
  };
  const incoming = {
    questState: {
      grantedKeys: [],
      dailyResetKey: "2026-07-13",
      dailyPoints: 0,
      weeklyPoints: 0,
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      tasks: {
        dailies: [{ id: "d1", progress: 9999, claimed: false }],
        weeklies: [],
        campaign: [],
      },
    },
  };
  const out = reconcileQuestState(existing, incoming);
  assert.equal(out.questState.tasks.dailies[0].progress, 2);
});

test("caps forged quest points jumps per save", () => {
  const existing = {
    questState: {
      grantedKeys: [],
      dailyResetKey: "2026-07-13",
      dailyPoints: 10,
      weeklyPoints: 0,
      tasks: { dailies: [], weeklies: [], campaign: [] },
    },
  };
  const incoming = {
    questState: {
      grantedKeys: [],
      dailyResetKey: "2026-07-13",
      dailyPoints: 100,
      weeklyPoints: 0,
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      tasks: { dailies: [], weeklies: [], campaign: [] },
    },
  };
  const out = reconcileQuestState(existing, incoming);
  assert.equal(out.questState.dailyPoints, 35);
});

test("caps trainer reward level jumps per save", () => {
  const existing = { trainerRewardLevel: 5 };
  const incoming = { trainerRewardLevel: 20 };
  const out = clampTrainerRewardLevel(existing, incoming);
  assert.equal(out.trainerRewardLevel, 8);
});

test("blocks catastrophic party/box shrink on save PUT", () => {
  const existing = {
    party: Array.from({ length: 4 }, (_, i) => ({ name: "Chog", level: i + 1 })),
    box: Array.from({ length: 257 }, (_, i) => ({ name: "Molandak", level: (i % 10) + 1 })),
  };
  const incoming = {
    party: [{ name: "Chog", level: 1 }],
    box: [{ name: "Molandak", level: 1 }, { name: "Mouch", level: 2 }, { name: "Chog", level: 3 }],
  };
  const out = clampInventoryShrink(existing, incoming);
  assert.equal(out.party.length, 4);
  assert.equal(out.box.length, 257);
});

test("allows small legitimate inventory shrink (releases)", () => {
  const existing = {
    party: [{ name: "Chog", level: 1 }],
    box: Array.from({ length: 10 }, () => ({ name: "Molandak", level: 1 })),
  };
  const incoming = {
    party: [{ name: "Chog", level: 1 }],
    box: existing.box.slice(0, 10 - Math.min(3, MAX_INVENTORY_SHRINK)),
  };
  const out = clampInventoryShrink(existing, incoming);
  assert.equal(out.box.length, incoming.box.length);
});

test("guardSavePayload preserves large box against stale shrink", () => {
  const existing = {
    money: 1000,
    adventureGlobalBest: 5,
    party: [{ name: "Chog", level: 1 }],
    box: Array.from({ length: 200 }, () => ({ name: "Molandak", level: 1 })),
    questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
  };
  const incoming = {
    money: 1100,
    adventureGlobalBest: 5,
    party: [{ name: "Chog", level: 1 }],
    box: [{ name: "Molandak", level: 1 }],
    questState: {
      grantedKeys: [],
      dailyPoints: 0,
      weeklyPoints: 0,
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      tasks: { dailies: [], weeklies: [], campaign: [] },
    },
  };
  const out = guardSavePayload(existing, incoming, { now: Date.now() });
  assert.equal(out.box.length, 200);
  assert.equal(out.money, 1100);
});

test("guardSavePayload applies all guards", () => {
  const existing = {
    money: 1000,
    adventureGlobalBest: 5,
    party: [],
    box: [],
    questState: { grantedKeys: [], tasks: { dailies: [], weeklies: [], campaign: [] } },
  };
  const incoming = {
    money: 99_999_999,
    adventureGlobalBest: 999,
    party: [],
    box: [],
    questState: {
      grantedKeys: [],
      dailyPoints: 0,
      weeklyPoints: 0,
      dailyClaimedChests: [100],
      weeklyClaimedChests: [],
      tasks: { dailies: [], weeklies: [], campaign: [] },
    },
  };
  const out = guardSavePayload(existing, incoming, { now: Date.now() });
  assert.ok(out.money < 99_999_999);
  assert.ok(out.adventureGlobalBest < 999);
  assert.equal(out.questState.dailyClaimedChests.length, 0);
});
