import {
  resolveCatchUserKv,
  lookupCatchUserKv,
  saveCatchUserRecord,
} from "./catch-user-store.js";
import { backfillPendingForCatchUser } from "./backfill-pending.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { clampMonballs, mergeMonballBalances, creditCatchMonballs } from "./grant-monballs.js";
import { appendMonballAudit } from "./monball-audit.js";
import { cleanUsername } from "./backfill-pending.js";
import { MAX_SAVE_DELTA } from "./save-economy-guard.js";
import { validateAndSanitizeSave } from "./save-validate.js";

/**
 * Authoritative monball count across catch state and cloud save.
 */
export async function getAuthoritativeMonballs(kv, xUserId, username, startingMonballs = 10) {
  const catchUser = await lookupCatchUserKv(kv, xUserId, username, startingMonballs);
  const { save } = await loadCloudSave(kv, xUserId);
  return resolveMergedMonballs(catchUser, save, catchUser?.monballs ?? 0);
}

/**
 * After an X catch session, mirror catch-state balance into cloud save so the
 * game UI and catch log stay aligned.
 */
export async function syncSaveMonballsAfterCatch(kv, xUserId, username, monballsLeft, startingMonballs = 10, auditMeta = {}) {
  if (!xUserId) return null;
  const left = clampMonballs(monballsLeft);
  const now = new Date().toISOString();

  const { save } = await loadCloudSave(kv, xUserId);
  const before = clampMonballs(save.monballs ?? 0);
  const nextSave = {
    ...save,
    monballs: left,
    xHandle: save.xHandle || String(username || "").replace(/^@/, "").toLowerCase(),
    updatedAt: now,
  };
  await writeCloudSave(kv, xUserId, nextSave, { skipStaleCheck: true });
  if (before !== left) {
    await appendMonballAudit(kv, {
      xUserId,
      username,
      source: "x_catch",
      delta: left - before,
      balanceAfter: left,
      meta: { pool: "cloud_save", ...auditMeta },
    });
  }
  return left;
}

/**
 * Reconcile incoming cloud save with catch state before persisting.
 * Prevents stale client saves from resurrecting spent monballs.
 */
export async function reconcileMonballsForCloudSave(kv, session, payload, startingMonballs = 10) {
  if (!session?.xUserId || !payload) return payload;

  const { save: existingSave } = await loadCloudSave(kv, session.xUserId);
  const catchUser = await lookupCatchUserKv(kv, session.xUserId, session.username, startingMonballs);
  const catchMonballs = clampMonballs(catchUser?.monballs ?? 0);
  const existingMonballs = clampMonballs(existingSave?.monballs ?? 0);

  let merged = resolveMergedMonballs(catchUser, existingSave, catchMonballs);
  const incoming = clampMonballs(payload.monballs ?? 0);
  const persistedMonballs = existingMonballs;

  if (incoming < merged) {
    merged = incoming;
  } else if (incoming > merged) {
    const catchTs = Date.parse(catchUser?.updatedAt || "");
    const saveTs = Date.parse(existingSave?.updatedAt || "");
    const catchLeads =
      Number.isFinite(catchTs) && (!Number.isFinite(saveTs) || catchTs >= saveTs);
    const catchSpentBelowClient =
      catchLeads && incoming > catchMonballs && (catchMonballs < existingMonballs || catchMonballs === 0);
    if (catchSpentBelowClient) {
      merged = catchMonballs;
    } else {
      const poolsDepleted = catchMonballs === 0 && existingMonballs === 0 && merged === 0;
      if (!poolsDepleted) {
        const maxAllowed = merged + MAX_SAVE_DELTA.monballs;
        merged = Math.min(Math.max(merged, incoming), maxAllowed);
      }
    }
  }

  const now = new Date().toISOString();
  payload.monballs = merged;

  if (catchUser && catchMonballs !== merged) {
    const nextCatchUser = { ...catchUser, monballs: merged, updatedAt: now };
    await saveCatchUserRecord(kv, session.xUserId, nextCatchUser);
  }

  if (merged !== persistedMonballs) {
    await appendMonballAudit(kv, {
      xUserId: session.xUserId,
      username: session.username,
      source: "save_reconcile",
      delta: merged - persistedMonballs,
      balanceAfter: merged,
      meta: {
        pool: "cloud_save",
        catchMonballs,
        persistedMonballs,
        incoming,
      },
    });
  }

  return payload;
}

/**
 * Server-authoritative monball credit — updates catch pool and cloud save together.
 * Used by quest/mailbox grants so the client always receives the merged balance.
 */
export async function applyAuthoritativeMonballGrant(
  kv,
  session,
  delta,
  startingMonballs = 10,
  auditSource = "monball_grant"
) {
  const amount = clampMonballs(delta);
  if (!amount || !session?.xUserId) return null;

  await creditCatchMonballs(kv, session, amount, startingMonballs, auditSource);
  const { save } = await loadCloudSave(kv, session.xUserId);
  const monballs = await getAuthoritativeMonballs(kv, session.xUserId, session.username, startingMonballs);
  const nextSave = buildSavePayload(
    { ...save, monballs, updatedAt: new Date().toISOString() },
    session
  );
  return writeCloudSave(kv, session.xUserId, nextSave, { skipStaleCheck: true });
}

/**
 * @deprecated Use reconcileMonballsForCloudSave — blind align overwrote catch spends.
 */
export async function alignCatchMonballsToSave(kv, session, saveMonballs, startingMonballs = 10) {
  if (!session?.xUserId) return null;
  const user = await resolveCatchUserKv(kv, session.xUserId, session.username, startingMonballs);
  if (!user) return null;
  const aligned = clampMonballs(saveMonballs ?? 0);
  user.monballs = aligned;
  user.updatedAt = new Date().toISOString();
  await saveCatchUserRecord(kv, session.xUserId, user);
  return aligned;
}

/**
 * Move pending X catches into cloud save and align monballs — server-side so
 * inventory updates without waiting for the client /api/sync game-session gate.
 */
export async function hydrateCloudSaveWithCatchState(
  kv,
  xUserId,
  username,
  startingMonballs = 10
) {
  if (!xUserId) return { hydrated: false, reason: "no_x_user_id" };

  const { found, save } = await loadCloudSave(kv, xUserId);
  if (!found) {
    return { hydrated: false, reason: "no_cloud_save" };
  }

  const catchUser = await resolveCatchUserKv(kv, xUserId, username, startingMonballs);
  const result = backfillPendingForCatchUser(catchUser, {
    username,
    save,
    startingMonballs,
  });
  await saveCatchUserRecord(kv, xUserId, catchUser);

  if (!result.ok || !result.save) {
    return { hydrated: false, reason: result.reason || "backfill_failed" };
  }

  const monballs = clampMonballs(catchUser?.monballs ?? result.monballs ?? startingMonballs);
  const nextSave = {
    ...result.save,
    monballs,
    updatedAt: new Date().toISOString(),
  };
  await writeCloudSave(kv, xUserId, nextSave, { skipStaleCheck: true });

  return {
    hydrated: true,
    save: nextSave,
    added: result.added,
    remaining: result.remaining,
    monballs,
  };
}

/**
 * On X catch: seed a stub cloud save when none exists, then backfill pending mons.
 * Fixes pre-login catch gap (activity logged but inventory empty until first login).
 */
export async function seedOrHydrateCloudSaveFromCatch(
  kv,
  xUserId,
  username,
  startingMonballs = 10,
  { requirePending = false } = {}
) {
  if (!xUserId) return { hydrated: false, reason: "no_x_user_id" };

  const { found, save } = await loadCloudSave(kv, xUserId);
  if (found) {
    return hydrateCloudSaveWithCatchState(kv, xUserId, username, startingMonballs);
  }

  const uname = cleanUsername(username);
  const catchUser = await resolveCatchUserKv(kv, xUserId, uname, startingMonballs);
  const pendingCount = catchUser?.pendingMons?.length || 0;
  if (requirePending && pendingCount === 0) {
    return { hydrated: false, reason: "no_pending_catches" };
  }
  const stub = validateAndSanitizeSave(
    {
      party: [],
      box: [],
      monballs: clampMonballs(catchUser?.monballs ?? startingMonballs),
      xHandle: uname,
      updatedAt: new Date().toISOString(),
    },
    { username: uname }
  );

  const result = backfillPendingForCatchUser(catchUser, {
    username: uname,
    save: stub,
    startingMonballs,
  });
  await saveCatchUserRecord(kv, xUserId, catchUser);

  if (!result.ok || !result.save) {
    return { hydrated: false, reason: result.reason || "seed_backfill_failed" };
  }

  const monballs = await getAuthoritativeMonballs(kv, xUserId, uname, startingMonballs);
  const nextSave = {
    ...result.save,
    monballs,
    updatedAt: new Date().toISOString(),
  };
  await writeCloudSave(kv, xUserId, nextSave, { skipStaleCheck: true });

  return {
    hydrated: true,
    seeded: true,
    save: nextSave,
    added: result.added,
    remaining: result.remaining,
    monballs,
  };
}

export function resolveMergedMonballs(catchUser, save, catchMonballs) {
  const catchTs = Date.parse(catchUser?.updatedAt || "");
  const saveTs = Date.parse(save?.updatedAt || "");
  const catchVal = clampMonballs(catchMonballs ?? 0);
  const saveVal = clampMonballs(save?.monballs ?? 0);
  const catchTsValid = Number.isFinite(catchTs);
  const saveTsValid = Number.isFinite(saveTs);

  if (catchTsValid && !saveTsValid) return catchVal;
  if (saveTsValid && !catchTsValid) return saveVal;
  if (catchTsValid && saveTsValid) {
    if (catchTs > saveTs) return catchVal;
    if (saveTs > catchTs) return saveVal;
    return catchVal;
  }
  return mergeMonballBalances(catchVal, saveVal);
}
