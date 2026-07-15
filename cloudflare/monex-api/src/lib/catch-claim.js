import {
  cleanCatchUsername,
  loadCatchUserRecord,
  resolveCatchUserKv,
  saveCatchUserRecord,
} from "./catch-user-store.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import {
  loadCatchReceipt,
  saveCatchReceipt,
  computeCatchReceiptStatus,
  enrichActivityWithReceipt,
  markMonsDeliveredFromSave,
  findUndeliveredCatchMons,
} from "./catch-receipt.js";
import { backfillPendingForCatchUser, getWildPendingIds, pendingMonToSaveMon } from "./backfill-pending.js";
import { getWalletMonballs } from "./monball-wallet.js";

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
    merged.push({ ...row, awaitingProfileClaim: false });
    existing.add(row.pendingId);
  }
  return merged;
}

function releaseClaimGatedMons(catchUser, receipt) {
  const ids = new Set((receipt?.mons || []).map((m) => m.pendingId).filter(Boolean));
  if (!ids.size || !catchUser?.pendingMons?.length) return;
  for (const mon of catchUser.pendingMons) {
    if (ids.has(mon.pendingId)) mon.awaitingProfileClaim = false;
  }
  catchUser.updatedAt = new Date().toISOString();
}

function receiptOwnedBySession(receipt, session) {
  if (!receipt || !session?.xUserId) return false;
  if (!receipt.xUserId || receipt.xUserId === session.xUserId) return true;
  const receiptUser = cleanCatchUsername(receipt.username);
  const sessionUser = cleanCatchUsername(session.username);
  return !!receiptUser && receiptUser === sessionUser;
}

/** Merge staged mons from a legacy catch-user KV row when X user ids were remapped. */
async function mergeLegacyCatchUserPending(catchUser, kv, receipt, session) {
  if (!catchUser || !receipt?.xUserId || receipt.xUserId === session.xUserId) return catchUser;
  const legacy = await loadCatchUserRecord(kv, receipt.xUserId);
  if (!legacy?.pendingMons?.length) return catchUser;
  const existing = new Set((catchUser.pendingMons || []).map((m) => m.pendingId).filter(Boolean));
  if (!catchUser.pendingMons) catchUser.pendingMons = [];
  for (const mon of legacy.pendingMons) {
    if (!mon?.pendingId || existing.has(mon.pendingId)) continue;
    catchUser.pendingMons.push({ ...mon });
    existing.add(mon.pendingId);
  }
  catchUser.updatedAt = new Date().toISOString();
  return catchUser;
}

function countOpenPartyBoxSlots(save, partyMax, boxMax) {
  const safePartyMax = Math.max(1, Math.min(20, partyMax | 0));
  const safeBoxMax = Math.max(1, Math.min(10_000, boxMax | 0));
  const partyLen = save?.party?.length ?? 0;
  const boxLen = save?.box?.length ?? 0;
  return {
    partySlots: Math.max(0, safePartyMax - partyLen),
    boxSlots: Math.max(0, safeBoxMax - boxLen),
  };
}

function mergeClaimDeliveryIntoLatest(latest, deliverySave) {
  if (!latest || !deliverySave) return deliverySave || latest;
  const seen = getWildPendingIds(latest);
  const party = [...(latest.party || [])];
  const box = [...(latest.box || [])];
  for (const mon of deliverySave.party || []) {
    const pid = mon?.wildPendingId || mon?.pendingId;
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    party.push(mon);
  }
  for (const mon of deliverySave.box || []) {
    const pid = mon?.wildPendingId || mon?.pendingId;
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    box.push(mon);
  }
  return {
    ...latest,
    party,
    box,
    monballs: deliverySave.monballs ?? latest.monballs,
    xHandle: latest.xHandle || deliverySave.xHandle,
  };
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
      const merged = mergeClaimDeliveryIntoLatest(latest, save);
      return persistClaimSave(kv, session, merged, latest.revision, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "claim_conflict", save: err.existingSave };
    }
    throw err;
  }
}

/**
 * Claim a catch session from the profile / activity log.
 * Spend is applied at catch-log commit time; claim dispatches mons to party/box only.
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
    if (!receiptOwnedBySession(receipt, session)) {
      return { ok: false, error: "forbidden" };
    }

    const legacyReceiptUserId =
      receipt.xUserId && receipt.xUserId !== session.xUserId ? receipt.xUserId : null;

    const { save: loadedSave } = await loadCloudSave(kv, session.xUserId);
    let save = loadedSave || {};
    const deferred = isDeferredReceipt(receipt);

    if (legacyReceiptUserId) {
      receipt = { ...receipt, xUserId: session.xUserId };
    }

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
    const monballs = await getWalletMonballs(kv, session.xUserId, session.username, startingMonballs);

    let catchUser = await resolveCatchUserKv(kv, session.xUserId, session.username, startingMonballs);
    if (!catchUser) {
      return { ok: false, error: "catch_user_not_found", save, receipt };
    }
    if (legacyReceiptUserId) {
      catchUser = await mergeLegacyCatchUserPending(
        catchUser,
        kv,
        { ...receipt, xUserId: legacyReceiptUserId },
        session
      );
    }
    catchUser.pendingMons = mergeUndeliveredPending(catchUser, receipt, save);
    releaseClaimGatedMons(catchUser, receipt);

    // Slot math uses authoritative cloud save counts (client local party/box can be stale).
    const effectivePartyCount = save?.party?.length ?? 0;
    const effectiveBoxCount = save?.box?.length ?? 0;
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

    const undelivered = findUndeliveredCatchMons(receipt, delivery.save);
    if (undelivered.length > 0 && (delivery.added || 0) === 0) {
      const { partySlots, boxSlots } = countOpenPartyBoxSlots(delivery.save, partyMax, boxMax);
      if (partySlots === 0 && boxSlots === 0) {
        return {
          ok: false,
          error: "party_box_full",
          save: delivery.save,
          receipt,
          undelivered: undelivered.length,
        };
      }
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
        monballsLeft: receipt.monballsLeft ?? monballs,
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
