import { loadActivityLog } from "../kv-store.js";
import { loadCatchUserRecord } from "./catch-user-store.js";
import { lookupCatchUser, loadState } from "../kv-store.js";
import { loadCloudSave, writeCloudSave } from "./save.js";
import {
  seedOrHydrateCloudSaveFromCatch,
  getAuthoritativeMonballs,
} from "./save-reconcile.js";
import { recoverActivityCatchesForUser } from "./recover-activity-catches.js";
import { cleanUsername } from "./backfill-pending.js";

/** Read-only catch user for GET /api/save (no KV writes). */
export async function lookupCatchUserReadOnly(kv, xUserId, username, startingMonballs = 10) {
  const uid = String(xUserId || "").trim();
  if (!uid) return null;
  const record = await loadCatchUserRecord(kv, uid);
  if (record) {
    return {
      username: record.username || username,
      monballs: record.monballs,
      pendingMons: record.pendingMons || [],
      updatedAt: record.updatedAt,
    };
  }
  const state = await loadState(kv);
  return lookupCatchUser(state, uid, username, startingMonballs);
}

/** Recover mons from activity log when pending queue is empty (legacy auto-backfill). */
export async function recoverMissingMonsFromActivity(kv, xUserId, username, save, startingMonballs = 10) {
  const uname = cleanUsername(username);
  const log = await loadActivityLog(kv);
  const result = recoverActivityCatchesForUser({
    username: uname,
    activityEntries: log.entries || [],
    save: save || {},
    caseSensitive: false,
  });
  if (!result.added?.length) {
    return { recovered: false, added: [], save: result.save };
  }
  const monballs = await getAuthoritativeMonballs(kv, xUserId, uname, startingMonballs);
  const nextSave = {
    ...result.save,
    monballs,
    updatedAt: new Date().toISOString(),
  };
  await writeCloudSave(kv, xUserId, nextSave, { skipStaleCheck: true });
  return { recovered: true, added: result.added, save: nextSave };
}

/**
 * POST /api/hydrate — merge pending catches + optional activity recovery into cloud save.
 */
export async function hydrateUserCloudSave(
  kv,
  xUserId,
  username,
  startingMonballs = 10,
  { requirePending = false } = {}
) {
  if (!xUserId) return { ok: false, hydrated: false, reason: "no_x_user_id" };

  const catchResult = await seedOrHydrateCloudSaveFromCatch(
    kv,
    xUserId,
    username,
    startingMonballs,
    { requirePending }
  );

  const { found, save } = await loadCloudSave(kv, xUserId);
  if (!found && !catchResult.hydrated) {
    return { ok: true, hydrated: false, reason: catchResult.reason || "no_save", added: 0 };
  }

  const baseSave = catchResult.save || save;
  const activityResult = await recoverMissingMonsFromActivity(
    kv,
    xUserId,
    username,
    baseSave,
    startingMonballs
  );

  const finalSave = activityResult.recovered ? activityResult.save : baseSave;
  const added =
    (catchResult.added || 0) + (activityResult.added?.length || 0);

  return {
    ok: true,
    hydrated: catchResult.hydrated || activityResult.recovered,
    seeded: catchResult.seeded || false,
    fromActivity: activityResult.recovered,
    added,
    save: finalSave,
    remaining: catchResult.remaining ?? 0,
  };
}
