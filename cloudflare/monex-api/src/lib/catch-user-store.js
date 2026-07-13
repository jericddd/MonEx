import { safeJsonParse } from "./safe-json.js";
import { resolveCatchUser } from "../kv-store.js";

export const CATCH_USER_PREFIX = "monex:catch-user:";

export function catchUserKey(xUserId) {
  return `${CATCH_USER_PREFIX}${String(xUserId || "").trim()}`;
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
  await kv.put(catchUserKey(uid), JSON.stringify({
    username: user.username,
    monballs: user.monballs,
    pendingMons: user.pendingMons || [],
    updatedAt: user.updatedAt || new Date().toISOString(),
    replyDay: user.replyDay,
    replyCount: user.replyCount,
    limitNoticeDay: user.limitNoticeDay,
  }));
}

/**
 * Prefer per-user KV over monex:state.users — dual-read into in-memory state.
 */
export async function hydrateCatchUserIntoState(kv, state, xUserId, username, startingMonballs = 10) {
  const uid = String(xUserId || "").trim();
  if (!uid) return resolveCatchUser(state, null, username, startingMonballs);

  const record = await loadCatchUserRecord(kv, uid);
  if (record) {
    const user = resolveCatchUser(state, uid, record.username || username, startingMonballs);
    if (user) {
      user.monballs = record.monballs ?? user.monballs;
      user.pendingMons = Array.isArray(record.pendingMons) ? [...record.pendingMons] : (user.pendingMons || []);
      user.updatedAt = record.updatedAt || user.updatedAt;
      if (record.replyDay) user.replyDay = record.replyDay;
      if (record.replyCount != null) user.replyCount = record.replyCount;
      if (record.limitNoticeDay) user.limitNoticeDay = record.limitNoticeDay;
    }
    return user;
  }

  const user = resolveCatchUser(state, uid, username, startingMonballs);
  if (user) await saveCatchUserRecord(kv, uid, user);
  return user;
}

/** Dual-write catch user to per-user KV (and keep state.users in sync). */
export async function persistCatchUserFromState(kv, state, xUserId) {
  const uid = String(xUserId || "").trim();
  if (!uid) return;
  const user = state?.users?.[uid];
  if (!user) return;
  await saveCatchUserRecord(kv, uid, user);
}
