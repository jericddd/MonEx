import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterActivityEntries,
  extractRecoverableMons,
  recoverActivityCatchesForUser,
  latestMonballsFromActivity,
  usernameMatchesActivity,
} from "./recover-activity-catches.js";

const sampleActivities = [
  {
    id: "act_1",
    tweetId: "tw_1",
    xUserId: "999",
    xUsername: "Lucci_Crypto",
    spend: 1,
    caughtCount: 1,
    monballsLeft: 9,
    status: "success",
    at: "2026-07-10T12:54:39.000Z",
    mons: [{ name: "Mosferatu", rarity: "Common", skills: "★Blood Moon" }],
  },
  {
    id: "act_2",
    tweetId: "tw_2",
    xUserId: "999",
    xUsername: "Lucci_Crypto",
    spend: 1,
    caughtCount: 1,
    monballsLeft: 8,
    status: "success",
    at: "2026-07-10T12:54:40.000Z",
    mons: [{ name: "Shramp", rarity: "Common", skills: "★Bubble Barrage" }],
  },
];

describe("usernameMatchesActivity", () => {
  it("matches exact case by default", () => {
    assert.equal(usernameMatchesActivity("Lucci_Crypto", "Lucci_Crypto"), true);
    assert.equal(usernameMatchesActivity("Lucci_Crypto", "lucci_crypto"), false);
  });
});

describe("filterActivityEntries", () => {
  it("returns successful catches for exact username", () => {
    const rows = filterActivityEntries(sampleActivities, "Lucci_Crypto");
    assert.equal(rows.length, 2);
  });

  it("filters by spend when recovering a single catch session", () => {
    const entries = [
      ...sampleActivities,
      {
        id: "act_18",
        xUsername: "Lucci_Crypto",
        spend: 18,
        caughtCount: 18,
        monballsLeft: 0,
        status: "success",
        at: "2026-07-10T13:00:00.000Z",
        mons: Array.from({ length: 18 }, (_, i) => ({
          name: i % 2 === 0 ? "Chog" : "Mouch",
          rarity: "Common",
          skills: "★Slash",
        })),
      },
    ];
    const rows = filterActivityEntries(entries, "Lucci_Crypto", { spend: 18 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].spend, 18);
    assert.equal(rows[0].mons.length, 18);
  });
});

describe("extractRecoverableMons", () => {
  it("builds stable recovery ids per activity mon", () => {
    const mons = extractRecoverableMons(sampleActivities);
    assert.equal(mons.length, 2);
    assert.equal(mons[0].name, "Mosferatu");
    assert.equal(mons[1].name, "Shramp");
    assert.match(mons[0].recoveryId, /^recovery_act_1_0$/);
  });
});

describe("latestMonballsFromActivity", () => {
  it("uses the most recent activity entry", () => {
    assert.equal(latestMonballsFromActivity(sampleActivities), 8);
  });
});

describe("recoverActivityCatchesForUser", () => {
  it("adds missing mons to party and sets monballs from latest log", () => {
    const result = recoverActivityCatchesForUser({
      username: "Lucci_Crypto",
      activityEntries: sampleActivities,
      save: { party: [], box: [], monballs: 10, xHandle: "Lucci_Crypto" },
    });

    assert.equal(result.added.length, 2);
    assert.equal(result.save.party.length, 2);
    assert.equal(result.save.monballs, 8);
    assert.ok(result.save.party.some((m) => m.name === "Shramp"));
    assert.ok(result.save.party.some((m) => m.name === "Mosferatu"));
  });

  it("skips mons already recovered", () => {
    const result = recoverActivityCatchesForUser({
      username: "Lucci_Crypto",
      activityEntries: sampleActivities,
      save: {
        party: [{ name: "Shramp", rarity: "Common", level: 1, wildPendingId: "recovery_act_2_0", equipment: {} }],
        box: [],
        monballs: 8,
        xHandle: "Lucci_Crypto",
      },
    });

    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].name, "Mosferatu");
  });
});
