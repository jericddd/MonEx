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

/**
 * Apply patrol day rollover. Returns { patrolScansUsed, patrolScansDay, changed }.
 */
function applyPatrolDailyReset(patrolScansUsed, patrolScansDay, now = new Date()) {
  const today = getPatrolDayKey(now);
  const used = Math.max(0, Math.floor(Number(patrolScansUsed) || 0));

  if (!patrolScansDay) {
    return { patrolScansUsed: used, patrolScansDay: today, changed: patrolScansDay !== today };
  }

  if (isSamePatrolDay(patrolScansDay, today)) {
    return { patrolScansUsed: used, patrolScansDay: today, changed: patrolScansDay !== today };
  }

  return { patrolScansUsed: 0, patrolScansDay: today, changed: true };
}

/** Merge patrol counters from local + cloud snapshots without losing today's progress. */
function mergePatrolProgress(local, cloud, now = new Date()) {
  const today = getPatrolDayKey(now);
  const localUsed = Math.max(0, Math.floor(Number(local?.patrolScansUsed) || 0));
  const cloudUsed = Math.max(0, Math.floor(Number(cloud?.patrolScansUsed) || 0));
  let mergedUsed = 0;

  if (isSamePatrolDay(local?.patrolScansDay, today)) {
    mergedUsed = Math.max(mergedUsed, localUsed);
  }
  if (isSamePatrolDay(cloud?.patrolScansDay, today)) {
    mergedUsed = Math.max(mergedUsed, cloudUsed);
  }

  const localToday = isSamePatrolDay(local?.patrolScansDay, today) ? localUsed : 0;
  const cloudToday = isSamePatrolDay(cloud?.patrolScansDay, today) ? cloudUsed : 0;
  if (localToday > 0 && cloudToday > 0 && Math.abs(localToday - cloudToday) > 1) {
    mergedUsed = Math.min(localToday, cloudToday);
  }

  return { patrolScansDay: today, patrolScansUsed: mergedUsed };
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
};

if (typeof window !== "undefined") {
  window.MonExPatrolReset = api;
}
if (typeof globalThis !== "undefined") {
  globalThis.MonExPatrolReset = api;
}
})();
