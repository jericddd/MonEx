const REPLY_PREFIX = "monex:reply:";
const NOTICE_PREFIX = "monex:reply-notice:";
const REPLY_TTL_SECONDS = 60 * 60 * 48;

export function replyCountKey(xUserId, day) {
  return `${REPLY_PREFIX}${String(xUserId)}:${day}`;
}

export function replyNoticeKey(xUserId, day) {
  return `${NOTICE_PREFIX}${String(xUserId)}:${day}`;
}

export function todayUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

function parseCount(raw) {
  const n = Number.parseInt(raw || "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Seed KV counter from legacy monex:state user row (one-time migration). */
export async function seedReplyCountFromUser(kv, xUserId, user) {
  if (!kv || !xUserId || !user) return 0;
  const day = todayUtcDay();
  if (user.replyDay !== day) return 0;
  const legacy = parseCount(user.replyCount);
  if (legacy <= 0) return 0;

  const key = replyCountKey(xUserId, day);
  const existing = parseCount(await kv.get(key));
  if (existing >= legacy) return existing;

  await kv.put(key, String(legacy), { expirationTtl: REPLY_TTL_SECONDS });
  return legacy;
}

export async function getReplyCountToday(kv, xUserId, user = null) {
  if (!kv || !xUserId) return 0;
  const day = todayUtcDay();
  const key = replyCountKey(xUserId, day);
  const raw = await kv.get(key);
  if (raw != null) return parseCount(raw);
  return seedReplyCountFromUser(kv, xUserId, user);
}

export async function canSendReply(kv, xUserId, limit = 4, user = null) {
  if (!xUserId || limit <= 0) return false;
  const count = await getReplyCountToday(kv, xUserId, user);
  return count < limit;
}

export async function recordReplySent(kv, xUserId, user = null) {
  if (!kv || !xUserId) return 0;
  const day = todayUtcDay();
  const key = replyCountKey(xUserId, day);
  const prev = await getReplyCountToday(kv, xUserId, user);
  const next = prev + 1;
  await kv.put(key, String(next), { expirationTtl: REPLY_TTL_SECONDS });
  return next;
}

export async function wasLimitNoticeSentToday(kv, xUserId, user = null) {
  if (!kv || !xUserId) return false;
  const day = todayUtcDay();
  const key = replyNoticeKey(xUserId, day);
  if (await kv.get(key)) return true;
  return user?.limitNoticeDay === day;
}

export async function markLimitNoticeSent(kv, xUserId) {
  if (!kv || !xUserId) return;
  const day = todayUtcDay();
  await kv.put(replyNoticeKey(xUserId, day), "1", { expirationTtl: REPLY_TTL_SECONDS });
}
