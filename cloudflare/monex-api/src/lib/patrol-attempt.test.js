import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPatrolDailyResetOnSave,
  applyPatrolCompensationOnSave,
  consumePatrolAttempt,
  countPatrolCompletionsForDay,
  getPatrolScansRemaining,
  mergePatrolProgressOntoLatest,
  parsePatrolScanFromCompletionId,
  preservePatrolProgress,
  syncLegacyPatrolScanCount,
  grantPatrolAttemptsOnSave,
  PATROL_COMP_KEY,
  PATROL_COMP_BONUS,
} from "./patrol-attempt.js";

function withComp(save) {
  return {
    ...save,
    accountCompensationsApplied: {
      ...(save.accountCompensationsApplied || {}),
      [PATROL_COMP_KEY]: { amount: PATROL_COMP_BONUS, at: "2026-07-19T00:00:00.000Z" },
    },
  };
}

test("applyPatrolDailyResetOnSave resets usage on new day", () => {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  const save = { patrolScansDay: "2026-07-13", patrolScansUsed: 40, patrolBonusAttempts: 50, patrolBonusDay: "2026-07-13" };
  const reset = applyPatrolDailyResetOnSave(save, now);
  assert.equal(reset.patrolScansUsed, 0);
  assert.equal(reset.patrolScansDay, "2026-07-14");
  assert.equal(reset.patrolBonusAttempts, 0);
});

test("applyPatrolDailyResetOnSave zeros depleted null-day stamp", () => {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  const reset = applyPatrolDailyResetOnSave({ patrolScansDay: null, patrolScansUsed: 50 }, now);
  assert.equal(reset.patrolScansUsed, 0);
  assert.equal(reset.patrolScansDay, "2026-07-14");
});

test("applyPatrolCompensationOnSave grants 100 remaining once", () => {
  const now = Date.parse("2026-07-19T12:00:00.000Z");
  const first = applyPatrolCompensationOnSave(
    { patrolScansDay: "2026-07-19", patrolScansUsed: 50 },
    now
  );
  assert.equal(first.patrolScansUsed, 0);
  assert.equal(first.patrolBonusAttempts, 50);
  assert.equal(getPatrolScansRemaining(first), 100);
  assert.ok(first.accountCompensationsApplied[PATROL_COMP_KEY]);

  const second = applyPatrolCompensationOnSave(first, now);
  assert.equal(second.patrolScansUsed, 0);
  assert.equal(second.patrolBonusAttempts, 50);
  assert.equal(getPatrolScansRemaining(second), 100);
});

test("compensation clears on next UTC+8 day back to 50/50", () => {
  const granted = applyPatrolCompensationOnSave(
    { patrolScansDay: "2026-07-19", patrolScansUsed: 50 },
    Date.parse("2026-07-19T12:00:00.000Z")
  );
  const nextDay = applyPatrolDailyResetOnSave(granted, Date.parse("2026-07-20T12:00:00.000Z"));
  assert.equal(nextDay.patrolScansUsed, 0);
  assert.equal(nextDay.patrolBonusAttempts, 0);
  assert.equal(getPatrolScansRemaining(nextDay), 50);
});

test("consumePatrolAttempt increments atomically when attempts remain", () => {
  const save = { patrolScansDay: "2026-07-14", patrolScansUsed: 2 };
  const result = consumePatrolAttempt(save, Date.parse("2026-07-14T12:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.equal(result.save.patrolScansUsed, 3);
});

test("consumePatrolAttempt rejects when depleted including bonus", () => {
  const save = {
    patrolScansDay: "2026-07-14",
    patrolScansUsed: 50,
    patrolBonusAttempts: 0,
    patrolBonusDay: "2026-07-14",
  };
  const result = consumePatrolAttempt(save, Date.parse("2026-07-14T12:00:00.000Z"));
  assert.equal(result.ok, false);
  assert.equal(result.error, "no_patrol_attempts");
  assert.equal(result.save.patrolScansUsed, 50);
});

test("consumePatrolAttempt spends bonus after base max", () => {
  const save = {
    patrolScansDay: "2026-07-14",
    patrolScansUsed: 50,
    patrolBonusAttempts: 2,
    patrolBonusDay: "2026-07-14",
  };
  const result = consumePatrolAttempt(save, Date.parse("2026-07-14T12:00:00.000Z"));
  assert.equal(result.ok, true);
  assert.equal(result.save.patrolScansUsed, 50);
  assert.equal(result.save.patrolBonusAttempts, 1);
});

test("preservePatrolProgress prevents client from regressing scan count", () => {
  const existing = withComp({ patrolScansDay: "2026-07-14", patrolScansUsed: 5 });
  const incoming = withComp({ patrolScansDay: "2026-07-14", patrolScansUsed: 3, money: 100 });
  const out = preservePatrolProgress(existing, incoming, Date.parse("2026-07-14T12:00:00.000Z"));
  assert.equal(out.patrolScansUsed, 5);
  assert.equal(out.money, 100);
});

test("preservePatrolProgress blocks stale client from inflating patrol count above ledger", () => {
  const now = Date.parse("2026-07-15T17:26:18.870Z");
  const completions = {
    "patrol:token:d27c9d53-81b8-47f5-bf54-3f8069494d27": {
      at: "2026-07-15T16:11:47.380Z",
      mode: "patrol",
      reward: { gold: 75 },
    },
  };
  const existing = withComp({
    patrolScansDay: "2026-07-16",
    patrolScansUsed: 1,
    accountBattleCompletions: completions,
  });
  const incoming = withComp({
    patrolScansDay: "2026-07-16",
    patrolScansUsed: 50,
    accountBattleCompletions: completions,
  });
  const out = preservePatrolProgress(existing, incoming, now, completions);
  assert.equal(out.patrolScansUsed, 1);
  assert.equal(countPatrolCompletionsForDay(completions, "2026-07-16"), 1);
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
  assert.equal(getPatrolScansRemaining({ patrolScansUsed: 0, patrolBonusAttempts: 50 }), 100);
});

test("grantPatrolAttemptsOnSave reduces used count up to requested amount", () => {
  const result = grantPatrolAttemptsOnSave(
    withComp({ patrolScansDay: "2026-07-14", patrolScansUsed: 18 }),
    10,
    Date.parse("2026-07-14T12:00:00.000Z")
  );
  assert.equal(result.afterUsed, 8);
  assert.equal(result.afterRemaining, 42);
});

test("grantPatrolAttemptsOnSave can add bonus after used hits zero", () => {
  const result = grantPatrolAttemptsOnSave(
    withComp({ patrolScansDay: "2026-07-14", patrolScansUsed: 3, patrolBonusAttempts: 0 }),
    10,
    Date.parse("2026-07-14T12:00:00.000Z")
  );
  assert.equal(result.afterUsed, 0);
  assert.equal(result.afterRemaining, 57);
});
