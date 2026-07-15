import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignPersonalCatchLogRef,
  attachPersonalLogNumbers,
  filterUserSuccessfulCatchEntries,
  inferPersonalCatchLogSeq,
  resolvePersonalCatchLog,
  personalCatchLogRefKey,
} from "./personal-catch-log.js";

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

describe("personal catch log references", () => {
  it("assigns permanent increasing log numbers per user", async () => {
    const store = {
      "monex:activity": JSON.stringify({ entries: [] }),
    };
    const kv = makeKv(store);
    const catchUser = { username: "trainer", monballs: 10, pendingMons: [] };

    const first = await assignPersonalCatchLogRef(kv, catchUser, {
      xUserId: "u1",
      username: "trainer",
      tweetId: "tw1",
      activityId: "act1",
      catchId: "catch_tw1",
      at: "2026-07-01T00:00:00.000Z",
      activity: { spend: 1, monballsBefore: 10, monballsLeft: 9, caughtCount: 1 },
      receipt: { claimModel: "deferred" },
    });
    const second = await assignPersonalCatchLogRef(kv, catchUser, {
      xUserId: "u1",
      username: "trainer",
      tweetId: "tw2",
      activityId: "act2",
      catchId: "catch_tw2",
      at: "2026-07-02T00:00:00.000Z",
      activity: { spend: 2, monballsBefore: 9, monballsLeft: 7, caughtCount: 1 },
      receipt: { claimModel: "deferred" },
    });

    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(catchUser.personalCatchLogSeq, 2);

    const ref = JSON.parse(store[personalCatchLogRefKey("u1", 1)]);
    assert.equal(ref.tweetId, "tw1");
    assert.equal(ref.spend, 1);
    assert.equal(ref.monballsLeft, 9);
  });

  it("reuses stored number on retry for same tweet", async () => {
    const store = {
      "monex:activity": JSON.stringify({ entries: [] }),
    };
    const kv = makeKv(store);
    const catchUser = { username: "trainer", personalCatchLogSeq: 1, pendingMons: [] };
    await assignPersonalCatchLogRef(kv, catchUser, {
      xUserId: "u1",
      username: "trainer",
      tweetId: "tw1",
      activityId: "act1",
      catchId: "catch_tw1",
      at: "2026-07-01T00:00:00.000Z",
      activity: { spend: 1 },
      receipt: { personalLogNumber: 1 },
    });
    const again = await assignPersonalCatchLogRef(kv, catchUser, {
      xUserId: "u1",
      username: "trainer",
      tweetId: "tw1",
      activityId: "act1",
      catchId: "catch_tw1",
      at: "2026-07-01T00:00:00.000Z",
      activity: { spend: 1 },
      receipt: { personalLogNumber: 1 },
    });
    assert.equal(again, 1);
  });

  it("prefers stored personalLogNumber in feed attachment", () => {
    const rows = attachPersonalLogNumbers(
      [{ id: "a", personalLogNumber: 7 }, { id: "b" }],
      { total: 10, page: 1, limit: 2 }
    );
    assert.equal(rows[0].personalLogNumber, 7);
    assert.equal(rows[0].personalLogNumberSource, "stored");
    assert.equal(rows[1].personalLogNumber, 9);
    assert.equal(rows[1].personalLogNumberSource, "computed");
  });

  it("resolves support lookup by username and log number", async () => {
    const store = {
      "monex:catch-username:trainer": "u1",
      "monex:activity": JSON.stringify({
        entries: [
          {
            id: "act1",
            tweetId: "tw1",
            xUsername: "trainer",
            status: "success",
            personalLogNumber: 1,
            spend: 3,
            at: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
      [personalCatchLogRefKey("u1", 1)]: JSON.stringify({
        logNumber: 1,
        xUserId: "u1",
        username: "trainer",
        tweetId: "tw1",
        spend: 3,
        monballsBefore: 10,
        monballsLeft: 7,
      }),
      "monex:catch-receipt:tw1": JSON.stringify({
        tweetId: "tw1",
        xUserId: "u1",
        username: "trainer",
        spend: 3,
        monballsBefore: 10,
        monballsLeft: 7,
        personalLogNumber: 1,
        claimModel: "deferred",
        spendApplied: true,
        completionStatus: "completed",
        mons: [],
        catchLogStatus: "written",
        deliveryStatus: "delivered",
      }),
    };
    const kv = makeKv(store);
    const resolved = await resolvePersonalCatchLog(kv, { username: "trainer", logNumber: 1 });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.tweetId, "tw1");
    assert.equal(resolved.ref.spend, 3);
    assert.equal(resolved.receipt.personalLogNumber, 1);
  });
});

describe("inferPersonalCatchLogSeq", () => {
  it("uses max stored number or chronological count", () => {
    const entries = [
      { status: "success", xUsername: "trainer", personalLogNumber: 4, at: "2026-07-04T00:00:00.000Z" },
      { status: "success", xUsername: "trainer", at: "2026-07-05T00:00:00.000Z" },
    ];
    assert.equal(inferPersonalCatchLogSeq(entries, "trainer"), 4);
    assert.equal(filterUserSuccessfulCatchEntries(entries, "trainer").length, 2);
  });
});
