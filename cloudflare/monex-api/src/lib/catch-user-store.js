import { safeJsonParse } from "./safe-json.js";
import { mergeMonballBalances } from "./grant-monballs.js";
import {
  loadState,
  resolveCatchUser,
  lookupCatchUser,
  DEFAULT_PARTY_MAX,
  DEFAULT_BOX_MAX,
} from "../kv-store.js";

export const CATCH_USER_PREFIX = "monex:catch-user:";
export const CATCH_USERNAME_PREFIX = "monex:catch-username:";

export function catchUserKey(xUserId) {
  return `${CATCH_USER_PREFIX}${String(xUserId || "").trim()}`;
}

export function catchUsernameIndexKey(username) {
  const uname = cleanCatchUsername(username);
  return uname ? `${CATCH_USERNAME_PREFIX}${uname}` : "";
}

export function cleanCatchUsername(username) {
  return String(username || "").toLowerCase().replace(/^@/, "").trim();
}

export function displayCatchUsername(username) {
  return String(username || "").replace(/^@/, "").trim();
}

function defaultCatchUserRecord(username, startingMonballs) {
  return {
    username: displayCatchUsername(username),
    monballs: startingMonballs,
    pendingMons: [],
    updatedAt: new Date().toISOString(),
  };
}

function copyReplyMeta(target, legacy) {
  if (!legacy) return;
  if (legacy.replyDay) target.replyDay = legacy.replyDay;
  if (legacy.replyCount != null) target.replyCount = legacy.replyCount;
  if (legacy.limitNoticeDay) target.limitNoticeDay = legacy.limitNoticeDay;
}

function mergeCatchUserRecords(primary, legacy, startingMonballs) {
  if (!legacy) return { ...primary };
  const merged = { ...primary };
  if (legacy.pendingMons?.length) {
    merged.pendingMons = [...(merged.pendingMons || []), ...legacy.pendingMons];
  }
  merged.monballs = mergeMonballBalances(
    merged.monballs ?? startingMonballs,
    legacy.monballs ?? startingMonballs
  );
  copyReplyMeta(merged, legacy);
  merged.updatedAt = new Date().toISOString();
  return merged;
}

export async function loadCatchUserRecord(kv, xUserId) {
  const uid = String(xUserId || "").trim();
  if (!uid) return null;
  const raw = await kv.get(catchUserKey(uid));
  if (!raw) return null;
  const parsed = safeJsonParse(raw, null);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

export async function saveCatchUserRecord(kv, xUserId, user) {
  const uid = String(xUserId || "").trim();
  if (!uid || !user) return;
  const record = {
    username: user.username,
    monballs: user.monballs,
    pendingMons: user.pendingMons || [],
    updatedAt: user.updatedAt || new Date().toISOString(),
    replyDay: user.replyDay,
    replyCount: user.replyCount,
    limitNoticeDay: user.limitNoticeDay,
  };
  await kv.put(catchUserKey(uid), JSON.stringify(record));
  const uname = cleanCatchUsername(user.username);
  if (uname) {
    await kv.put(catchUsernameIndexKey(uname), uid);
  }
}

async function lookupIndexedCatchUserId(kv, username) {
  const key = catchUsernameIndexKey(username);
  if (!key) return null;
  const uid = await kv.get(key);
  return uid ? String(uid).trim() : null;
}

/** One-time migration from legacy monex:state.users into per-user KV. */
async function migrateLegacyFromStateBlob(kv, xUserId, username, startingMonballs) {
  const uid = String(xUserId || "").trim();
  if (!uid) return null;
  const state = await loadState(kv);
  const user = resolveCatchUser(state, uid, username, startingMonballs);
  if (!user) return null;
  await saveCatchUserRecord(kv, uid, user);
  return { ...user };
}

/**
 * Resolve catch user from per-user KV (creates row if missing).
 * Merges legacy sim_* / username-index duplicates; lazy-migrates monex:state once.
 */
export async function resolveCatchUserKv(kv, xUserId, username, startingMonballs = 10) {
  const uid = String(xUserId || "").trim();
  const uname = cleanCatchUsername(username);

  if (!uid) {
    const indexedUid = uname ? await lookupIndexedCatchUserId(kv, username) : null;
    if (!indexedUid) return null;
    const record = await loadCatchUserRecord(kv, indexedUid);
    return record ? { ...record } : null;
  }

  let record = await loadCatchUserRecord(kv, uid);
  const indexedUid = uname ? await lookupIndexedCatchUserId(kv, username) : null;
  let legacyRecord = null;
  if (indexedUid && indexedUid !== uid) {
    legacyRecord = await loadCatchUserRecord(kv, indexedUid);
  }

  if (!record && legacyRecord) {
    record = {
      ...legacyRecord,
      username: displayCatchUsername(username) || legacyRecord.username,
      pendingMons: [...(legacyRecord.pendingMons || [])],
      updatedAt: legacyRecord.updatedAt || new Date().toISOString(),
    };
    await saveCatchUserRecord(kv, uid, record);
    await kv.delete(catchUserKey(indexedUid));
    return record;
  }

  if (!record) {
    const migrated = await migrateLegacyFromStateBlob(kv, uid, username, startingMonballs);
    if (migrated) return migrated;
    record = defaultCatchUserRecord(username, startingMonballs);
    await saveCatchUserRecord(kv, uid, record);
    return record;
  }

  if (legacyRecord && indexedUid && indexedUid !== uid) {
    record = mergeCatchUserRecords(record, legacyRecord, startingMonballs);
    if (uname) record.username = displayCatchUsername(username);
    await saveCatchUserRecord(kv, uid, record);
    await kv.delete(catchUserKey(indexedUid));
    return record;
  }

  if (uname && record.username && cleanCatchUsername(record.username) !== uname) {
    record.username = displayCatchUsername(username);
  } else if (uname && !record.username) {
    record.username = displayCatchUsername(username);
  }

  return record;
}

/** Read-only catch user lookup — no creates, no legacy migration writes. */
export async function lookupCatchUserKv(kv, xUserId, username, startingMonballs = 10) {
  const uid = String(xUserId || "").trim();
  const uname = cleanCatchUsername(username);

  if (!uid) {
    const indexedUid = uname ? await lookupIndexedCatchUserId(kv, username) : null;
    if (!indexedUid) return null;
    return loadCatchUserRecord(kv, indexedUid);
  }

  const record = await loadCatchUserRecord(kv, uid);
  if (record) {
    const indexedUid = uname ? await lookupIndexedCatchUserId(kv, username) : null;
    if (indexedUid && indexedUid !== uid) {
      const legacy = await loadCatchUserRecord(kv, indexedUid);
      if (legacy) {
        return mergeCatchUserRecords(record, legacy, startingMonballs);
      }
    }
    return record;
  }

  const indexedUid = uname ? await lookupIndexedCatchUserId(kv, username) : null;
  if (indexedUid && indexedUid !== uid) {
    return loadCatchUserRecord(kv, indexedUid);
  }

  const state = await loadState(kv);
  return lookupCatchUser(state, uid, username, startingMonballs);
}

export function syncPendingForCatchUser(
  catchUser,
  partyCount,
  boxCount,
  partyMax = DEFAULT_PARTY_MAX,
  boxMax = DEFAULT_BOX_MAX
) {
  if (!catchUser || !catchUser.pendingMons?.length) {
    return { party: [], box: [], remaining: 0, monballs: catchUser?.monballs ?? null };
  }
  const safePartyMax = Math.max(1, Math.min(20, partyMax | 0));
  const safeBoxMax = Math.max(1, Math.min(10_000, boxMax | 0));
  const partySlots = Math.max(0, safePartyMax - Math.max(0, partyCount | 0));
  const boxSlots = Math.max(0, safeBoxMax - Math.max(0, boxCount | 0));
  const pending = [...catchUser.pendingMons];
  const party = pending.splice(0, partySlots);
  const box = pending.splice(0, boxSlots);
  catchUser.pendingMons = pending;
  catchUser.updatedAt = new Date().toISOString();
  return { party, box, remaining: pending.length, monballs: catchUser.monballs };
}

export async function getPendingForCatchUserKv(kv, xUserId, username, startingMonballs = 10) {
  const user = await lookupCatchUserKv(kv, xUserId, username, startingMonballs);
  if (!user) return { found: false, monballs: null, pendingMons: [] };
  return {
    found: true,
    monballs: user.monballs,
    pendingMons: user.pendingMons || [],
  };
}

export async function findCatchUserIdByUsername(kv, username) {
  const indexed = await lookupIndexedCatchUserId(kv, username);
  if (indexed) return indexed;
  const state = await loadState(kv);
  const uname = cleanCatchUsername(username);
  for (const [key, user] of Object.entries(state?.users || {})) {
    if (user?.username?.toLowerCase() === uname) return key;
  }
  return null;
}

/** @deprecated Use resolveCatchUserKv — kept for scripts/tests that still pass in-memory state. */
export async function hydrateCatchUserIntoState(kv, state, xUserId, username, startingMonballs = 10) {
  const user = await resolveCatchUserKv(kv, xUserId, username, startingMonballs);
  const uid = String(xUserId || "").trim();
  if (user && uid && state?.users) {
    state.users[uid] = user;
  }
  return user;
}

/** @deprecated Use saveCatchUserRecord directly. */
export async function persistCatchUserFromState(kv, state, xUserId) {
  const uid = String(xUserId || "").trim();
  if (!uid) return;
  const user = state?.users?.[uid];
  if (user) await saveCatchUserRecord(kv, uid, user);
}
