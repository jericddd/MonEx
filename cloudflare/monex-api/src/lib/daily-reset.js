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
