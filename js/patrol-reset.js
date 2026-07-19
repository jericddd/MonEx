/**
 * Patrol daily reset — uses centralized 00:00 UTC+8 schedule (MonExDailyReset).
 */
(() => {
"use strict";

function dayApi() {
  if (typeof globalThis !== "undefined" && globalThis.MonExDailyReset) {
    return globalThis.MonExDailyReset;
  }
  if (typeof window !== "undefined" && window.MonExDailyReset) {
    return window.MonExDailyReset;
  }
  return null;
}

function getPatrolDayKey(d = new Date()) {
  const api = dayApi();
  if (api?.getDailyDayKey) return api.getDailyDayKey(d);
  return d.toISOString().slice(0, 10);
}

function isSamePatrolDay(storedDay, today) {
  if (!storedDay) return false;
  return storedDay === today;
}

const PATROL_DAILY_MAX = 50;

/**
 * Apply patrol day rollover. Returns { patrolScansUsed, patrolScansDay, patrolBonusAttempts, patrolBonusDay, changed }.
 * Null day with a depleted counter is treated as stale — zero it instead of locking 0 remaining.
 */
function applyPatrolDailyReset(patrolScansUsed, patrolScansDay, now = new Date(), extras = {}) {
  const today = getPatrolDayKey(now);
  let used = Math.max(0, Math.min(PATROL_DAILY_MAX, Math.floor(Number(patrolScansUsed) || 0)));
  let bonus = Math.max(0, Math.min(PATROL_DAILY_MAX, Math.floor(Number(extras.patrolBonusAttempts) || 0)));
  let bonusDay = extras.patrolBonusDay || null;
  const prevDay = patrolScansDay || null;
  const prevUsed = used;
  const prevBonus = bonus;
  const prevBonusDay = bonusDay;

  if (!patrolScansDay) {
    if (used >= PATROL_DAILY_MAX) used = 0;
    return {
      patrolScansUsed: used,
      patrolScansDay: today,
      patrolBonusAttempts: bonusDay && bonusDay !== today ? 0 : bonus,
      patrolBonusDay: bonusDay && bonusDay !== today ? null : (bonus > 0 ? today : null),
      changed: true,
    };
  }

  if (!isSamePatrolDay(patrolScansDay, today)) {
    return {
      patrolScansUsed: 0,
      patrolScansDay: today,
      patrolBonusAttempts: 0,
      patrolBonusDay: null,
      changed: true,
    };
  }

  if (bonus > 0 && bonusDay && bonusDay !== today) {
    bonus = 0;
    bonusDay = null;
  }
  if (bonus > 0 && !bonusDay) bonusDay = today;

  return {
    patrolScansUsed: used,
    patrolScansDay: today,
    patrolBonusAttempts: bonus,
    patrolBonusDay: bonus > 0 ? bonusDay : null,
    changed:
      prevDay !== today
      || prevUsed !== used
      || prevBonus !== bonus
      || prevBonusDay !== (bonus > 0 ? bonusDay : null),
  };
}

/** Merge patrol counters from local + cloud snapshots without losing today's progress. */
function mergePatrolProgress(local, cloud, now = new Date()) {
  const today = getPatrolDayKey(now);
  const localReset = applyPatrolDailyReset(
    local?.patrolScansUsed,
    local?.patrolScansDay,
    now,
    { patrolBonusAttempts: local?.patrolBonusAttempts, patrolBonusDay: local?.patrolBonusDay }
  );
  const cloudReset = applyPatrolDailyReset(
    cloud?.patrolScansUsed,
    cloud?.patrolScansDay,
    now,
    { patrolBonusAttempts: cloud?.patrolBonusAttempts, patrolBonusDay: cloud?.patrolBonusDay }
  );

  let mergedUsed = 0;
  if (isSamePatrolDay(localReset.patrolScansDay, today)) {
    mergedUsed = Math.max(mergedUsed, localReset.patrolScansUsed);
  }
  if (isSamePatrolDay(cloudReset.patrolScansDay, today)) {
    mergedUsed = Math.max(mergedUsed, cloudReset.patrolScansUsed);
  }

  const localToday = isSamePatrolDay(localReset.patrolScansDay, today) ? localReset.patrolScansUsed : 0;
  const cloudToday = isSamePatrolDay(cloudReset.patrolScansDay, today) ? cloudReset.patrolScansUsed : 0;
  if (localToday > 0 && cloudToday > 0 && Math.abs(localToday - cloudToday) > 1) {
    mergedUsed = Math.min(localToday, cloudToday);
  }

  let mergedBonus = 0;
  if (isSamePatrolDay(localReset.patrolBonusDay || localReset.patrolScansDay, today)) {
    mergedBonus = Math.max(mergedBonus, localReset.patrolBonusAttempts || 0);
  }
  if (isSamePatrolDay(cloudReset.patrolBonusDay || cloudReset.patrolScansDay, today)) {
    mergedBonus = Math.max(mergedBonus, cloudReset.patrolBonusAttempts || 0);
  }

  return {
    patrolScansDay: today,
    patrolScansUsed: mergedUsed,
    patrolBonusAttempts: mergedBonus,
    patrolBonusDay: mergedBonus > 0 ? today : null,
  };
}

function getPatrolResetCountdownLabel(now = new Date()) {
  const api = dayApi();
  if (api?.getDailyResetCountdownLabel) {
    return `Patrol ${api.getDailyResetCountdownLabel(now)}`;
  }
  return "Patrol reset: 00:00 UTC+8";
}

const api = {
  getPatrolDayKey,
  applyPatrolDailyReset,
  mergePatrolProgress,
  getPatrolResetCountdownLabel,
  PATROL_DAILY_MAX,
};

if (typeof window !== "undefined") {
  window.MonExPatrolReset = api;
}
if (typeof globalThis !== "undefined") {
  globalThis.MonExPatrolReset = api;
}
})();
