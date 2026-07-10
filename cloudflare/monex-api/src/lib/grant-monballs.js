import { loadState, saveState, resolveCatchUser } from "../kv-store.js";
import { loadCloudSave, writeCloudSave } from "./save.js";

const SAVE_PREFIX = "monex:save:";
const SESSION_PREFIX = "monex:session:";
const MONBALL_MAX = 9999;

export function normalizeUsername(username) {
  return String(username || "").toLowerCase().replace(/^@/, "").trim();
}

export function clampMonballs(n) {
  return Math.max(0, Math.min(MONBALL_MAX, Math.floor(Number(n) || 0)));
}

export async function creditCatchMonballs(kv, session, delta, startingMonballs = 10) {
  const amount = clampMonballs(delta);
  if (!amount || !session?.xUserId) return null;
  const state = await loadState(kv);
  const user = resolveCatchUser(state, session.xUserId, session.username, startingMonballs);
  if (!user) return null;
  user.monballs = clampMonballs((user.monballs ?? 0) + amount);
  user.updatedAt = new Date().toISOString();
  await saveState(kv, state);
  return user.monballs;
}

export function mergeMonballBalances(catchMonballs, saveMonballs) {
  return clampMonballs(Math.max(clampMonballs(catchMonballs), clampMonballs(saveMonballs)));
}

export async function alignCatchMonballsToMerged(kv, session, mergedMonballs, startingMonballs = 10) {
  const target = clampMonballs(mergedMonballs);
  if (!session?.xUserId) return target;
  const state = await loadState(kv);
  const user = resolveCatchUser(state, session.xUserId, session.username, startingMonballs);
  if (!user) return target;
  const current = clampMonballs(user.monballs ?? 0);
  if (current !== target) {
    user.monballs = target;
    user.updatedAt = new Date().toISOString();
    await saveState(kv, state);
  }
  return target;
}

export function findUserIdInState(state, username) {
  for (const [xUserId, user] of Object.entries(state?.users || {})) {
    if (user?.username?.toLowerCase() === username) return xUserId;
  }
  return null;
}

async function findUserIdFromSessions(kv, username) {
  let cursor;
  do {
    const page = await kv.list({ prefix: SESSION_PREFIX, cursor, limit: 1000 });
    for (const { name } of page.keys || []) {
      const raw = await kv.get(name);
      if (!raw) continue;
      try {
        const session = JSON.parse(raw);
        if (session?.username?.toLowerCase() === username && session?.xUserId) {
          return session.xUserId;
        }
      } catch {
        /* skip */
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return null;
}

async function findUserIdFromSaves(kv, username) {
  let cursor;
  do {
    const page = await kv.list({ prefix: SAVE_PREFIX, cursor, limit: 1000 });
    for (const { name } of page.keys || []) {
      const raw = await kv.get(name);
      if (!raw) continue;
      try {
        const save = JSON.parse(raw);
        const handle = normalizeUsername(save?.xHandle);
        if (handle === username) return name.slice(SAVE_PREFIX.length);
      } catch {
        /* skip */
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return null;
}

export async function grantMonballs(kv, username, amount, startingMonballs = 10) {
  const target = normalizeUsername(username);
  const grant = clampMonballs(amount);
  if (!target || !grant) {
    throw new Error("username and positive amount required");
  }

  const state = await loadState(kv);
  let xUserId = findUserIdInState(state, target);
  if (!xUserId) xUserId = await findUserIdFromSessions(kv, target);
  if (!xUserId) xUserId = await findUserIdFromSaves(kv, target);
  if (!xUserId) throw new Error(`user @${target} not found`);

  let catchBefore = 0;
  let catchAfter = 0;
  if (!state.users[xUserId]) {
    catchAfter = clampMonballs(startingMonballs + grant);
    state.users[xUserId] = {
      username: target,
      monballs: catchAfter,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    };
  } else {
    catchBefore = clampMonballs(state.users[xUserId].monballs ?? 0);
    catchAfter = clampMonballs(catchBefore + grant);
    state.users[xUserId].monballs = catchAfter;
    state.users[xUserId].username = target;
    state.users[xUserId].updatedAt = new Date().toISOString();
  }
  await saveState(kv, state);

  const { found, save } = await loadCloudSave(kv, xUserId);
  const saveBefore = clampMonballs(save.monballs ?? 0);
  const saveAfter = clampMonballs(saveBefore + grant);
  const nextSave = {
    ...save,
    monballs: saveAfter,
    xHandle: save.xHandle || target,
    updatedAt: new Date().toISOString(),
  };
  await writeCloudSave(kv, xUserId, nextSave, { skipStaleCheck: true });

  return {
    ok: true,
    username: target,
    xUserId,
    amount: grant,
    catchApi: { before: catchBefore, after: catchAfter },
    cloudSave: { found, before: saveBefore, after: saveAfter },
  };
}
