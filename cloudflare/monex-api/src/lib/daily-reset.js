/**
 * Server-side UTC+8 daily reset helpers (mirror js/daily-reset.js).
 */

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

function toUtc8(d = new Date()) {
  return new Date(d.getTime() + UTC8_OFFSET_MS);
}

export function getDailyDayKey(d = new Date()) {
  const u8 = toUtc8(d);
  const y = u8.getUTCFullYear();
  const m = String(u8.getUTCMonth() + 1).padStart(2, "0");
  const day = String(u8.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week key using the UTC+8 calendar date. */
export function getDailyWeekKey(d = new Date()) {
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

export function isLegacyUtcDayKeyForCurrentUtc8Day(storedKey, now = new Date()) {
  if (!storedKey || typeof storedKey !== "string") return false;
  const current = getDailyDayKey(now);
  if (storedKey === current) return false;
  const legacyUtc = now.toISOString().slice(0, 10);
  return storedKey === legacyUtc && legacyUtc !== current;
}

export function needsDailyQuestReset(storedKey, now = new Date()) {
  const dayKey = getDailyDayKey(now);
  if (!storedKey || storedKey !== dayKey) return true;
  return isLegacyUtcDayKeyForCurrentUtc8Day(storedKey, now);
}

export function needsWeeklyQuestReset(storedKey, now = new Date()) {
  const weekKey = getDailyWeekKey(now);
  return !storedKey || storedKey !== weekKey;
}

export function getNextDailyResetAt(d = new Date()) {
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

export function getDailyLoginDayKeyFromTimestamp(isoOrMs, now = Date.now()) {
  if (isoOrMs == null || isoOrMs === "") return null;
  const ts = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ts)) return null;
  return getDailyDayKey(new Date(ts));
}

export function isDailyLoginReady(save, now = Date.now()) {
  const todayKey = getDailyDayKey(new Date(now));
  const lastKey = getDailyLoginDayKeyFromTimestamp(save?.dailyLoginLastClaimAt, now);
  return lastKey !== todayKey;
}

export function getDailyLoginNextClaimAt(now = Date.now()) {
  return getNextDailyResetAt(new Date(now)).toISOString();
}
