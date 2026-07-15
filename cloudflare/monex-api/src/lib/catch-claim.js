import { resolveCatchUserKv, saveCatchUserRecord } from "./catch-user-store.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import {
  loadCatchReceipt,
  saveCatchReceipt,
  computeCatchReceiptStatus,
  enrichActivityWithReceipt,
  markMonsDeliveredFromSave,
} from "./catch-receipt.js";
import { backfillPendingForCatchUser, getWildPendingIds, pendingMonToSaveMon } from "./backfill-pending.js";
import { debitWalletMonballs, getWalletMonballs } from "./monball-wallet.js";
import { appendMonballAudit } from "./monball-audit.js";

const MAX_CLAIM_RETRIES = 4;
const claimLocks = globalThis.__monexCatchClaimLocks || (globalThis.__monexCatchClaimLocks = new Map());

async function acquireClaimLock(key) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  while (claimLocks.has(key)) await claimLocks.get(key);
  claimLocks.set(key, gate);
  return () => {
    if (claimLocks.get(key) === gate) claimLocks.delete(key);
    release();
  };
}

function isDeferredReceipt(receipt) {
  return receipt?.claimModel === "deferred";
}

function pendingRowsFromReceipt(receipt) {
  return (receipt?.mons || [])
    .filter((row) => row?.pendingId)
    .map((row) => ({
      name: row.name,
      rarity: row.rarity,
      skills: Array.isArray(row.skills) ? row.skills : [],
      pendingId: row.pendingId,
      caughtAt: receipt.at || new Date().toISOString(),
    }));
}

function mergeUndeliveredPending(catchUser, receipt, save) {
  const delivered = getWildPendingIds(save);
  const existing = new Set((catchUser?.pendingMons || []).map((m) => m.pendingId).filter(Boolean));
  const merged = [...(catchUser?.pendingMons || [])];
  for (const row of pendingRowsFromReceipt(receipt)) {
    if (!row.pendingId || delivered.has(row.pendingId) || existing.has(row.pendingId)) continue;
    merged.push(row);
    existing.add(row.pendingId);
  }
  return merged;
}

async function persistClaimSave(kv, session, save, expectedRevision, attempt = 0) {
  const now = Date.now();
  const payload = buildSavePayload(
    { ...save, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, { expectedRevision });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      return persistClaimSave(kv, session, save, latest.revision, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "claim_conflict", save: err.existingSave };
    }
    throw err;
  }
}

/**
 * Claim a catch session from the profile / activity log.
 * Deferred model: spend + deliver on claim.
 * Legacy model: spend already applied at tweet — deliver only, idempotent if already done.
 */
export async function claimCatchFromLog(
  kv,
  session,
  {
    tweetId,
    partyCount = null,
    boxCount = null,
    partyMax = 3,
    boxMax = 500,
    expectedRevision,
    startingMonballs = 10,
  } = {}
) {
  const id = String(tweetId || "").trim();
  if (!id || !session?.xUserId) return { ok: false, error: "tweet_id_required" };

  const release = await acquireClaimLock(`${session.xUserId}:${id}`);
  try {
    let receipt = await loadCatchReceipt(kv, id);
    if (!receipt) return { ok: false, error: "catch_not_found" };
    if (receipt.xUserId && receipt.xUserId !== session.xUserId) {
      return { ok: false, error: "forbidden" };
    }

    const { save: loadedSave } = await loadCloudSave(kv, session.xUserId);
    let save = loadedSave || {};
    const deferred = isDeferredReceipt(receipt);

    if (receipt.completionStatus === "completed") {
      receipt = markMonsDeliveredFromSave(receipt, save);
      return {
        ok: true,
        alreadyClaimed: true,
        save,
        receipt,
        monballs: await getWalletMonballs(kv, session.xUserId, session.username, startingMonballs),
      };
    }

    const spend = Math.max(0, Math.floor(Number(receipt.spend) || 0));
    let monballs = await getWalletMonballs(kv, session.xUserId, session.username, startingMonballs);

    if (deferred && !receipt.spendApplied) {
      const debit = await debitWalletMonballs(kv, session, spend, startingMonballs, {
        source: "catch_claim_spend",
        meta: { tweetId: id, catchId: receipt.catchId },
      });
      if (!debit.ok) {
        return {
          ok: false,
          error: debit.error || "insufficient_monballs",
          monballs,
          required: spend,
        };
      }
      save = debit.save || save;
      monballs = debit.after;
      receipt.spendApplied = true;
    } else if (!deferred && spend > 0) {
      await appendMonballAudit(kv, {
        xUserId: session.xUserId,
        username: session.username,
        source: "catch_claim_legacy",
        delta: 0,
        balanceAfter: monballs,
        meta: { tweetId: id, catchId: receipt.catchId, note: "spend_already_at_tweet" },
      });
    }

    const catchUser = await resolveCatchUserKv(kv, session.xUserId, session.username, startingMonballs);
    catchUser.pendingMons = mergeUndeliveredPending(catchUser, receipt, save);

    const effectivePartyCount = partyCount ?? save?.party?.length ?? 0;
    const effectiveBoxCount = boxCount ?? save?.box?.length ?? 0;
    const delivery = backfillPendingForCatchUser(catchUser, {
      username: session.username,
      save: { ...save, monballs },
      partyMax,
      boxMax,
      startingMonballs,
      partyCount: effectivePartyCount,
      boxCount: effectiveBoxCount,
    });

    if (!delivery.ok || !delivery.save) {
      return { ok: false, error: delivery.reason || "delivery_failed", save, receipt };
    }

    await saveCatchUserRecord(kv, session.xUserId, catchUser);

    receipt = markMonsDeliveredFromSave(receipt, delivery.save);
    receipt.claimedAt = new Date().toISOString();
    receipt.deliveryStatus =
      receipt.mons.length === 0
        ? "delivered"
        : receipt.mons.every((m) => m.delivered)
          ? "delivered"
          : receipt.mons.some((m) => m.delivered)
            ? "partial"
            : "queued";
    receipt.completionStatus =
      receipt.mons.length === 0 || receipt.mons.every((m) => m.delivered) ? "completed" : "pending";
    receipt = computeCatchReceiptStatus(receipt, delivery.save, catchUser);
    if (receipt.mons.every((m) => m.delivered) || receipt.mons.length === 0) {
      receipt.completionStatus = "completed";
      receipt.deliveryStatus = "delivered";
    }

    const expectedRev =
      expectedRevision != null && Number.isFinite(Number(expectedRevision))
        ? Number(expectedRevision)
        : delivery.save.revision;

    const persisted = await persistClaimSave(kv, session, delivery.save, expectedRev);
    if (!persisted.ok) return persisted;

    await saveCatchReceipt(kv, receipt);

    const activityView = enrichActivityWithReceipt(
      {
        tweetId: id,
        spend,
        monballsLeft: deferred ? Math.max(0, monballs) : receipt.monballsLeft,
        mons: receipt.mons,
      },
      receipt
    );

    return {
      ok: true,
      save: persisted.save,
      receipt,
      activity: activityView,
      added: delivery.added || 0,
      remaining: catchUser.pendingMons?.length || 0,
      monballs: persisted.save?.monballs ?? monballs,
      deferred,
    };
  } finally {
    release();
  }
}

/** Refresh activity rows with live receipt claim state for profile UI. */
export async function enrichActivityEntriesWithReceipts(kv, entries = []) {
  const out = [];
  for (const entry of entries) {
    if (!entry?.tweetId) {
      out.push(entry);
      continue;
    }
    const receipt = await loadCatchReceipt(kv, entry.tweetId);
    if (!receipt) {
      out.push(entry);
      continue;
    }
    out.push(enrichActivityWithReceipt(entry, receipt));
  }
  return out;
}

export function monsAlreadyDelivered(save, receipt) {
  const delivered = getWildPendingIds(save);
  return (receipt?.mons || []).every((row) => !row.pendingId || delivered.has(row.pendingId));
}

export function receiptPendingMonRows(receipt) {
  return pendingRowsFromReceipt(receipt).filter((row) => pendingMonToSaveMon(row));
}
