import { getDailyDayKey } from "./daily-reset.js";
import { sanitizeAccountBattleCompletions } from "./battle-completion.js";
import { writeCloudSave, buildSavePayload } from "./save.js";
import { sanitizeAccountCompensationsApplied } from "./quest-compensation.js";

export const PATROL_DAILY_MAX = 50;

/**
 * One-time apology grant after stuck daily resets.
 * After this key is stamped, next UTC+8 rollover clears bonus → back to 50/50.
 */
export const PATROL_COMP_KEY = "patrol_extra50_2026-07-19";
export const PATROL_COMP_BONUS = 50;

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

/** UTC+8 midnight for a day key, as UTC epoch ms. */
export function patrolDayStartMs(dayKey) {
  if (!dayKey || typeof dayKey !== "string") return NaN;
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d) - UTC8_OFFSET_MS;
}

/** Count patrol ledger entries whose timestamp falls on the given UTC+8 day. */
export function countPatrolCompletionsForDay(completions, dayKey) {
  if (!dayKey) return 0;
  const start = patrolDayStartMs(dayKey);
  if (!Number.isFinite(start)) return 0;
  const end = start + 24 * 60 * 60 * 1000;
  let count = 0;
  for (const [id, entry] of Object.entries(sanitizeAccountBattleCompletions(completions))) {
    if (!id.startsWith("patrol:")) continue;
    const ms = Date.parse(entry?.at || "");
    if (Number.isFinite(ms) && ms >= start && ms < end) count++;
  }
  return count;
}

function clampUsed(value) {
  return Math.min(PATROL_DAILY_MAX, Math.max(0, Math.floor(Number(value) || 0)));
}

function clampBonus(value) {
  return Math.min(PATROL_COMP_BONUS, Math.max(0, Math.floor(Number(value) || 0)));
}

/**
 * Apply UTC+8 day rollover. Null day with a depleted counter is treated as a
 * stale stamp — zero it instead of locking the player at 0 remaining for "today".
 */
export function applyPatrolDailyResetOnSave(save, now = Date.now()) {
  const today = getDailyDayKey(new Date(now));
  let used = clampUsed(save?.patrolScansUsed);
  let day = typeof save?.patrolScansDay === "string" && save.patrolScansDay.trim()
    ? save.patrolScansDay.trim()
    : null;
  let bonus = clampBonus(save?.patrolBonusAttempts);
  let bonusDay = typeof save?.patrolBonusDay === "string" && save.patrolBonusDay.trim()
    ? save.patrolBonusDay.trim()
    : null;

  if (!day) {
    // Stamping a missing day must not lock a depleted counter onto today.
    if (used >= PATROL_DAILY_MAX) used = 0;
    day = today;
  } else if (day !== today) {
    used = 0;
    day = today;
    bonus = 0;
    bonusDay = null;
  }

  if (bonus > 0 && bonusDay && bonusDay !== today) {
    bonus = 0;
    bonusDay = null;
  }
  if (bonus > 0 && !bonusDay) {
    bonusDay = today;
  }

  return {
    ...save,
    patrolScansUsed: used,
    patrolScansDay: day,
    patrolBonusAttempts: bonus,
    patrolBonusDay: bonus > 0 ? bonusDay : null,
  };
}

/**
 * One-time: reset used to 0 and grant +50 bonus for today → UI shows 100/50.
 * Subsequent days clear bonus via applyPatrolDailyResetOnSave → 50/50.
 */
export function applyPatrolCompensationOnSave(save, now = Date.now()) {
  const reset = applyPatrolDailyResetOnSave(save, now);
  const comps = sanitizeAccountCompensationsApplied(reset.accountCompensationsApplied);
  if (comps[PATROL_COMP_KEY]) return reset;
  const today = getDailyDayKey(new Date(now));
  return {
    ...reset,
    patrolScansUsed: 0,
    patrolScansDay: today,
    patrolBonusAttempts: PATROL_COMP_BONUS,
    patrolBonusDay: today,
    accountCompensationsApplied: {
      ...comps,
      [PATROL_COMP_KEY]: {
        amount: PATROL_COMP_BONUS,
        at: new Date(now).toISOString(),
      },
    },
  };
}

export function getPatrolScansRemaining(save) {
  const used = clampUsed(save?.patrolScansUsed);
  const bonus = clampBonus(save?.patrolBonusAttempts);
  return Math.max(0, PATROL_DAILY_MAX - used) + bonus;
}

/** Ops compensation: increase remaining patrol attempts by reducing used, then bonus. */
export function grantPatrolAttemptsOnSave(save, amount, now = Date.now()) {
  const reset = applyPatrolDailyResetOnSave(save, now);
  const beforeUsed = reset.patrolScansUsed || 0;
  const beforeBonus = clampBonus(reset.patrolBonusAttempts);
  const beforeRemaining = getPatrolScansRemaining(reset);
  const requested = Math.max(0, Math.floor(Number(amount) || 0));
  let left = requested;
  let afterUsed = beforeUsed;
  let afterBonus = beforeBonus;
  const usedReduce = Math.min(afterUsed, left);
  afterUsed -= usedReduce;
  left -= usedReduce;
  if (left > 0) {
    afterBonus = Math.min(PATROL_COMP_BONUS, afterBonus + left);
    left = requested - usedReduce - (afterBonus - beforeBonus);
  }
  const today = reset.patrolScansDay;
  const nextSave = {
    ...reset,
    patrolScansUsed: afterUsed,
    patrolScansDay: today,
    patrolBonusAttempts: afterBonus,
    patrolBonusDay: afterBonus > 0 ? today : null,
  };
  return {
    save: nextSave,
    beforeUsed,
    afterUsed,
    beforeRemaining,
    afterRemaining: getPatrolScansRemaining(nextSave),
    requested,
    granted: beforeRemaining < getPatrolScansRemaining(nextSave)
      ? getPatrolScansRemaining(nextSave) - beforeRemaining
      : 0,
    patrolDailyMax: PATROL_DAILY_MAX,
  };
}

export function consumePatrolAttempt(save, now = Date.now()) {
  // Rollover only. One-time +50 grant is applied on GET /api/save (ensureCloudSavePatrolReset).
  const reset = applyPatrolDailyResetOnSave(save, now);
  if (getPatrolScansRemaining(reset) <= 0) {
    return { ok: false, error: "no_patrol_attempts", save: reset };
  }
  // Spend base daily attempts first, then today's bonus.
  if (reset.patrolScansUsed < PATROL_DAILY_MAX) {
    return {
      ok: true,
      save: {
        ...reset,
        patrolScansUsed: reset.patrolScansUsed + 1,
      },
    };
  }
  return {
    ok: true,
    save: {
      ...reset,
      patrolBonusAttempts: Math.max(0, clampBonus(reset.patrolBonusAttempts) - 1),
      patrolBonusDay: reset.patrolBonusDay || reset.patrolScansDay,
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

export function preservePatrolProgress(existing, incoming, now = Date.now(), completions = null) {
  // Rollover only — do not re-apply one-time compensation here (that zeros used).
  const ex = applyPatrolDailyResetOnSave(
    existing && typeof existing === "object" ? existing : {},
    now
  );
  const inc = applyPatrolDailyResetOnSave(
    incoming && typeof incoming === "object" ? incoming : {},
    now
  );
  const today = getDailyDayKey(new Date(now));
  const exUsed = clampUsed(ex.patrolScansUsed);
  const incUsed = clampUsed(inc.patrolScansUsed);
  const exDay = ex.patrolScansDay || null;
  const incDay = inc.patrolScansDay || null;
  const exBonus = clampBonus(ex.patrolBonusAttempts);
  const incBonus = clampBonus(inc.patrolBonusAttempts);

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

  const ledgerSource = completions ?? {
    ...(ex.accountBattleCompletions || {}),
    ...(inc.accountBattleCompletions || {}),
  };
  const ledgerFloor = countPatrolCompletionsForDay(ledgerSource, nextDay);
  nextUsed = Math.max(nextUsed, ledgerFloor);

  const exUsedForDay = exDay === nextDay ? exUsed : 0;
  if (incDay === nextDay && incUsed > exUsedForDay && incUsed > ledgerFloor) {
    nextUsed = Math.min(nextUsed, Math.max(exUsedForDay, ledgerFloor));
  }

  // Bonus is same-day only; take the higher remaining bonus after compensation.
  let nextBonus = 0;
  if (nextDay === today) {
    const exBonusToday = (ex.patrolBonusDay === today || !ex.patrolBonusDay) ? exBonus : 0;
    const incBonusToday = (inc.patrolBonusDay === today || !inc.patrolBonusDay) ? incBonus : 0;
    nextBonus = Math.max(exBonusToday, incBonusToday);
  }

  const comps = {
    ...sanitizeAccountCompensationsApplied(ex.accountCompensationsApplied),
    ...sanitizeAccountCompensationsApplied(inc.accountCompensationsApplied),
  };

  return {
    ...inc,
    patrolScansUsed: Math.min(PATROL_DAILY_MAX, nextUsed),
    patrolScansDay: nextDay,
    patrolBonusAttempts: nextBonus,
    patrolBonusDay: nextBonus > 0 ? today : null,
    accountCompensationsApplied: comps,
  };
}

export function mergePatrolProgressOntoLatest(latest, original, intended) {
  const latestUsed = clampUsed(latest?.patrolScansUsed);
  const originalUsed = clampUsed(original?.patrolScansUsed);
  const intendedUsed = clampUsed(intended?.patrolScansUsed);
  const delta = intendedUsed - originalUsed;
  const intendedDay = intended?.patrolScansDay || latest?.patrolScansDay || null;
  const latestDay = latest?.patrolScansDay || null;

  const latestBonus = clampBonus(latest?.patrolBonusAttempts);
  const originalBonus = clampBonus(original?.patrolBonusAttempts);
  const intendedBonus = clampBonus(intended?.patrolBonusAttempts);
  const bonusDelta = intendedBonus - originalBonus;

  let nextUsed;
  let nextDay;
  if (delta <= 0) {
    if (latestDay === intendedDay && latestUsed >= intendedUsed) {
      nextUsed = latestUsed;
      nextDay = latestDay || intendedDay;
    } else {
      nextUsed = Math.max(latestUsed, intendedUsed);
      nextDay = intendedDay || latestDay;
    }
  } else if (latestDay === intendedDay) {
    nextUsed = Math.min(PATROL_DAILY_MAX, Math.max(latestUsed, latestUsed + delta));
    nextDay = intendedDay;
  } else {
    nextUsed = Math.min(PATROL_DAILY_MAX, Math.max(latestUsed, intendedUsed));
    nextDay = intendedDay || latestDay;
  }

  let nextBonus = latestBonus;
  if (bonusDelta !== 0 && (latestDay === intendedDay || !latestDay)) {
    nextBonus = Math.max(0, Math.min(PATROL_COMP_BONUS, latestBonus + bonusDelta));
  } else {
    nextBonus = Math.max(latestBonus, intendedBonus);
  }

  return {
    patrolScansUsed: nextUsed,
    patrolScansDay: nextDay,
    patrolBonusAttempts: nextBonus,
    patrolBonusDay: nextBonus > 0 ? (nextDay || intendedDay) : null,
  };
}

/** Persist patrol rollover + one-time compensation on cloud save (GET /api/save path). */
export async function ensureCloudSavePatrolReset(kv, session, save, startingMonballs = 10, now = Date.now()) {
  if (!kv || !session?.xUserId || !save || typeof save !== "object") return save;
  const next = applyPatrolCompensationOnSave(save, now);
  const changed =
    next.patrolScansUsed !== save.patrolScansUsed
    || next.patrolScansDay !== save.patrolScansDay
    || (next.patrolBonusAttempts || 0) !== (save.patrolBonusAttempts || 0)
    || (next.patrolBonusDay || null) !== (save.patrolBonusDay || null)
    || !sanitizeAccountCompensationsApplied(save.accountCompensationsApplied)[PATROL_COMP_KEY];
  if (!changed) return save;

  const payload = buildSavePayload(
    { ...next, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  return writeCloudSave(kv, session.xUserId, payload, { skipStaleCheck: true });
}
