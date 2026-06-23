const STATE_KEY = "monex:state";
const ACTIVITY_KEY = "monex:activity";
const POLL_KEY = "monex:poll:sinceId";
const MAX_ACTIVITY = 500;

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
  user.pendingMons.push(
    ...mons.map((m) => ({ ...m, caughtAt: new Date().toISOString() }))
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

export function syncPendingToSlots(state, username, partyCount, boxCount, partyMax = 3, boxMax = 6) {
  const user = findUserByUsername(state, username);
  if (!user || !user.pendingMons?.length) {
    return { party: [], box: [], remaining: 0 };
  }
  const partySlots = Math.max(0, partyMax - partyCount);
  const boxSlots = Math.max(0, boxMax - boxCount);
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
