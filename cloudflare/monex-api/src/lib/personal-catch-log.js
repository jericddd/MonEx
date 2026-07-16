import { loadUserActivityIndex } from "../kv-store.js";
import { loadCatchReceipt } from "./catch-receipt.js";
import { catchUsernameIndexKey } from "./catch-user-store.js";

export const PERSONAL_CATCH_LOG_PREFIX = "monex:personal-catch-log:";
export const PERSONAL_CATCH_LOG_TWEET_PREFIX = "monex:personal-catch-log-tweet:";
/** Long retention — support reference survives activity trim / receipt TTL. */
export const PERSONAL_CATCH_LOG_REF_TTL_SECONDS = 60 * 60 * 24 * 365 * 5;

export function personalCatchLogRefKey(xUserId, logNumber) {
  return `${PERSONAL_CATCH_LOG_PREFIX}${String(xUserId || "").trim()}:${Math.floor(Number(logNumber) || 0)}`;
}

export function personalCatchLogTweetKey(xUserId, tweetId) {
  return `${PERSONAL_CATCH_LOG_TWEET_PREFIX}${String(xUserId || "").trim()}:${String(tweetId || "").trim()}`;
}

export function cleanPersonalLogUsername(username) {
  return String(username || "").toLowerCase().replace(/^@/, "").trim();
}

export function filterUserSuccessfulCatchEntries(entries, username) {
  const u = cleanPersonalLogUsername(username);
  if (!u) return [];
  return (entries || [])
    .filter(
      (entry) =>
        entry?.status === "success" &&
        cleanPersonalLogUsername(entry.xUsername) === u
    )
    .sort((a, b) => Date.parse(a.at || "") - Date.parse(b.at || ""));
}

export function inferPersonalCatchLogSeq(entries, username) {
  const rows = filterUserSuccessfulCatchEntries(entries, username);
  let max = 0;
  for (const row of rows) {
    const n = Math.floor(Number(row.personalLogNumber) || 0);
    if (n > max) max = n;
  }
  return Math.max(max, rows.length);
}

export function buildPersonalCatchLogRef({
  logNumber,
  xUserId,
  username,
  tweetId,
  activityId,
  catchId,
  at,
  activity = {},
  receipt = {},
}) {
  return {
    logNumber,
    xUserId: String(xUserId || ""),
    username: String(username || ""),
    tweetId: String(tweetId || ""),
    activityId: String(activityId || ""),
    catchId: String(catchId || ""),
    at: at || activity.at || new Date().toISOString(),
    spend: Math.max(0, Math.floor(Number(activity.spend ?? receipt.spend) || 0)),
    throws: Math.max(0, Math.floor(Number(activity.throws ?? receipt.throws) || 0)),
    caughtCount: Math.max(0, Math.floor(Number(activity.caughtCount ?? receipt.caughtCount) || 0)),
    monballsBefore: Math.max(0, Math.floor(Number(activity.monballsBefore ?? receipt.monballsBefore) || 0)),
    monballsLeft: Math.max(0, Math.floor(Number(activity.monballsLeft ?? receipt.monballsLeft) || 0)),
    claimModel: receipt.claimModel === "deferred" ? "deferred" : "legacy",
    completionStatus: receipt.completionStatus || activity.completionStatus || "pending",
    deliveryStatus: receipt.deliveryStatus || activity.deliveryStatus || "pending",
    spendApplied: receipt.spendApplied === true,
    savedAt: new Date().toISOString(),
  };
}

export async function loadPersonalCatchLogRef(kv, xUserId, logNumber) {
  if (!kv || !xUserId || !logNumber) return null;
  const raw = await kv.get(personalCatchLogRefKey(xUserId, logNumber));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function savePersonalCatchLogRef(kv, xUserId, payload) {
  if (!kv || !xUserId || !payload?.logNumber) return null;
  const stored = {
    ...payload,
    logNumber: Math.floor(Number(payload.logNumber)),
    savedAt: new Date().toISOString(),
  };
  await kv.put(personalCatchLogRefKey(xUserId, stored.logNumber), JSON.stringify(stored), {
    expirationTtl: PERSONAL_CATCH_LOG_REF_TTL_SECONDS,
  });
  if (stored.tweetId) {
    await kv.put(
      personalCatchLogTweetKey(xUserId, stored.tweetId),
      JSON.stringify({ logNumber: stored.logNumber, tweetId: stored.tweetId }),
      { expirationTtl: PERSONAL_CATCH_LOG_REF_TTL_SECONDS }
    );
  }
  return stored;
}

/**
 * Assign a permanent personal log # for a new catch session (oldest = 1).
 * Mutates catchUser.personalCatchLogSeq when a new number is issued.
 */
export async function assignPersonalCatchLogRef(
  kv,
  catchUser,
  { xUserId, username, tweetId, activityId, catchId, at, activity = {}, receipt = {} }
) {
  const uid = String(xUserId || "").trim();
  const id = String(tweetId || "").trim();
  if (!kv || !uid || !id) return null;

  const existingReceiptNum = Math.floor(Number(receipt?.personalLogNumber) || 0);
  if (existingReceiptNum > 0) return existingReceiptNum;

  const tweetRaw = await kv.get(personalCatchLogTweetKey(uid, id));
  if (tweetRaw) {
    try {
      const parsed = JSON.parse(tweetRaw);
      if (parsed?.logNumber > 0) return parsed.logNumber;
    } catch {
      /* fall through */
    }
  }

  const index = await loadUserActivityIndex(kv, uid);
  const existingEntry = filterUserSuccessfulCatchEntries(index.entries, username).find(
    (row) => String(row.tweetId) === id
  );
  if (existingEntry?.personalLogNumber > 0) {
    return existingEntry.personalLogNumber;
  }

  const inferred = inferPersonalCatchLogSeq(index.entries, username);
  const seq = Math.max(Number(catchUser?.personalCatchLogSeq) || 0, inferred);
  const logNumber = seq + 1;
  if (catchUser) catchUser.personalCatchLogSeq = logNumber;

  const refPayload = buildPersonalCatchLogRef({
    logNumber,
    xUserId: uid,
    username,
    tweetId: id,
    activityId,
    catchId,
    at,
    activity,
    receipt,
  });
  await savePersonalCatchLogRef(kv, uid, refPayload);
  return logNumber;
}

export function findActivityEntryByTweetId(entries, tweetId) {
  const id = String(tweetId || "").trim();
  if (!id) return null;
  return (entries || []).find((entry) => String(entry.tweetId) === id) || null;
}

export function findActivityEntryByPersonalLogNumber(entries, username, logNumber) {
  const n = Math.floor(Number(logNumber) || 0);
  if (n < 1) return null;
  const rows = filterUserSuccessfulCatchEntries(entries, username);
  const stored = rows.find((row) => Number(row.personalLogNumber) === n);
  if (stored) return stored;
  return rows[n - 1] || null;
}

/**
 * Ops/support lookup: resolve personal log # to activity row, receipt, and durable ref.
 */
export async function resolvePersonalCatchLog(
  kv,
  { xUserId = null, username = null, logNumber, startingMonballs = 10 } = {}
) {
  const n = Math.floor(Number(logNumber) || 0);
  if (n < 1) return { ok: false, error: "invalid_log_number" };

  let uid = String(xUserId || "").trim();
  const uname = cleanPersonalLogUsername(username);
  if (!uid && uname) {
    uid = (await kv.get(catchUsernameIndexKey(uname))) || "";
    uid = String(uid).trim();
  }
  if (!uid) return { ok: false, error: "user_not_found" };

  const ref = await loadPersonalCatchLogRef(kv, uid, n);
  const index = await loadUserActivityIndex(kv, uid);
  const displayUsername = ref?.username || username;
  let activity =
    (ref?.tweetId ? findActivityEntryByTweetId(index.entries, ref.tweetId) : null) ||
    findActivityEntryByPersonalLogNumber(index.entries, displayUsername, n);

  let receipt = ref?.tweetId ? await loadCatchReceipt(kv, ref.tweetId) : null;
  if (!receipt && activity?.tweetId) {
    receipt = await loadCatchReceipt(kv, activity.tweetId);
  }

  if (!ref && !activity && !receipt) {
    return { ok: false, error: "log_not_found", logNumber: n, xUserId: uid };
  }

  return {
    ok: true,
    logNumber: n,
    xUserId: uid,
    username: displayUsername || activity?.xUsername || null,
    ref,
    activity,
    receipt,
    tweetId: ref?.tweetId || activity?.tweetId || receipt?.tweetId || null,
  };
}

/** Prefer stored personalLogNumber; fall back to position-based numbering for legacy rows. */
export function attachPersonalLogNumbers(entries, { total, page = 1, limit } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  const count = Math.max(0, Math.floor(Number(total) || 0));
  const safeLimit = Math.max(1, Math.floor(Number(limit) || rows.length || 1));
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (safePage - 1) * safeLimit;
  return rows.map((entry, index) => {
    const stored = Math.floor(Number(entry.personalLogNumber) || 0);
    const computed = Math.max(1, count - offset - index);
    return {
      ...entry,
      personalLogNumber: stored > 0 ? stored : computed,
      personalLogNumberSource: stored > 0 ? "stored" : "computed",
    };
  });
}
