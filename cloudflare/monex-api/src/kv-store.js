import { cleanPersonalLogUsername } from "./lib/personal-catch-log.js";
import { mergeMonballBalances } from "./lib/grant-monballs.js";
import { safeJsonParse } from "./lib/safe-json.js";

const STATE_KEY = "monex:state";
const ACTIVITY_KEY = "monex:activity";
const USER_ACTIVITY_INDEX_PREFIX = "monex:activity-user:";
const POLL_KEY = "monex:poll:sinceId";
const POLL_STATUS_KEY = "monex:poll:lastStatus";
const RESET_EPOCH_KEY = "monex:resetEpoch";
const RATE_LIMIT_PREFIX = "monex:rl:";
const MAX_ACTIVITY = 500;
const MAX_USER_ACTIVITY_INDEX = 250;
/** Profile /mine reads at most this many personal catch rows per request. */
export const PROFILE_CATCH_LOG_LIMIT = 30;

/** Hidden from global /api/activity feed (home X Wild Log). Personal /mine still works. */
const HIDDEN_ACTIVITY_USERNAMES = new Set(["yesdraken_"]);

/** Matches GAME_PARTY_MAX in backfill-pending.js (client party slots). */
export const DEFAULT_PARTY_MAX = 3;
export const DEFAULT_BOX_MAX = 500;

const syncLocks = globalThis.__monexSyncLocks || (globalThis.__monexSyncLocks = new Map());

/** Normalize lock key — always prefer xUserId over username to avoid poll/sync races. */
export function userSyncLockKey(xUserId, username) {
  const uid = String(xUserId || "").trim();
  if (uid) return uid;
  return (username || "").toLowerCase().replace("@", "");
}

/** Serialize pending-mon sync per user within this worker isolate. */
export async function withUserSyncLock(usernameOrKey, fn) {
  const key = String(usernameOrKey || "").toLowerCase().replace("@", "");
  while (syncLocks.get(key)) await syncLocks.get(key);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  syncLocks.set(key, gate);
  try {
    return await fn();
  } finally {
    syncLocks.delete(key);
    release();
  }
}

const DEFAULT_STATE = { processedTweetIds: [], users: {} };
const DEFAULT_ACTIVITY = { entries: [] };
const DEFAULT_USER_ACTIVITY_INDEX = { entries: [] };

export function userActivityIndexKey(xUserId) {
  return `${USER_ACTIVITY_INDEX_PREFIX}${String(xUserId || "").trim()}`;
}

export async function loadState(kv) {
  const raw = await kv.get(STATE_KEY);
  if (!raw) return structuredClone(DEFAULT_STATE);
  return safeJsonParse(raw, structuredClone(DEFAULT_STATE));
}

/** @deprecated Runtime catch users use monex:catch-user:{xUserId}. Ops/scripts only. */
export async function saveState(kv, state) {
  if (state.processedTweetIds.length > 5000) {
    state.processedTweetIds = state.processedTweetIds.slice(-3000);
  }
  await kv.put(STATE_KEY, JSON.stringify(state));
}

export function wasProcessed(state, tweetId) {
  return state.processedTweetIds.includes(tweetId);
}

export function markProcessed(state, tweetId) {
  if (!wasProcessed(state, tweetId)) state.processedTweetIds.push(tweetId);
}

export function getUser(state, xUserId, username, startingMonballs) {
  const cleanUsername = (username || "").toLowerCase().replace("@", "");
  if (!state.users[xUserId]) {
    state.users[xUserId] = {
      username: cleanUsername || username,
      monballs: startingMonballs,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    };
  } else if (cleanUsername && state.users[xUserId].username?.toLowerCase() !== cleanUsername) {
    state.users[xUserId].username = cleanUsername;
  }
  return state.users[xUserId];
}

export function recordReplySent(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (user.replyDay !== today) {
    user.replyDay = today;
    user.replyCount = 0;
  }
  user.replyCount = (user.replyCount || 0) + 1;
  user.updatedAt = new Date().toISOString();
}

export function canSendReply(user, limit = 5) {
  if (!user || limit <= 0) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (user.replyDay !== today) return true;
  return (user.replyCount || 0) < limit;
}

export function getReplyCountToday(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (!user || user.replyDay !== today) return 0;
  return user.replyCount || 0;
}

export function addPendingMons(user, mons) {
  const batchAt = new Date().toISOString();
  user.pendingMons.push(
    ...mons.map((m) => ({
      ...m,
      pendingId: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      caughtAt: batchAt,
    }))
  );
  user.updatedAt = new Date().toISOString();
}

export function findUserByUsername(state, username) {
  const u = (username || "").toLowerCase().replace("@", "");
  if (!u) return null;
  for (const user of Object.values(state.users)) {
    if (user.username?.toLowerCase() === u) return user;
  }
  return null;
}

function findUserKey(state, user) {
  if (!user) return null;
  for (const [key, entry] of Object.entries(state.users || {})) {
    if (entry === user) return key;
  }
  return null;
}

/** Same @handle under a different KV key (e.g. sim_* dev login vs real X author id). */
function findLegacyUserByUsername(state, username, excludeUserId = null) {
  const u = (username || "").toLowerCase().replace("@", "");
  if (!u) return null;
  for (const [key, user] of Object.entries(state.users || {})) {
    if (excludeUserId && key === excludeUserId) continue;
    if (user.username?.toLowerCase() === u) return { key, user };
  }
  return null;
}

function copyReplyMetaFromLegacy(target, legacy) {
  if (!legacy) return;
  if (legacy.replyDay) target.replyDay = legacy.replyDay;
  if (legacy.replyCount != null) target.replyCount = legacy.replyCount;
  if (legacy.limitNoticeDay) target.limitNoticeDay = legacy.limitNoticeDay;
}

/** Resolve catch-state user by OAuth xUserId, merging legacy username-only rows. */
export function resolveCatchUser(state, xUserId, username, startingMonballs = 10) {
  const uid = String(xUserId || "");
  const uname = (username || "").toLowerCase().replace("@", "");
  if (!uid) {
    const legacy = findUserByUsername(state, uname);
    return legacy || null;
  }

  let user = state.users[uid];
  const legacyMatch = findLegacyUserByUsername(state, uname, uid);
  const legacy = legacyMatch?.user || null;
  const legacyKey = legacyMatch?.key || null;

  if (!user && legacy) {
    state.users[uid] = {
      username: uname || legacy.username,
      monballs: legacy.monballs ?? startingMonballs,
      pendingMons: [...(legacy.pendingMons || [])],
      updatedAt: legacy.updatedAt || new Date().toISOString(),
    };
    copyReplyMetaFromLegacy(state.users[uid], legacy);
    if (legacyKey && legacyKey !== uid) delete state.users[legacyKey];
    return state.users[uid];
  }

  if (!user) {
    state.users[uid] = {
      username: uname,
      monballs: startingMonballs,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    };
    return state.users[uid];
  }

  if (uname) user.username = uname;

  if (legacy && legacy !== user && legacyKey && legacyKey !== uid) {
    if (legacy.pendingMons?.length) {
      user.pendingMons = [...(user.pendingMons || []), ...legacy.pendingMons];
    }
    user.monballs = mergeMonballBalances(user.monballs ?? startingMonballs, legacy.monballs ?? startingMonballs);
    copyReplyMetaFromLegacy(user, legacy);
    delete state.users[legacyKey];
  }

  return user;
}

/** Read-only catch user lookup — does not create rows or persist legacy merges. */
export function lookupCatchUser(state, xUserId, username, startingMonballs = 10) {
  const uid = String(xUserId || "");
  const uname = (username || "").toLowerCase().replace("@", "");
  if (!uid) return findUserByUsername(state, uname);

  const user = state.users[uid] || null;
  const legacyMatch = findLegacyUserByUsername(state, uname, uid);
  const legacy = legacyMatch?.user || null;

  if (!user && legacy) {
    return {
      username: uname || legacy.username,
      monballs: legacy.monballs ?? startingMonballs,
      pendingMons: [...(legacy.pendingMons || [])],
    };
  }
  if (!user) return null;

  if (legacy && legacy !== user) {
    return {
      ...user,
      monballs: mergeMonballBalances(user.monballs ?? startingMonballs, legacy.monballs ?? startingMonballs),
      pendingMons: [
        ...(user.pendingMons || []),
        ...(legacy.pendingMons || []),
      ],
    };
  }
  return user;
}

export function getPendingForSession(state, xUserId, username, startingMonballs = 10) {
  const user = lookupCatchUser(state, xUserId, username, startingMonballs);
  if (!user) return { found: false, monballs: null, pendingMons: [] };
  return {
    found: true,
    monballs: user.monballs,
    pendingMons: user.pendingMons || [],
  };
}

export function getPendingForUsername(state, username) {
  return getPendingForSession(state, null, username);
}

export function syncPendingForSession(
  state,
  xUserId,
  username,
  partyCount,
  boxCount,
  partyMax = DEFAULT_PARTY_MAX,
  boxMax = DEFAULT_BOX_MAX,
  startingMonballs = 10
) {
  const user = resolveCatchUser(state, xUserId, username, startingMonballs);
  if (!user || !user.pendingMons?.length) {
    return { party: [], box: [], remaining: 0, monballs: user?.monballs ?? null };
  }
  const safePartyMax = Math.max(1, Math.min(20, partyMax | 0));
  const safeBoxMax = Math.max(1, Math.min(10_000, boxMax | 0));
  const partySlots = Math.max(0, safePartyMax - Math.max(0, partyCount | 0));
  const boxSlots = Math.max(0, safeBoxMax - Math.max(0, boxCount | 0));
  const pending = [...user.pendingMons];
  const party = pending.splice(0, partySlots);
  const box = pending.splice(0, boxSlots);
  user.pendingMons = pending;
  user.updatedAt = new Date().toISOString();
  return { party, box, remaining: pending.length, monballs: user.monballs };
}

export function syncPendingToSlots(
  state,
  username,
  partyCount,
  boxCount,
  partyMax = DEFAULT_PARTY_MAX,
  boxMax = DEFAULT_BOX_MAX
) {
  return syncPendingForSession(state, null, username, partyCount, boxCount, partyMax, boxMax);
}

export async function loadActivityLog(kv) {
  const raw = await kv.get(ACTIVITY_KEY);
  if (!raw) return structuredClone(DEFAULT_ACTIVITY);
  return safeJsonParse(raw, structuredClone(DEFAULT_ACTIVITY));
}

export async function loadUserActivityIndex(kv, xUserId) {
  if (!kv || !xUserId) return structuredClone(DEFAULT_USER_ACTIVITY_INDEX);
  const raw = await kv.get(userActivityIndexKey(xUserId));
  if (!raw) return structuredClone(DEFAULT_USER_ACTIVITY_INDEX);
  return safeJsonParse(raw, structuredClone(DEFAULT_USER_ACTIVITY_INDEX));
}

export async function saveUserActivityIndex(kv, xUserId, index) {
  if (!kv || !xUserId) return;
  let entries = Array.isArray(index?.entries) ? index.entries : [];
  if (entries.length > MAX_USER_ACTIVITY_INDEX) {
    entries = entries.slice(0, MAX_USER_ACTIVITY_INDEX);
  }
  await kv.put(userActivityIndexKey(xUserId), JSON.stringify({ entries }));
}

export async function appendUserActivityIndex(kv, xUserId, entry) {
  if (!kv || !xUserId || !entry || entry.status !== "success") return;
  const index = await loadUserActivityIndex(kv, xUserId);
  const tweetId = String(entry.tweetId || "");
  if (tweetId && index.entries.some((row) => String(row.tweetId) === tweetId)) return;
  index.entries = index.entries.filter((row) => row.id !== entry.id);
  index.entries.unshift(entry);
  await saveUserActivityIndex(kv, xUserId, index);
}

/** Per-user catch log index only — never reads the global activity log. */
export async function listUserActivities(
  kv,
  xUserId,
  username,
  { limit = PROFILE_CATCH_LOG_LIMIT, page = 1, successOnly = true } = {}
) {
  const safeLimit = Math.min(
    PROFILE_CATCH_LOG_LIMIT,
    Number.isFinite(limit) && limit > 0 ? limit : PROFILE_CATCH_LOG_LIMIT
  );
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const index = await loadUserActivityIndex(kv, xUserId);
  const handle = cleanPersonalLogUsername(username);
  let rows = index.entries || [];
  if (handle) {
    rows = rows.filter((entry) => cleanPersonalLogUsername(entry.xUsername) === handle);
  }
  if (successOnly) rows = rows.filter((entry) => entry.status === "success");
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const pageNum = Math.min(Math.max(1, safePage), totalPages);
  const offset = (pageNum - 1) * safeLimit;
  const entries = rows.slice(offset, offset + safeLimit);
  return {
    entries,
    total,
    page: pageNum,
    limit: safeLimit,
    totalPages,
  };
}

export async function saveActivityLog(kv, log) {
  if (log.entries.length > MAX_ACTIVITY) {
    log.entries = log.entries.slice(-MAX_ACTIVITY);
  }
  await kv.put(ACTIVITY_KEY, JSON.stringify(log));
}

export async function appendActivity(kv, entry) {
  const log = await loadActivityLog(kv);
  if (entry?.tweetId && log.entries.some((e) => String(e.tweetId) === String(entry.tweetId))) {
    return entry;
  }
  log.entries.unshift(entry);
  await saveActivityLog(kv, log);
  const uid = String(entry?.xUserId || "").trim();
  if (uid) await appendUserActivityIndex(kv, uid, entry);
  return entry;
}

export async function listActivities(kv, { limit = 40, page = 1, username = null, successOnly = true } = {}) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 40;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const log = await loadActivityLog(kv);
  let rows = log.entries;
  if (successOnly) rows = rows.filter((e) => e.status === "success");
  if (username) {
    const u = username.toLowerCase().replace("@", "");
    rows = rows.filter((e) => e.xUsername?.toLowerCase() === u);
  } else {
    rows = rows.filter((e) => !HIDDEN_ACTIVITY_USERNAMES.has((e.xUsername || "").toLowerCase().replace("@", "")));
  }
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const pageNum = Math.min(Math.max(1, safePage), totalPages);
  const offset = (pageNum - 1) * safeLimit;
  const entries = rows.slice(offset, offset + safeLimit);
  return {
    entries,
    total,
    page: pageNum,
    limit: safeLimit,
    totalPages,
  };
}

export function makeActivityId() {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function getPollSinceId(kv) {
  return (await kv.get(POLL_KEY)) || null;
}

export async function setPollSinceId(kv, id) {
  if (id) await kv.put(POLL_KEY, id);
}

export async function clearPollSinceId(kv) {
  await kv.delete(POLL_KEY);
}

export async function getPollStatus(kv) {
  const raw = await kv.get(POLL_STATUS_KEY);
  if (!raw) return null;
  return safeJsonParse(raw, null);
}

export async function setPollStatus(kv, status) {
  await kv.put(POLL_STATUS_KEY, JSON.stringify(status), { expirationTtl: 60 * 60 * 24 * 7 });
}

export async function getResetEpoch(kv) {
  const raw = await kv.get(RESET_EPOCH_KEY);
  const n = parseInt(raw || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

async function bumpResetEpoch(kv) {
  const next = (await getResetEpoch(kv)) + 1;
  await kv.put(RESET_EPOCH_KEY, String(next));
  return next;
}

async function deleteKvPrefix(kv, prefix) {
  let deleted = 0;
  let cursor;
  do {
    const listed = await kv.list({ prefix, cursor });
    if (listed.keys.length) {
      await Promise.all(listed.keys.map((k) => kv.delete(k.name)));
      deleted += listed.keys.length;
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
  return deleted;
}

/** Wipe X log, all users/pending catches, cloud saves, and login sessions */
export async function resetAllData(kv) {
  const resetEpoch = await bumpResetEpoch(kv);
  await kv.put(STATE_KEY, JSON.stringify(structuredClone(DEFAULT_STATE)));
  await kv.put(ACTIVITY_KEY, JSON.stringify(structuredClone(DEFAULT_ACTIVITY)));
  await kv.delete(POLL_KEY);
  await kv.delete(POLL_STATUS_KEY);

  let deletedSaves = 0;
  let deletedSessions = 0;
  let deletedOAuth = 0;

  for (const [prefix, counter] of [
    ["monex:save:", "saves"],
    ["monex:session:", "sessions"],
    ["monex:oauth:", "oauth"],
    ["monex:catch-user:", "catchUsers"],
  ]) {
    const count = await deleteKvPrefix(kv, prefix);
    if (counter === "saves") deletedSaves = count;
    if (counter === "sessions") deletedSessions = count;
    if (counter === "oauth") deletedOAuth = count;
  }

  const deletedRateLimits = await deleteKvPrefix(kv, RATE_LIMIT_PREFIX);

  return { deletedSaves, deletedSessions, deletedOAuth, deletedRateLimits, resetEpoch };
}
