export const DEFAULT_DAILY_REPLY_LIMIT = 4;

export function parseReplyLimitOverrides(env) {
  const raw = env?.REPLY_LIMIT_OVERRIDES || "";
  const map = new Map();
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const colon = piece.indexOf(":");
    if (colon <= 0) continue;
    const user = piece.slice(0, colon).trim().toLowerCase().replace("@", "");
    const limit = Number.parseInt(piece.slice(colon + 1).trim(), 10);
    if (user && Number.isFinite(limit) && limit > 0) map.set(user, limit);
  }
  return map;
}

export function getDailyReplyLimitForUser(username, env) {
  const defaultLimit = Math.max(
    1,
    Number.parseInt(env?.DAILY_REPLY_LIMIT || String(DEFAULT_DAILY_REPLY_LIMIT), 10)
  );
  const key = (username || "").toLowerCase().replace("@", "");
  const overrides = parseReplyLimitOverrides(env);
  return overrides.get(key) ?? defaultLimit;
}
