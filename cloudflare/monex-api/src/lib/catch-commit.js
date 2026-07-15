import { appendActivity } from "../kv-store.js";
import { saveCatchUserRecord } from "./catch-user-store.js";
import { appendMonballAudit } from "./monball-audit.js";
import { seedOrHydrateCloudSaveFromCatch, syncSaveMonballsAfterCatch } from "./save-reconcile.js";
import { recoverMissingMonsFromActivity } from "./hydrate-save.js";
import { loadCloudSave, writeCloudSave } from "./save.js";
import { assignPersonalCatchLogRef } from "./personal-catch-log.js";
import { debitWalletMonballs } from "./monball-wallet.js";
import {
  buildCatchReceipt,
  loadCatchReceipt,
  saveCatchReceipt,
  computeCatchReceiptStatus,
  enrichActivityWithReceipt,
} from "./catch-receipt.js";

function stageDeferredPendingMons(catchUser, pendingMonsAdded, tweetId) {
  const existing = new Set((catchUser?.pendingMons || []).map((m) => m.pendingId).filter(Boolean));
  if (!catchUser.pendingMons) catchUser.pendingMons = [];
  for (const mon of pendingMonsAdded || []) {
    if (!mon?.pendingId || existing.has(mon.pendingId)) continue;
    catchUser.pendingMons.push({
      ...mon,
      catchTweetId: tweetId,
      awaitingProfileClaim: true,
    });
    existing.add(mon.pendingId);
  }
  catchUser.updatedAt = new Date().toISOString();
}

async function ensurePersonalCatchLogRef(kv, catchUser, tweet, activity, receipt) {
  const existing = Math.floor(Number(receipt?.personalLogNumber) || 0);
  if (existing > 0) return existing;
  const logNumber = await assignPersonalCatchLogRef(kv, catchUser, {
    xUserId: tweet.authorId,
    username: tweet.username,
    tweetId: tweet.id,
    activityId: activity.id,
    catchId: receipt.catchId,
    at: activity.at,
    activity,
    receipt,
  });
  if (logNumber > 0) {
    receipt.personalLogNumber = logNumber;
    activity.personalLogNumber = logNumber;
  }
  return logNumber;
}

/**
 * Server-authoritative catch commit: deliver Mons, write catch log, persist receipt.
 * Idempotent per tweetId — safe to retry without duplicate Mons or log rows.
 */
export async function commitCatchTransaction(
  kv,
  {
    tweet,
    catchUser,
    processResult,
    startingMonballs = 10,
  }
) {
  const { activity, pendingMonsAdded = [] } = processResult || {};
  if (!activity || !catchUser || !tweet?.id) {
    return { ok: false, skipped: true, reason: "no_activity" };
  }

  const existing = await loadCatchReceipt(kv, tweet.id);
  if (existing?.completionStatus === "completed") {
    return {
      ok: true,
      idempotent: true,
      receipt: existing,
      activity: null,
      delivery: { added: 0, remaining: 0 },
    };
  }

  let receipt =
    existing ||
    buildCatchReceipt({
      tweet,
      activity,
      pendingMonsAdded,
      claimModel: processResult.deliveryModel === "claim" ? "deferred" : "legacy",
    });

  receipt.deliveryAttempts = (receipt.deliveryAttempts || 0) + 1;
  receipt.retryStatus = receipt.deliveryAttempts > 1 ? "scheduled" : "none";

  const deferredClaim = processResult.deliveryModel === "claim" || receipt.claimModel === "deferred";

  if (deferredClaim) {
    const session = { xUserId: tweet.authorId, username: tweet.username };
    const spend = Math.max(0, Math.floor(Number(activity.spend) || 0));

    if (!existing?.spendApplied && spend > 0) {
      const debit = await debitWalletMonballs(kv, session, spend, startingMonballs, {
        source: "x_catch_spend",
        meta: { pool: "catch", tweetId: tweet.id, catchId: receipt.catchId, claimModel: "deferred" },
      });
      if (!debit.ok) {
        receipt.lastError = debit.error || "insufficient_monballs";
        receipt.deliveryStatus = "failed";
        receipt.retryStatus = receipt.deliveryAttempts >= 5 ? "exhausted" : "scheduled";
        await saveCatchReceipt(kv, receipt);
        return {
          ok: false,
          error: debit.error || "insufficient_monballs",
          receipt,
          activity: null,
          save: debit.save || null,
          delivery: {
            added: 0,
            remaining: pendingMonsAdded.length,
            deliveryStatus: receipt.deliveryStatus,
            completionStatus: "pending",
            deferred: true,
          },
        };
      }
      receipt.spendApplied = true;
      activity.monballsLeft = debit.after;
      receipt.monballsLeft = debit.after;
      catchUser.monballs = debit.after;
    } else if (existing?.spendApplied) {
      receipt.spendApplied = true;
      catchUser.monballs = activity.monballsLeft ?? catchUser.monballs;
    } else if (spend === 0) {
      receipt.spendApplied = true;
    }

    stageDeferredPendingMons(catchUser, pendingMonsAdded, tweet.id);
    await saveCatchUserRecord(kv, tweet.authorId, catchUser);

    receipt.catchLogStatus = "written";
    const hasMons = (activity.caughtCount || 0) > 0 && pendingMonsAdded.length > 0;
    receipt.deliveryStatus = hasMons ? "queued" : "delivered";
    receipt.completionStatus = hasMons ? "pending" : "completed";

    if (!existing?.catchLogStatus || existing.catchLogStatus !== "written") {
      await ensurePersonalCatchLogRef(kv, catchUser, tweet, activity, receipt);
    } else if (existing?.personalLogNumber) {
      receipt.personalLogNumber = existing.personalLogNumber;
      activity.personalLogNumber = existing.personalLogNumber;
    }

    const activityEntry = enrichActivityWithReceipt(activity, receipt);
    if (!existing?.catchLogStatus || existing.catchLogStatus !== "written") {
      await appendActivity(kv, activityEntry);
    }
    await saveCatchReceipt(kv, receipt);

    return {
      ok: true,
      idempotent: false,
      receipt,
      activity: activityEntry,
      save: null,
      delivery: {
        added: 0,
        remaining: catchUser.pendingMons?.length || pendingMonsAdded.length,
        deliveryStatus: receipt.deliveryStatus,
        completionStatus: receipt.completionStatus,
        deferred: true,
        spendApplied: receipt.spendApplied,
      },
    };
  }

  await saveCatchUserRecord(kv, tweet.authorId, catchUser);

  const spend = activity.spend || 0;
  const balanceAfter = activity.monballsLeft;
  await appendMonballAudit(kv, {
    xUserId: tweet.authorId,
    username: tweet.username,
    source: "x_catch_spend",
    delta: -spend,
    balanceBefore: balanceAfter + spend,
    balanceAfter,
    meta: { pool: "catch", tweetId: tweet.id, catchId: receipt.catchId },
  });

  let save = null;
  let deliveryAdded = 0;
  let deliveryRemaining = pendingMonsAdded.length;

  try {
    const hydrated = await seedOrHydrateCloudSaveFromCatch(
      kv,
      tweet.authorId,
      tweet.username,
      startingMonballs
    );
    save = hydrated.save || null;

    if (save) {
      if (hydrated.hydrated && (hydrated.added || 0) > 0) {
        deliveryAdded += hydrated.added || 0;
        deliveryRemaining = hydrated.remaining ?? deliveryRemaining;
        const { save: latest } = await loadCloudSave(kv, tweet.authorId);
        save = latest;
      } else {
        const recovered = await recoverMissingMonsFromActivity(
          kv,
          tweet.authorId,
          tweet.username,
          save,
          startingMonballs
        );
        if (recovered.recovered) {
          save = recovered.save;
          deliveryAdded += recovered.added?.length || 0;
        }
      }
    }

    await syncSaveMonballsAfterCatch(
      kv,
      tweet.authorId,
      tweet.username,
      activity.monballsLeft,
      startingMonballs,
      { spend: activity.spend, tweetId: tweet.id, catchId: receipt.catchId }
    );

    const { save: finalSave } = await loadCloudSave(kv, tweet.authorId);
    save = finalSave || save;
    receipt = computeCatchReceiptStatus(receipt, save, catchUser);

    if (!existing?.catchLogStatus || existing.catchLogStatus !== "written") {
      await ensurePersonalCatchLogRef(kv, catchUser, tweet, activity, receipt);
    } else if (existing?.personalLogNumber) {
      receipt.personalLogNumber = existing.personalLogNumber;
      activity.personalLogNumber = existing.personalLogNumber;
    }

    const activityEntry = enrichActivityWithReceipt(activity, receipt);

    if (receipt.catchLogStatus !== "written") {
      await appendActivity(kv, activityEntry);
      receipt.catchLogStatus = "written";
      receipt = computeCatchReceiptStatus(
        { ...receipt, catchLogStatus: "written" },
        save,
        catchUser
      );
    } else {
      receipt = computeCatchReceiptStatus(receipt, save, catchUser);
    }

    if (receipt.completionStatus !== "completed" && receipt.deliveryStatus === "delivered") {
      receipt.completionStatus = "completed";
    }

    if (receipt.completionStatus === "pending" && receipt.deliveryStatus === "failed") {
      receipt.retryStatus = receipt.deliveryAttempts >= 5 ? "exhausted" : "scheduled";
    }

    await saveCatchReceipt(kv, receipt);

    return {
      ok: true,
      idempotent: false,
      receipt,
      activity: activityEntry,
      save,
      delivery: {
        added: deliveryAdded,
        remaining: catchUser.pendingMons?.length || deliveryRemaining,
        deliveryStatus: receipt.deliveryStatus,
        completionStatus: receipt.completionStatus,
      },
    };
  } catch (err) {
    receipt.lastError = err?.message || String(err);
    receipt.deliveryStatus = "failed";
    receipt.retryStatus = receipt.deliveryAttempts >= 5 ? "exhausted" : "scheduled";
    await saveCatchReceipt(kv, receipt);
    throw err;
  }
}

/**
 * Retry delivery for pending catch receipts (used by /api/sync and recovery).
 */
export async function retryPendingCatchDeliveries(
  kv,
  xUserId,
  username,
  startingMonballs = 10,
  { partyMax = 3, boxMax = 500, partyCount = null, boxCount = null } = {}
) {
  const { resolveCatchUserKv } = await import("./catch-user-store.js");
  const { backfillPendingForCatchUser } = await import("./backfill-pending.js");

  const catchUser = await resolveCatchUserKv(kv, xUserId, username, startingMonballs);
  const { save: loadedSave } = await loadCloudSave(kv, xUserId);
  let save = loadedSave;

  const pendingResult = backfillPendingForCatchUser(catchUser, {
    username,
    save,
    partyMax,
    boxMax,
    startingMonballs,
    partyCount,
    boxCount,
  });

  if (pendingResult.ok && pendingResult.save) {
    save = pendingResult.save;
    await writeCloudSave(kv, xUserId, save, { skipStaleCheck: true });
  }
  await saveCatchUserRecord(kv, xUserId, catchUser);

  const recovered = await recoverMissingMonsFromActivity(
    kv,
    xUserId,
    username,
    save,
    startingMonballs
  );
  if (recovered.recovered) {
    save = recovered.save;
  }

  return {
    ok: true,
    save,
    added: (pendingResult.added || 0) + (recovered.added?.length || 0),
    remaining: catchUser.pendingMons?.length || 0,
    monballs: save?.monballs ?? pendingResult.monballs,
  };
}
