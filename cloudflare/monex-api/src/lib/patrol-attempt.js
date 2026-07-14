import { getDailyDayKey } from "./daily-reset.js";

export const PATROL_DAILY_MAX = 50;

export function applyPatrolDailyResetOnSave(save, now = Date.now()) {
  const today = getDailyDayKey(new Date(now));
  const used = Math.max(0, Math.floor(Number(save?.patrolScansUsed) || 0));
  const day = save?.patrolScansDay || null;

  if (!day) {
    return { ...save, patrolScansUsed: used, patrolScansDay: today };
  }
  if (day !== today) {
    return { ...save, patrolScansUsed: 0, patrolScansDay: today };
  }
  return { ...save, patrolScansUsed: used, patrolScansDay: today };
}

export function getPatrolScansRemaining(save) {
  const used = Math.max(0, Math.floor(Number(save?.patrolScansUsed) || 0));
  return Math.max(0, PATROL_DAILY_MAX - used);
}

export function consumePatrolAttempt(save, now = Date.now()) {
  const reset = applyPatrolDailyResetOnSave(save, now);
  if (reset.patrolScansUsed >= PATROL_DAILY_MAX) {
    return { ok: false, error: "no_patrol_attempts", save: reset };
  }
  return {
    ok: true,
    save: {
      ...reset,
      patrolScansUsed: reset.patrolScansUsed + 1,
    },
  };
}

export function parsePatrolScanFromCompletionId(completionId) {
  const match = String(completionId || "").match(/^patrol:day-[^:]+:scan-(\d+):/);
  if (!match) return null;
  return Math.max(1, Math.floor(Number(match[1]) || 1));
}

export function syncLegacyPatrolScanCount(save, completionId, now = Date.now()) {
  const scanFromId = parsePatrolScanFromCompletionId(completionId);
  const reset = applyPatrolDailyResetOnSave(save, now);
  if (!scanFromId) return reset;
  return {
    ...reset,
    patrolScansUsed: Math.max(reset.patrolScansUsed, scanFromId),
  };
}

export function preservePatrolProgress(existing, incoming, now = Date.now()) {
  const ex = existing && typeof existing === "object" ? existing : {};
  const inc = incoming && typeof incoming === "object" ? incoming : {};
  const today = getDailyDayKey(new Date(now));
  const exUsed = Math.max(0, Math.floor(Number(ex.patrolScansUsed) || 0));
  const incUsed = Math.max(0, Math.floor(Number(inc.patrolScansUsed) || 0));
  const exDay = ex.patrolScansDay || null;
  const incDay = inc.patrolScansDay || null;

  let nextUsed = incUsed;
  let nextDay = incDay || exDay || today;

  if (exDay === incDay && exDay) {
    nextUsed = Math.max(exUsed, incUsed);
    nextDay = exDay;
  } else if (exDay === today && incDay !== today) {
    nextUsed = exUsed;
    nextDay = exDay;
  } else if (incDay === today && exDay !== today) {
    nextUsed = incUsed;
    nextDay = incDay;
  } else if (exDay === incDay) {
    nextUsed = Math.max(exUsed, incUsed);
  }

  return {
    ...inc,
    patrolScansUsed: Math.min(PATROL_DAILY_MAX, nextUsed),
    patrolScansDay: nextDay,
  };
}

export function mergePatrolProgressOntoLatest(latest, original, intended) {
  const latestUsed = Math.max(0, Math.floor(Number(latest?.patrolScansUsed) || 0));
  const originalUsed = Math.max(0, Math.floor(Number(original?.patrolScansUsed) || 0));
  const intendedUsed = Math.max(0, Math.floor(Number(intended?.patrolScansUsed) || 0));
  const delta = intendedUsed - originalUsed;
  const intendedDay = intended?.patrolScansDay || latest?.patrolScansDay || null;
  const latestDay = latest?.patrolScansDay || null;

  if (delta <= 0) {
    if (latestDay === intendedDay && latestUsed >= intendedUsed) {
      return { patrolScansUsed: latestUsed, patrolScansDay: latestDay || intendedDay };
    }
    return {
      patrolScansUsed: Math.max(latestUsed, intendedUsed),
      patrolScansDay: intendedDay || latestDay,
    };
  }

  if (latestDay === intendedDay) {
    return {
      patrolScansUsed: Math.min(PATROL_DAILY_MAX, Math.max(latestUsed, latestUsed + delta)),
      patrolScansDay: intendedDay,
    };
  }

  return {
    patrolScansUsed: Math.min(PATROL_DAILY_MAX, Math.max(latestUsed, intendedUsed)),
    patrolScansDay: intendedDay || latestDay,
  };
}
