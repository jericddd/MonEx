import { getWildPendingIds } from "./backfill-pending.js";

export const CATCH_RECEIPT_PREFIX = "monex:catch-receipt:";
export const CATCH_RECEIPT_TTL_SECONDS = 60 * 60 * 24 * 90;

export function catchReceiptKey(tweetId) {
  return `${CATCH_RECEIPT_PREFIX}${String(tweetId || "").trim()}`;
}

function normalizeMonRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const pendingId = String(raw.pendingId || "").trim();
  if (!pendingId) return null;
  return {
    pendingId,
    name: String(raw.name || ""),
    rarity: String(raw.rarity || ""),
    skills: Array.isArray(raw.skills) ? raw.skills.map(String) : [],
    delivered: !!raw.delivered,
    destination: raw.destination ? String(raw.destination) : null,
  };
}

export function sanitizeCatchReceipt(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tweetId = String(raw.tweetId || "").trim();
  if (!tweetId) return null;
  const mons = Array.isArray(raw.mons) ? raw.mons.map(normalizeMonRow).filter(Boolean) : [];
  return {
    catchId: String(raw.catchId || `catch_${tweetId}`),
    tweetId,
    activityId: String(raw.activityId || ""),
    xUserId: String(raw.xUserId || ""),
    username: String(raw.username || ""),
    spend: Math.max(0, Math.floor(Number(raw.spend) || 0)),
    throws: Math.max(0, Math.floor(Number(raw.throws) || 0)),
    caughtCount: Math.max(0, Math.floor(Number(raw.caughtCount) || 0)),
    monballsBefore: Math.max(0, Math.floor(Number(raw.monballsBefore) || 0)),
    monballsLeft: Math.max(0, Math.floor(Number(raw.monballsLeft) || 0)),
    catchLogStatus: raw.catchLogStatus === "written" ? "written" : raw.catchLogStatus === "failed" ? "failed" : "pending",
    deliveryStatus:
      raw.deliveryStatus === "delivered" ||
      raw.deliveryStatus === "partial" ||
      raw.deliveryStatus === "queued" ||
      raw.deliveryStatus === "failed"
        ? raw.deliveryStatus
        : "pending",
    retryStatus:
      raw.retryStatus === "scheduled" || raw.retryStatus === "exhausted" ? raw.retryStatus : "none",
    completionStatus:
      raw.completionStatus === "completed" || raw.completionStatus === "failed"
        ? raw.completionStatus
        : "pending",
    mons,
    at: typeof raw.at === "string" ? raw.at : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    deliveryAttempts: Math.max(0, Math.floor(Number(raw.deliveryAttempts) || 0)),
    lastError: typeof raw.lastError === "string" ? raw.lastError.slice(0, 240) : null,
  };
}

export async function loadCatchReceipt(kv, tweetId) {
  if (!kv || !tweetId) return null;
  const raw = await kv.get(catchReceiptKey(tweetId));
  if (!raw) return null;
  try {
    return sanitizeCatchReceipt(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveCatchReceipt(kv, receipt) {
  if (!kv || !receipt?.tweetId) return null;
  const payload = sanitizeCatchReceipt({
    ...receipt,
    updatedAt: new Date().toISOString(),
  });
  await kv.put(catchReceiptKey(receipt.tweetId), JSON.stringify(payload), {
    expirationTtl: CATCH_RECEIPT_TTL_SECONDS,
  });
  return payload;
}

export function buildCatchReceipt({ tweet, activity, pendingMonsAdded = [] }) {
  const at = activity?.at || new Date().toISOString();
  return sanitizeCatchReceipt({
    catchId: `catch_${tweet.id}`,
    tweetId: String(tweet.id),
    activityId: activity.id,
    xUserId: String(tweet.authorId),
    username: tweet.username,
    spend: activity.spend,
    throws: activity.throws,
    caughtCount: activity.caughtCount,
    monballsBefore: activity.monballsBefore,
    monballsLeft: activity.monballsLeft,
    catchLogStatus: "pending",
    deliveryStatus: "pending",
    retryStatus: "none",
    completionStatus: "pending",
    mons: pendingMonsAdded.map((mon) => ({
      pendingId: mon.pendingId,
      name: mon.name,
      rarity: mon.rarity,
      skills: Array.isArray(mon.skills) ? mon.skills : [],
      delivered: false,
      destination: null,
    })),
    at,
    updatedAt: at,
    deliveryAttempts: 0,
    lastError: null,
  });
}

export function markMonsDeliveredFromSave(receipt, save) {
  if (!receipt || !save) return receipt;
  const partyIds = new Map();
  for (const mon of save.party || []) {
    const id = mon?.wildPendingId || mon?.pendingId;
    if (id) partyIds.set(String(id), "party");
  }
  for (const mon of save.box || []) {
    const id = mon?.wildPendingId || mon?.pendingId;
    if (id) partyIds.set(String(id), "box");
  }
  const mons = (receipt.mons || []).map((row) => {
    const dest = partyIds.get(row.pendingId);
    if (!dest) return row;
    return { ...row, delivered: true, destination: dest };
  });
  return { ...receipt, mons };
}

export function computeCatchReceiptStatus(receipt, save, catchUser) {
  const next = markMonsDeliveredFromSave(receipt, save);
  const totalCaught = next.mons.length;
  const deliveredCount = next.mons.filter((m) => m.delivered).length;
  const queuedCount = catchUser?.pendingMons?.length || 0;

  let deliveryStatus = "pending";
  let completionStatus = "pending";

  if (totalCaught === 0) {
    deliveryStatus = "delivered";
    completionStatus = next.catchLogStatus === "written" ? "completed" : "pending";
  } else if (deliveredCount === totalCaught) {
    deliveryStatus = "delivered";
    completionStatus = next.catchLogStatus === "written" ? "completed" : "pending";
  } else if (deliveredCount > 0 || queuedCount > 0) {
    deliveryStatus = queuedCount > 0 && deliveredCount === 0 ? "queued" : "partial";
    completionStatus = "pending";
  } else {
    deliveryStatus = "failed";
    completionStatus = "pending";
  }

  return {
    ...next,
    deliveryStatus,
    completionStatus,
    deliveredCount,
    queuedCount,
    totalCaught,
  };
}

export function activityHasPendingIds(activity) {
  return Array.isArray(activity?.mons) && activity.mons.some((m) => m?.pendingId);
}

export function enrichActivityWithReceipt(activity, receipt) {
  if (!activity || !receipt) return activity;
  const byId = new Map((receipt.mons || []).map((m) => [m.pendingId, m]));
  const mons = (activity.mons || []).map((row, index) => {
    const pendingId =
      row?.pendingId ||
      receipt.mons[index]?.pendingId ||
      null;
    const receiptMon = pendingId ? byId.get(pendingId) : null;
    return {
      ...row,
      pendingId,
      catchId: receipt.catchId,
      delivered: receiptMon?.delivered ?? false,
      destination: receiptMon?.destination ?? null,
    };
  });
  return {
    ...activity,
    catchId: receipt.catchId,
    deliveryStatus: receipt.deliveryStatus,
    completionStatus: receipt.completionStatus,
    mons,
  };
}

export function findUndeliveredCatchMons(receipt, save) {
  const delivered = getWildPendingIds(save || {});
  return (receipt?.mons || []).filter((m) => m.pendingId && !delivered.has(m.pendingId));
}
