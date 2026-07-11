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
});
