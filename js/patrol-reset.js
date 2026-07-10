/** Patrol daily reset helpers — all resets use 00:00 UTC (same as daily quests). */

export function getPatrolDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Apply patrol day rollover. Returns { patrolScansUsed, patrolScansDay, changed }.
 * Migrates legacy UTC+8 day keys (one day ahead) without wiping progress.
 */
export function applyPatrolDailyReset(patrolScansUsed, patrolScansDay, now = new Date()) {
  const today = getPatrolDayKey(now);
  const used = Math.max(0, Math.floor(Number(patrolScansUsed) || 0));

  if (!patrolScansDay) {
    return { patrolScansUsed: used, patrolScansDay: today, changed: patrolScansDay !== today };
  }

  if (patrolScansDay === today) {
    return { patrolScansUsed: used, patrolScansDay: today, changed: false };
  }

  // Legacy saves used UTC+8 midnight; day key could be one calendar day ahead of UTC.
  if (patrolScansDay > today) {
    const stored = Date.parse(`${patrolScansDay}T00:00:00.000Z`);
    const utcToday = Date.parse(`${today}T00:00:00.000Z`);
    if (Number.isFinite(stored) && Number.isFinite(utcToday) && stored - utcToday === 86400000) {
      return { patrolScansUsed: used, patrolScansDay: today, changed: true };
    }
  }

  return { patrolScansUsed: 0, patrolScansDay: today, changed: true };
}

function isPatrolDayCurrent(day, today) {
  if (!day) return false;
  if (day === today) return true;
  if (day > today) {
    const stored = Date.parse(`${day}T00:00:00.000Z`);
    const utcToday = Date.parse(`${today}T00:00:00.000Z`);
    return Number.isFinite(stored) && Number.isFinite(utcToday) && stored - utcToday === 86400000;
  }
  return false;
}

/** Merge patrol counters from local + cloud snapshots without losing today's progress. */
export function mergePatrolProgress(local, cloud, now = new Date()) {
  const today = getPatrolDayKey(now);
  const localUsed = Math.max(0, Math.floor(Number(local?.patrolScansUsed) || 0));
  const cloudUsed = Math.max(0, Math.floor(Number(cloud?.patrolScansUsed) || 0));
  let mergedUsed = 0;

  if (isPatrolDayCurrent(local?.patrolScansDay, today)) {
    mergedUsed = Math.max(mergedUsed, localUsed);
  }
  if (isPatrolDayCurrent(cloud?.patrolScansDay, today)) {
    mergedUsed = Math.max(mergedUsed, cloudUsed);
  }

  return { patrolScansDay: today, patrolScansUsed: mergedUsed };
}

export function getPatrolResetCountdownLabel(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const ms = Math.max(0, next - now);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `Patrol reset: ${h}h ${m}m (00:00 UTC)`;
}

const api = {
  getPatrolDayKey,
  applyPatrolDailyReset,
  mergePatrolProgress,
  getPatrolResetCountdownLabel,
};

if (typeof window !== "undefined") {
  window.MonExPatrolReset = api;
}
