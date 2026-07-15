import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPatrolDailyResetOnSave,
  consumePatrolAttempt,
  getPatrolScansRemaining,
  mergePatrolProgressOntoLatest,
  parsePatrolScanFromCompletionId,
  preservePatrolProgress,
  syncLegacyPatrolScanCount,
  grantPatrolAttemptsOnSave,
} from "./patrol-attempt.js";

test("applyPatrolDailyResetOnSave resets usage on new day", () => {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  const save = { patrolScansDay: "2026-07-13", patrolScansUsed: 40 };
  const reset = applyPatrolDailyResetOnSave(save, now);
  assert.equal(reset.patrolScansUsed, 0);
  assert.equal(reset.patrolScansDay, "2026-07-14");
});

test("consumePatrolAttempt increments atomically when attempts remain", () => {
  const save = { patrolScansDay: "2026-07-14", patrolScansUsed: 2 };
  const result = consumePatrolAttempt(save, Date.parse("2026-07-14T12:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.equal(result.save.patrolScansUsed, 3);
});

test("consumePatrolAttempt rejects when depleted", () => {
  const save = { patrolScansDay: "2026-07-14", patrolScansUsed: 50 };
  const result = consumePatrolAttempt(save, Date.parse("2026-07-14T12:00:00.000Z"));
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_patrol_attempts");
  assert.equal(result.save.patrolScansUsed, 50);
});

test("preservePatrolProgress prevents client from regressing scan count", () => {
  const existing = { patrolScansDay: "2026-07-14", patrolScansUsed: 5 };
  const incoming = { patrolScansDay: "2026-07-14", patrolScansUsed: 3, money: 100 };
  const out = preservePatrolProgress(existing, incoming, Date.parse("2026-07-14T12:00:00.000Z"));
  assert.equal(out.patrolScansUsed, 5);
  assert.equal(out.money, 100);
});

test("mergePatrolProgressOntoLatest applies patrol attempt delta on conflict retry", () => {
  const original = { patrolScansDay: "2026-07-14", patrolScansUsed: 2 };
  const intended = { patrolScansDay: "2026-07-14", patrolScansUsed: 3 };
  const latest = { patrolScansDay: "2026-07-14", patrolScansUsed: 2, money: 500 };
  const merged = mergePatrolProgressOntoLatest(latest, original, intended);
  assert.equal(merged.patrolScansUsed, 3);
});

test("parsePatrolScanFromCompletionId reads legacy scan slot", () => {
  assert.equal(
    parsePatrolScanFromCompletionId("patrol:day-2026-07-14:scan-3:common"),
    3,
  );
});

test("syncLegacyPatrolScanCount aligns server usage with legacy client id", () => {
  const save = { patrolScansDay: "2026-07-14", patrolScansUsed: 1 };
  const synced = syncLegacyPatrolScanCount(
    save,
    "patrol:day-2026-07-14:scan-3:common",
    Date.parse("2026-07-14T12:00:00.000Z"),
  );
  assert.equal(synced.patrolScansUsed, 3);
});

test("getPatrolScansRemaining returns remaining attempts", () => {
  assert.equal(getPatrolScansRemaining({ patrolScansUsed: 48 }), 2);
});

test("grantPatrolAttemptsOnSave reduces used count up to requested amount", () => {
  const result = grantPatrolAttemptsOnSave(
    { patrolScansDay: "2026-07-14", patrolScansUsed: 18 },
    10,
    Date.parse("2026-07-14T12:00:00.000Z")
  );
  assert.equal(result.granted, 10);
  assert.equal(result.afterUsed, 8);
  assert.equal(result.afterRemaining, 42);
});

test("grantPatrolAttemptsOnSave cannot grant below zero used", () => {
  const result = grantPatrolAttemptsOnSave(
    { patrolScansDay: "2026-07-14", patrolScansUsed: 3 },
    10,
    Date.parse("2026-07-14T12:00:00.000Z")
  );
  assert.equal(result.granted, 3);
  assert.equal(result.afterUsed, 0);
  assert.equal(result.afterRemaining, 50);
});
