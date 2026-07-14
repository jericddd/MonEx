import { getWildPendingIds } from "./backfill-pending.js";
import { loadCatchReceipt, saveCatchReceipt, computeCatchReceiptStatus } from "./catch-receipt.js";
import { retryPendingCatchDeliveries } from "./catch-commit.js";
import { loadCloudSave } from "./save.js";
import { resolveCatchUserKv } from "./catch-user-store.js";
import { filterActivityEntries, recoverActivityCatchesForUser } from "./recover-activity-catches.js";

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
    for (const mon of mons) {
      const pendingId = mon?.pendingId;
      if (!pendingId) {
        issues.push({
          type: "log_missing_pending_id",
          tweetId: entry.tweetId,
          activityId: entry.id,
          name: mon?.name,
        });
        continue;
      }
      if (!deliveredIds.has(pendingId) && !pendingIds.has(pendingId)) {
        issues.push({
          type: "log_without_inventory",
          tweetId: entry.tweetId,
          activityId: entry.id,
          pendingId,
          name: mon?.name,
        });
      }
    }
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
    const { writeCloudSave } = await import("./save.js");
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
