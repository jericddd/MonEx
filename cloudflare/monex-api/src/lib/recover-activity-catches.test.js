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
    mons: [{ name: "Monigga", rarity: "Common", skills: "★Blood Moon" }],
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

  it("latestOnly keeps only the newest catch session", () => {
    const entries = [
      {
        id: "act_old",
        xUsername: "Lucci_Crypto",
        spend: 5,
        status: "success",
        at: "2026-07-10T12:00:00.000Z",
        mons: [{ name: "Chog", rarity: "Common", skills: "★Slash" }],
      },
      {
        id: "act_new",
        xUsername: "Lucci_Crypto",
        spend: 18,
        status: "success",
        at: "2026-07-10T13:00:00.000Z",
        mons: Array.from({ length: 18 }, () => ({
          name: "Mouch",
          rarity: "Common",
          skills: "★Slash",
        })),
      },
    ];
    const rows = filterActivityEntries(entries, "Lucci_Crypto", { latestOnly: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "act_new");
    assert.equal(rows[0].spend, 18);
    assert.equal(rows[0].mons.length, 18);
  });
});

describe("extractRecoverableMons", () => {
  it("builds stable recovery ids per activity mon", () => {
    const mons = extractRecoverableMons(sampleActivities);
    assert.equal(mons.length, 2);
    assert.equal(mons[0].name, "Monigga");
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
    assert.ok(result.save.party.some((m) => m.name === "Monigga"));
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
    assert.equal(result.added[0].name, "Monigga");
  });

  it("keeps duplicate species from the same catch session", () => {
    const result = recoverActivityCatchesForUser({
      username: "Lucci_Crypto",
      activityEntries: [
        {
          id: "act_multi",
          tweetId: "tw_multi",
          xUserId: "999",
          xUsername: "Lucci_Crypto",
          spend: 3,
          caughtCount: 3,
          monballsLeft: 5,
          status: "success",
          at: "2026-07-10T14:00:00.000Z",
          mons: [
            { name: "Mouch", rarity: "Common", skills: "★A" },
            { name: "Mouch", rarity: "Uncommon", skills: "★B" },
            { name: "Chog", rarity: "Common", skills: "★C" },
          ],
        },
      ],
      save: { party: [], box: [], monballs: 10, xHandle: "Lucci_Crypto" },
    });
    assert.equal(result.recoverableCount, 3);
    assert.equal(result.added.length, 3);
    assert.equal(result.save.party.length + result.save.box.length, 3);
  });

  it("replaceInventory rebuilds party/box from activity only", () => {
    const result = recoverActivityCatchesForUser({
      username: "Lucci_Crypto",
      activityEntries: sampleActivities,
      save: {
        party: [{ name: "Chog", rarity: "Common", level: 99 }],
        box: [{ name: "Extra", rarity: "Common", level: 1 }],
        monballs: 10,
        xHandle: "Lucci_Crypto",
      },
      replaceInventory: true,
    });
    assert.equal(result.added.length, 2);
    assert.equal(result.save.party.length + result.save.box.length, 2);
    assert.ok(!result.save.party.some((m) => m.level === 99));
  });

  it("skips mons intentionally released by the player", () => {
    const result = recoverActivityCatchesForUser({
      username: "Lucci_Crypto",
      activityEntries: sampleActivities,
      save: {
        party: [],
        box: [],
        monballs: 8,
        xHandle: "Lucci_Crypto",
        releasedRecoveryIds: ["recovery_act_2_0", "activity:act_2:0"],
        releaseLog: [
          {
            id: "rel_1",
            at: "2026-07-13T00:00:00.000Z",
            name: "Shramp",
            rarity: "Common",
            level: 1,
            recoveryId: "recovery_act_2_0",
            instanceId: "recovery_act_2_0",
            source: "box",
          },
        ],
      },
    });

    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].name, "Monigga");
    assert.equal(result.skipped.some((row) => row.reason === "released_by_user"), true);
  });
});
