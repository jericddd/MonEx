/**
 * Resolve production xUserId + cloud save for ops scripts (REST KV helpers).
 */

export const SAVE_PREFIX = "monex:save:";
export const SESSION_PREFIX = "monex:session:";
export const CATCH_USER_PREFIX = "monex:catch-user:";
export const CATCH_USERNAME_PREFIX = "monex:catch-username:";
export const STATE_KEY = "monex:state";

export function normalizeUsername(username) {
  return String(username || "").toLowerCase().replace(/^@/, "").trim();
}

export function displayUsername(username) {
  return String(username || "").replace(/^@/, "").trim();
}

export async function findUserIdFromCatchUsernameIndex(getValue, username) {
  const key = `${CATCH_USERNAME_PREFIX}${normalizeUsername(username)}`;
  const raw = await getValue(key);
  return raw ? String(raw).trim() : null;
}

export async function findUserIdFromLegacyState(getValue, username) {
  const raw = await getValue(STATE_KEY);
  if (!raw) return null;
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    return null;
  }
  const wanted = normalizeUsername(username);
  for (const [xUserId, user] of Object.entries(state.users || {})) {
    if (user?.username?.toLowerCase() === wanted) return xUserId;
  }
  return null;
}

export async function findUserIdFromSessions(getValue, listKeys, username) {
  const keys = await listKeys(SESSION_PREFIX);
  const wanted = normalizeUsername(username);
  for (const key of keys) {
    const raw = await getValue(key);
    if (!raw) continue;
    try {
      const session = JSON.parse(raw);
      if (session?.username?.toLowerCase() === wanted && session?.xUserId) {
        return String(session.xUserId);
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

export async function findUserIdFromSaves(getValue, listKeys, username) {
  const keys = await listKeys(SAVE_PREFIX);
  const wanted = normalizeUsername(username);
  for (const key of keys) {
    const raw = await getValue(key);
    if (!raw) continue;
    try {
      const save = JSON.parse(raw);
      const handle = normalizeUsername(save?.xHandle || "");
      if (handle === wanted) return key.slice(SAVE_PREFIX.length);
    } catch {
      /* skip */
    }
  }
  return null;
}

export function findUserIdFromActivityEntries(activityEntries, username) {
  const wanted = normalizeUsername(username);
  const matches = (activityEntries || [])
    .filter((entry) => entry?.xUsername?.toLowerCase() === wanted)
    .sort((a, b) => Date.parse(b.at || "") - Date.parse(a.at || ""));
  const withId = matches.find((entry) => entry?.xUserId);
  return withId?.xUserId ? String(withId.xUserId) : null;
}

export function countActivityForUsername(activityEntries, username) {
  const wanted = normalizeUsername(username);
  return (activityEntries || []).filter((entry) => entry?.xUsername?.toLowerCase() === wanted).length;
}

export async function findSimilarCatchUsernames(listKeys, username, limit = 8) {
  const wanted = normalizeUsername(username);
  if (!wanted) return [];
  const keys = await listKeys(CATCH_USERNAME_PREFIX);
  const similar = [];
  for (const key of keys) {
    const handle = key.slice(CATCH_USERNAME_PREFIX.length);
    if (!handle) continue;
    if (handle.includes(wanted) || wanted.includes(handle)) {
      similar.push(handle);
    }
  }
  similar.sort((a, b) => {
    const aExact = a === wanted ? -1 : 0;
    const bExact = b === wanted ? -1 : 0;
    if (aExact !== bExact) return aExact - bExact;
    return a.localeCompare(b);
  });
  return [...new Set(similar)].slice(0, limit);
}

export async function resolveProductionUser(getValue, listKeys, username, activityEntries = []) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;

  const sources = {};
  const trySource = async (name, fn) => {
    const id = await fn();
    if (id) sources[name] = id;
    return id;
  };

  let xUserId =
    (await trySource("catchUsernameIndex", () => findUserIdFromCatchUsernameIndex(getValue, normalized))) ||
    (await trySource("cloudSave", () => findUserIdFromSaves(getValue, listKeys, normalized))) ||
    (await trySource("session", () => findUserIdFromSessions(getValue, listKeys, normalized))) ||
    (await trySource("legacyState", () => findUserIdFromLegacyState(getValue, normalized))) ||
    null;

  const activityUserId = findUserIdFromActivityEntries(activityEntries, normalized);
  if (activityUserId) {
    sources.activity = activityUserId;
    if (!xUserId) xUserId = activityUserId;
  }

  // Activity log may list the handle before catch-username index exists.
  if (!xUserId && countActivityForUsername(activityEntries, normalized) > 0) {
    const fromCatchIndex = await findUserIdFromCatchUsernameIndex(getValue, normalized);
    if (fromCatchIndex) {
      sources.activityCatchIndex = fromCatchIndex;
      xUserId = fromCatchIndex;
    }
  }

  if (!xUserId) return null;

  const saveRaw = await getValue(`${SAVE_PREFIX}${xUserId}`);
  const catchUserRaw = await getValue(`${CATCH_USER_PREFIX}${xUserId}`);
  let save = null;
  let catchUser = null;
  try {
    if (saveRaw) save = JSON.parse(saveRaw);
  } catch {
    save = null;
  }
  try {
    if (catchUserRaw) catchUser = JSON.parse(catchUserRaw);
  } catch {
    catchUser = null;
  }

  return {
    username: displayUsername(username),
    normalizedUsername: normalized,
    xUserId,
    save,
    catchUser,
    resolvedVia: Object.keys(sources),
    sourceIds: sources,
  };
}
