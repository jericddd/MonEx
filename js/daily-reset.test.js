import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./daily-reset.js";

const api = globalThis.MonExDailyReset;

describe("MonExDailyReset UTC+8 day key", () => {
  it("uses UTC+8 calendar date", () => {
    assert.equal(
      api.getDailyDayKey(new Date("2026-07-10T23:30:00.000Z")),
      "2026-07-11"
    );
  });

  it("rolls over at 16:00 UTC (00:00 UTC+8)", () => {
    assert.equal(
      api.getDailyDayKey(new Date("2026-07-10T16:00:00.000Z")),
      "2026-07-11"
    );
    assert.equal(
      api.getDailyDayKey(new Date("2026-07-10T15:59:59.000Z")),
      "2026-07-10"
    );
  });

  it("next reset is 16:00 UTC same calendar day before rollover", () => {
    const now = new Date("2026-07-10T10:00:00.000Z");
    const next = api.getNextDailyResetAt(now);
    assert.equal(next.toISOString(), "2026-07-10T16:00:00.000Z");
  });

  it("needsDailyQuestReset detects stale and legacy UTC day keys", () => {
    const now = new Date("2026-07-14T20:00:00.000Z");
    assert.equal(api.getDailyDayKey(now), "2026-07-15");
    assert.equal(api.needsDailyQuestReset("2026-07-14", now), true);
    assert.equal(api.needsDailyQuestReset("2026-07-15", now), false);
    assert.equal(
      api.isLegacyUtcDayKeyForCurrentUtc8Day("2026-07-14", now),
      true
    );
  });

  it("needsWeeklyQuestReset detects stale week keys", () => {
    const now = new Date("2026-07-14T20:00:00.000Z");
    const weekKey = api.getDailyWeekKey(now);
    assert.equal(api.needsWeeklyQuestReset(weekKey, now), false);
    assert.equal(api.needsWeeklyQuestReset("2026-01-W01", now), true);
  });
});
