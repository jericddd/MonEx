import { getWildPendingIds } from "./backfill-pending.js";
import { loadCatchReceipt, saveCatchReceipt, computeCatchReceiptStatus } from "./catch-receipt.js";
import { retryPendingCatchDeliveries } from "./catch-commit.js";
import { loadCloudSave, writeCloudSave } from "./save.js";
import { resolveCatchUserKv } from "./catch-user-store.js";
import { filterActivityEntries, recoverActivityCatchesForUser } from "./recover-activity-catches.js";

function inventoryHasCatchMon(save, { pendingId, activityId, index, name }) {
  const deliveredIds = getWildPendingIds(save || {});
  if (pendingId && deliveredIds.has(pendingId)) return true;
  if (activityId != null && index != null) {
    const recoveryId = `recovery_${activityId}_${index}`;
    if (deliveredIds.has(recoveryId)) return true;
  }
  for (const mon of [...(save?.party || []), ...(save?.box || [])]) {
    if (pendingId && (mon.wildPendingId === pendingId || mon.pendingId === pendingId)) return true;
    if (activityId != null && index != null && mon.wildPendingId === `recovery_${activityId}_${index}`) {
      return true;
    }
    if (name && mon.name === name && activityId && String(mon.wildPendingId || "").includes(String(activityId))) {
      return true;
    }
  }
  return false;
}

/** Align recovery_* wildPendingIds to canonical p_* ids from the activity log when both refer to the same slot. */
export function alignCatchPendingIdsInSave(save, activityEntries, username) {
  if (!save || typeof save !== "object") return { save, changed: false, aligned: 0 };
  const activities = filterActivityEntries(activityEntries, username, { caseSensitive: false })
    .filter((e) => e.status === "success" && (e.caughtCount || 0) > 0);

  let changed = false;
  let aligned = 0;
  const patchMon = (mon) => {
    if (!mon?.wildPendingId || !String(mon.wildPendingId).startsWith("recovery_")) return mon;
    const match = String(mon.wildPendingId).match(/^recovery_(.+)_(\d+)$/);
    if (!match) return mon;
    const activityKey = match[1];
    const index = Number(match[2]);
    const entry = activities.find((e) => e.id === activityKey || e.tweetId === activityKey);
    const pendingId = entry?.mons?.[index]?.pendingId;
    if (!pendingId || pendingId === mon.wildPendingId) return mon;
    changed = true;
    aligned += 1;
    const next = { ...mon, wildPendingId: pendingId };
    if (next.instanceId && String(next.instanceId).startsWith("recovery_")) {
      next.instanceId = pendingId;
    }
    return next;
  };

  const nextSave = {
    ...save,
    party: (save.party || []).map(patchMon),
    box: (save.box || []).map(patchMon),
  };
  return { save: nextSave, changed, aligned };
}

export function auditCatchSyncForUser({ username, save, catchUser, activityEntries = [] }) {
  const issues = [];
  const deliveredIds = getWildPendingIds(save || {});
  const pendingIds = new Set(
    (catchUser?.pendingMons || [])
      .map((m) => m?.pendingId)
      .filter(Boolean)
      .map(String)
  );

  const userActivities = filterActivityEntries(activityEntries, username, { caseSensitive: false })
    .filter((e) => e.status === "success" && (e.caughtCount || 0) > 0);

  for (const entry of userActivities) {
    const mons = Array.isArray(entry.mons) ? entry.mons : [];
    mons.forEach((mon, index) => {
      const pendingId = mon?.pendingId;
      if (!pendingId) {
        issues.push({
          type: "log_missing_pending_id",
          tweetId: entry.tweetId,
          activityId: entry.id,
          name: mon?.name,
        });
        return;
      }
      if (
        !inventoryHasCatchMon(save, {
          pendingId,
          activityId: entry.id || entry.tweetId,
          index,
          name: mon?.name,
        }) &&
        !pendingIds.has(pendingId)
      ) {
        issues.push({
          type: "log_without_inventory",
          tweetId: entry.tweetId,
          activityId: entry.id,
          pendingId,
          name: mon?.name,
        });
      }
    });
  }

  for (const id of deliveredIds) {
    const inLog = userActivities.some((entry) =>
      (entry.mons || []).some((m) => String(m.pendingId) === String(id))
    );
    if (!inLog && String(id).startsWith("p_")) {
      issues.push({
        type: "inventory_without_log",
        pendingId: id,
      });
    }
  }

  if ((catchUser?.pendingMons?.length || 0) > 0) {
    issues.push({
      type: "pending_queue",
      count: catchUser.pendingMons.length,
    });
  }

  return {
    username,
    issueCount: issues.length,
    issues,
    activityCount: userActivities.length,
    inventoryCatchIds: [...deliveredIds],
  };
}

export async function repairCatchSyncForUser(
  kv,
  xUserId,
  username,
  startingMonballs = 10,
  { activityEntries = [], dryRun = false } = {}
) {
  const catchUser = await resolveCatchUserKv(kv, xUserId, username, startingMonballs);
  const { save: loadedSave } = await loadCloudSave(kv, xUserId);
  const before = auditCatchSyncForUser({
    username,
    save: loadedSave,
    catchUser,
    activityEntries,
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      before,
      after: before,
      repaired: 0,
    };
  }

  const retried = await retryPendingCatchDeliveries(kv, xUserId, username, startingMonballs);
  let save = retried.save || loadedSave;

  const recovery = recoverActivityCatchesForUser({
    username,
    activityEntries,
    save,
    caseSensitive: false,
  });

  if (recovery.added?.length) {
    save = recovery.save;
    await writeCloudSave(kv, xUserId, save, { skipStaleCheck: true });
  }

  const aligned = alignCatchPendingIdsInSave(save, activityEntries, username);
  if (aligned.changed) {
    save = aligned.save;
    await writeCloudSave(kv, xUserId, save, { skipStaleCheck: true });
  }

  const afterCatchUser = await resolveCatchUserKv(kv, xUserId, username, startingMonballs);
  const after = auditCatchSyncForUser({
    username,
    save,
    catchUser: afterCatchUser,
    activityEntries,
  });

  const repaired = Math.max(0, before.issueCount - after.issueCount);

  for (const entry of filterActivityEntries(activityEntries, username, { caseSensitive: false })) {
    if (!entry?.tweetId) continue;
    const receipt = await loadCatchReceipt(kv, entry.tweetId);
    if (!receipt) continue;
    const updated = computeCatchReceiptStatus(receipt, save, afterCatchUser);
    await saveCatchReceipt(kv, updated);
  }

  return {
    ok: true,
    dryRun: false,
    before,
    after,
    repaired,
    delivery: retried,
    recoveryAdded: recovery.added?.length || 0,
  };
}
