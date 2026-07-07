const STATE_KEY = "monex:state";
const ACTIVITY_KEY = "monex:activity";
const POLL_KEY = "monex:poll:sinceId";
const POLL_STATUS_KEY = "monex:poll:lastStatus";
const MAX_ACTIVITY = 500;

export const DEFAULT_PARTY_MAX = 5;
export const DEFAULT_BOX_MAX = 500;

const syncLocks = globalThis.__monexSyncLocks || (globalThis.__monexSyncLocks = new Map());

/** Serialize pending-mon sync per username within this worker isolate. */
export async function withUserSyncLock(username, fn) {
  const key = (username || "").toLowerCase().replace("@", "");
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

export async function loadState(kv) {
  const raw = await kv.get(STATE_KEY);
  if (!raw) return structuredClone(DEFAULT_STATE);
  return JSON.parse(raw);
}

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
  if (!state.users[xUserId]) {
    state.users[xUserId] = {
      username,
      monballs: startingMonballs,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    };
  } else if (username && state.users[xUserId].username !== username) {
    state.users[xUserId].username = username;
  }
  return state.users[xUserId];
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

export function getPendingForUsername(state, username) {
  const user = findUserByUsername(state, username);
  if (!user) return { found: false, monballs: null, pendingMons: [] };
  return {
    found: true,
    monballs: user.monballs,
    pendingMons: user.pendingMons || [],
  };
}

export function syncPendingToSlots(
  state,
  username,
  partyCount,
  boxCount,
  partyMax = DEFAULT_PARTY_MAX,
  boxMax = DEFAULT_BOX_MAX
) {
  const user = findUserByUsername(state, username);
  if (!user || !user.pendingMons?.length) {
    return { party: [], box: [], remaining: 0 };
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
  return { party, box, remaining: pending.length };
}

export async function loadActivityLog(kv) {
  const raw = await kv.get(ACTIVITY_KEY);
  if (!raw) return structuredClone(DEFAULT_ACTIVITY);
  return JSON.parse(raw);
}

export async function saveActivityLog(kv, log) {
  if (log.entries.length > MAX_ACTIVITY) {
    log.entries = log.entries.slice(-MAX_ACTIVITY);
  }
  await kv.put(ACTIVITY_KEY, JSON.stringify(log));
}

export async function appendActivity(kv, entry) {
  const log = await loadActivityLog(kv);
  log.entries.unshift(entry);
  await saveActivityLog(kv, log);
  return entry;
}

export async function listActivities(kv, { limit = 40, page = 1, username = null, successOnly = true } = {}) {
  const log = await loadActivityLog(kv);
  let rows = log.entries;
  if (successOnly) rows = rows.filter((e) => e.status === "success");
  if (username) {
    const u = username.toLowerCase().replace("@", "");
    rows = rows.filter((e) => e.xUsername?.toLowerCase() === u);
  }
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * limit;
  return {
    entries: rows.slice(offset, offset + limit),
    total,
    page: safePage,
    limit,
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
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setPollStatus(kv, status) {
  await kv.put(POLL_STATUS_KEY, JSON.stringify(status), { expirationTtl: 60 * 60 * 24 * 7 });
}

/** Wipe X log, all users/pending catches, cloud saves, and login sessions */
export async function resetAllData(kv) {
  await kv.put(STATE_KEY, JSON.stringify(structuredClone(DEFAULT_STATE)));
  await kv.put(ACTIVITY_KEY, JSON.stringify(structuredClone(DEFAULT_ACTIVITY)));
  await kv.delete(POLL_KEY);

  let deletedSaves = 0;
  let deletedSessions = 0;
  let deletedOAuth = 0;

  for (const [prefix, counter] of [
    ["monex:save:", "saves"],
    ["monex:session:", "sessions"],
    ["monex:oauth:", "oauth"],
  ]) {
    let cursor;
    do {
      const listed = await kv.list({ prefix, cursor });
      await Promise.all(listed.keys.map((k) => kv.delete(k.name)));
      if (counter === "saves") deletedSaves += listed.keys.length;
      if (counter === "sessions") deletedSessions += listed.keys.length;
      if (counter === "oauth") deletedOAuth += listed.keys.length;
      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);
  }

  return { deletedSaves, deletedSessions, deletedOAuth };
}
