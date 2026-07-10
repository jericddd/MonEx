import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getPatrolDayKey,
  applyPatrolDailyReset,
  mergePatrolProgress,
} from "./patrol-reset.js";

describe("getPatrolDayKey", () => {
  it("uses UTC calendar date", () => {
    const key = getPatrolDayKey(new Date("2026-07-10T23:30:00.000Z"));
    assert.equal(key, "2026-07-10");
  });

  it("does not roll over at 16:00 UTC (old UTC+8 boundary)", () => {
    const key = getPatrolDayKey(new Date("2026-07-10T16:30:00.000Z"));
    assert.equal(key, "2026-07-10");
  });
});

describe("applyPatrolDailyReset", () => {
  it("keeps usage within the same UTC day", () => {
    const now = new Date("2026-07-10T14:00:00.000Z");
    const result = applyPatrolDailyReset(50, "2026-07-10", now);
    assert.equal(result.changed, false);
    assert.equal(result.patrolScansUsed, 50);
  });

  it("resets at UTC midnight", () => {
    const now = new Date("2026-07-11T00:05:00.000Z");
    const result = applyPatrolDailyReset(50, "2026-07-10", now);
    assert.equal(result.changed, true);
    assert.equal(result.patrolScansUsed, 0);
    assert.equal(result.patrolScansDay, "2026-07-11");
  });

  it("migrates legacy UTC+8 day key without wiping usage", () => {
    const now = new Date("2026-07-10T20:00:00.000Z");
    const result = applyPatrolDailyReset(50, "2026-07-11", now);
    assert.equal(result.changed, true);
    assert.equal(result.patrolScansUsed, 50);
    assert.equal(result.patrolScansDay, "2026-07-10");
  });
});

describe("mergePatrolProgress", () => {
  it("keeps max usage for today across local and cloud", () => {
    const now = new Date("2026-07-10T18:00:00.000Z");
    const merged = mergePatrolProgress(
      { patrolScansDay: "2026-07-10", patrolScansUsed: 50 },
      { patrolScansDay: "2026-07-11", patrolScansUsed: 0 },
      now
    );
    assert.equal(merged.patrolScansUsed, 50);
    assert.equal(merged.patrolScansDay, "2026-07-10");
  });

  it("does not restore scans from stale cloud day after UTC reset", () => {
    const now = new Date("2026-07-11T01:00:00.000Z");
    const merged = mergePatrolProgress(
      { patrolScansDay: "2026-07-11", patrolScansUsed: 0 },
      { patrolScansDay: "2026-07-10", patrolScansUsed: 50 },
      now
    );
    assert.equal(merged.patrolScansUsed, 0);
    assert.equal(merged.patrolScansDay, "2026-07-11");
  });
});
