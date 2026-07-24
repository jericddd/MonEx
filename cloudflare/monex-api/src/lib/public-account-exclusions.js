/**
 * Accounts hidden from public live surfaces (leaderboards, X Wild Log, future arena boards).
 * They may still play and use personal /mine APIs — they just must not appear mixed with real players.
 */

export const PUBLIC_HIDDEN_USERNAMES = Object.freeze([
  "test",
  "yesdraken_", // legacy wild-log hide
]);

const HIDDEN = new Set(PUBLIC_HIDDEN_USERNAMES);

export function normalizePublicUsername(raw) {
  return String(raw || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();
}

export function isPublicHiddenUsername(raw) {
  const u = normalizePublicUsername(raw);
  return !!u && HIDDEN.has(u);
}
