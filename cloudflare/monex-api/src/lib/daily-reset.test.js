import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getDailyDayKey,
  getNextDailyResetAt,
  isDailyLoginReady,
  getDailyLoginNextClaimAt,
} from "./daily-reset.js";

describe("daily-reset UTC+8", () => {
  it("getDailyDayKey matches UTC+8 midnight boundary", () => {
    assert.equal(getDailyDayKey(new Date("2026-07-10T16:00:00.000Z")), "2026-07-11");
    assert.equal(getDailyDayKey(new Date("2026-07-10T15:59:59.000Z")), "2026-07-10");
  });

  it("daily login uses calendar day not rolling 24h", () => {
    const save = {
      dailyLoginLastClaimAt: new Date("2026-07-10T17:00:00.000Z").toISOString(),
    };
    const sameUtc8Day = Date.parse("2026-07-10T20:00:00.000Z");
    assert.equal(isDailyLoginReady(save, sameUtc8Day), false);

    const nextUtc8Day = Date.parse("2026-07-11T16:30:00.000Z");
    assert.equal(isDailyLoginReady(save, nextUtc8Day), true);
  });

  it("next daily login claim is next UTC+8 midnight", () => {
    const now = Date.parse("2026-07-10T10:00:00.000Z");
    assert.equal(
      getDailyLoginNextClaimAt(now),
      new Date("2026-07-10T16:00:00.000Z").toISOString()
    );
  });
});
