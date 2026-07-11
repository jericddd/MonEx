import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./daily-reset.js";
import "./patrol-reset.js";

const daily = globalThis.MonExDailyReset;
const patrol = globalThis.MonExPatrolReset;

describe("getPatrolDayKey UTC+8", () => {
  it("matches UTC+8 calendar date", () => {
    assert.equal(
      patrol.getPatrolDayKey(new Date("2026-07-10T23:30:00.000Z")),
      "2026-07-11"
    );
  });

  it("rolls over at 16:00 UTC (00:00 UTC+8)", () => {
    assert.equal(
      patrol.getPatrolDayKey(new Date("2026-07-10T16:30:00.000Z")),
      "2026-07-11"
    );
  });
});

describe("applyPatrolDailyReset UTC+8", () => {
  it("keeps usage within the same UTC+8 day", () => {
    const now = new Date("2026-07-10T14:00:00.000Z");
    const result = patrol.applyPatrolDailyReset(50, "2026-07-10", now);
    assert.equal(result.changed, false);
    assert.equal(result.patrolScansUsed, 50);
  });

  it("resets at 00:00 UTC+8 (16:00 UTC)", () => {
    const now = new Date("2026-07-10T16:05:00.000Z");
    const result = patrol.applyPatrolDailyReset(50, "2026-07-10", now);
    assert.equal(result.changed, true);
    assert.equal(result.patrolScansUsed, 0);
    assert.equal(result.patrolScansDay, "2026-07-11");
  });
});

describe("mergePatrolProgress UTC+8", () => {
  it("keeps max usage for today across local and cloud", () => {
    const now = new Date("2026-07-10T18:00:00.000Z");
    const merged = patrol.mergePatrolProgress(
      { patrolScansDay: "2026-07-11", patrolScansUsed: 50 },
      { patrolScansDay: "2026-07-09", patrolScansUsed: 0 },
      now
    );
    assert.equal(merged.patrolScansUsed, 50);
    assert.equal(merged.patrolScansDay, "2026-07-11");
  });

  it("does not restore scans from stale cloud day after UTC+8 reset", () => {
    const now = new Date("2026-07-10T17:00:00.000Z");
    const merged = patrol.mergePatrolProgress(
      { patrolScansDay: "2026-07-11", patrolScansUsed: 0 },
      { patrolScansDay: "2026-07-10", patrolScansUsed: 50 },
      now
    );
    assert.equal(merged.patrolScansUsed, 0);
    assert.equal(merged.patrolScansDay, "2026-07-11");
  });
});

describe("quest milestone daily reset expectation", () => {
  it("UTC+8 day key advances at 16:00 UTC for quest dailyResetKey", () => {
    const before = daily.getDailyDayKey(new Date("2026-07-10T15:00:00.000Z"));
    const after = daily.getDailyDayKey(new Date("2026-07-10T17:00:00.000Z"));
    assert.equal(before, "2026-07-10");
    assert.equal(after, "2026-07-11");
  });
});
