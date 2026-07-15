import { LIMITS, utcDayIndex } from "../../shared/rules.js";

const WALLET_PREFIX = "wallet:";
const COOLDOWN_PREFIX = "cooldown:";
const MINTS_DAY_PREFIX = "mints:";

export function walletKey(xUserId) {
  return `${WALLET_PREFIX}${String(xUserId)}`;
}

export function cooldownKey(xUserId) {
  return `${COOLDOWN_PREFIX}${String(xUserId)}`;
}

export function mintsDayKey(xUserId, dayIndex) {
  return `${MINTS_DAY_PREFIX}${String(xUserId)}:${dayIndex}`;
}

export async function getLinkedWallet(kv, xUserId) {
  if (!kv || !xUserId) return null;
  const wallet = await kv.get(walletKey(xUserId));
  return wallet || null;
}

export async function linkWallet(kv, xUserId, wallet) {
  if (!kv || !xUserId || !wallet) return { ok: false, reason: "invalid" };
  const key = walletKey(xUserId);
  const existing = await kv.get(key);
  if (existing) {
    return existing === wallet ? { ok: true, wallet, alreadyLinked: true } : { ok: false, reason: "already_linked" };
  }
  await kv.put(key, wallet);
  return { ok: true, wallet };
}

export async function getMintCooldownRemainingMs(kv, xUserId, nowMs = Date.now()) {
  if (!kv || !xUserId) return 0;
  const raw = await kv.get(cooldownKey(xUserId));
  if (!raw) return 0;
  const until = Number(raw);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - nowMs);
}

export async function setMintCooldown(kv, xUserId, nowMs = Date.now()) {
  if (!kv || !xUserId) return;
  const until = nowMs + LIMITS.MINT_COOLDOWN_MS;
  await kv.put(cooldownKey(xUserId), String(until), {
    expirationTtl: Math.ceil(LIMITS.MINT_COOLDOWN_MS / 1000) + 60,
  });
}

export async function getMintsToday(kv, xUserId, nowMs = Date.now()) {
  if (!kv || !xUserId) return 0;
  const day = utcDayIndex(nowMs);
  const raw = await kv.get(mintsDayKey(xUserId, day));
  return Math.max(0, Math.floor(Number(raw) || 0));
}

export async function incrementMintsToday(kv, xUserId, nowMs = Date.now()) {
  if (!kv || !xUserId) return 0;
  const day = utcDayIndex(nowMs);
  const key = mintsDayKey(xUserId, day);
  const current = await getMintsToday(kv, xUserId, nowMs);
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: 60 * 60 * 48 });
  return next;
}
