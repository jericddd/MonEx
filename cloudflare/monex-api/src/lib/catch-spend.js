import { clampMonballs } from "./grant-monballs.js";
import { MIN_MONBALLS } from "./catch-engine.js";

/**
 * Validate catch spend against wallet without mutating (claim model validates at tweet; spend at commit).
 */
export function validateCatchMonballsAvailable(user, spend, walletBalance = null) {
  const amount = Math.floor(Number(spend) || 0);
  const before = clampMonballs(walletBalance ?? user?.monballs ?? 0);
  if (!user || amount < MIN_MONBALLS) {
    return { ok: false, reason: "invalid_spend", before, after: before };
  }
  if (before < amount) {
    return { ok: false, reason: "insufficient", before, after: before, spend: amount };
  }
  return { ok: true, before, after: clampMonballs(before - amount), spend: amount };
}

/**
 * Atomically validate and deduct monballs from a catch-state user row.
 * Caller must hold per-user sync lock and fresh state.
 */
export function trySpendCatchMonballs(user, spend) {
  const amount = Math.floor(Number(spend) || 0);
  if (!user || amount < MIN_MONBALLS) {
    return { ok: false, reason: "invalid_spend", before: clampMonballs(user?.monballs ?? 0), after: clampMonballs(user?.monballs ?? 0) };
  }
  const before = clampMonballs(user.monballs ?? 0);
  if (before < amount) {
    return { ok: false, reason: "insufficient", before, after: before, spend: amount };
  }
  user.monballs = clampMonballs(before - amount);
  user.updatedAt = new Date().toISOString();
  return { ok: true, before, after: user.monballs, spend: amount };
}
