/**
 * Central daily reset schedule — 00:00 UTC+8 (16:00 UTC).
 *
 * All daily systems (quests, milestones, patrol, daily-login eligibility)
 * should use getDailyDayKey() from this module.
 */
(() => {
  "use strict";

  const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

  function toUtc8(d = new Date()) {
    return new Date(d.getTime() + UTC8_OFFSET_MS);
  }

  /** Calendar day in UTC+8 as YYYY-MM-DD. */
  function getDailyDayKey(d = new Date()) {
    const u8 = toUtc8(d);
    const y = u8.getUTCFullYear();
    const m = String(u8.getUTCMonth() + 1).padStart(2, "0");
    const day = String(u8.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /** ISO week key using the UTC+8 calendar date. */
  function getDailyWeekKey(d = new Date()) {
    const u8 = toUtc8(d);
    const date = new Date(Date.UTC(u8.getUTCFullYear(), u8.getUTCMonth(), u8.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const isoYear = date.getUTCFullYear();
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week =
      1 + Math.floor((date - jan4 + (jan4Day - 1) * 86400000) / 604800000);
    return `${isoYear}-W${String(week).padStart(2, "0")}`;
  }

  /** Real timestamp of the next 00:00 UTC+8 boundary. */
  function getNextDailyResetAt(d = new Date()) {
    const u8 = toUtc8(d);
    const nextUtc8Midnight = Date.UTC(
      u8.getUTCFullYear(),
      u8.getUTCMonth(),
      u8.getUTCDate() + 1,
      0,
      0,
      0,
      0
    );
    return new Date(nextUtc8Midnight - UTC8_OFFSET_MS);
  }

  function msUntilNextDailyReset(d = new Date()) {
    return Math.max(0, getNextDailyResetAt(d) - d);
  }

  function formatCountdown(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  function getDailyResetCountdownLabel(d = new Date()) {
    return `Resets in ${formatCountdown(msUntilNextDailyReset(d))} (00:00 UTC+8)`;
  }

  /**
   * True when storedKey is a legacy UTC-midnight day key for the same UTC+8 day.
   * Old saves used toISOString().slice(0,10) (UTC) instead of UTC+8.
   */
  function isLegacyUtcDayKeyForCurrentUtc8Day(storedKey, now = new Date()) {
    if (!storedKey || typeof storedKey !== "string") return false;
    const current = getDailyDayKey(now);
    if (storedKey === current) return false;
    const legacyUtc = now.toISOString().slice(0, 10);
    return storedKey === legacyUtc && legacyUtc !== current;
  }

  /** True when daily quests/milestones should roll over for the current UTC+8 day. */
  function needsDailyQuestReset(storedKey, now = new Date()) {
    const dayKey = getDailyDayKey(now);
    if (!storedKey || storedKey !== dayKey) return true;
    return isLegacyUtcDayKeyForCurrentUtc8Day(storedKey, now);
  }

  /** True when weekly quests/milestones should roll over for the current UTC+8 week. */
  function needsWeeklyQuestReset(storedKey, now = new Date()) {
    const weekKey = getDailyWeekKey(now);
    return !storedKey || storedKey !== weekKey;
  }

  const api = {
    UTC8_OFFSET_MS,
    getDailyDayKey,
    getDailyWeekKey,
    getNextDailyResetAt,
    msUntilNextDailyReset,
    getDailyResetCountdownLabel,
    isLegacyUtcDayKeyForCurrentUtc8Day,
    needsDailyQuestReset,
    needsWeeklyQuestReset,
  };

  if (typeof window !== "undefined") window.MonExDailyReset = api;
  if (typeof globalThis !== "undefined") globalThis.MonExDailyReset = api;
})();
