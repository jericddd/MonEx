/** Pure helpers for X Wild Log display — keep in sync with js/activity-client.js */

export function describeWildLogCatch(entry) {
  const spend = Math.max(0, Number(entry?.spend) || 0);
  const caught = Math.max(0, Number(entry?.caughtCount) || 0);
  const throws = Math.max(0, Number(entry?.throws) || spend || 0);
  const escaped = Math.max(0, Number(entry?.escapedCount) || Math.max(0, throws - caught));

  if (throws <= 1) return caught === 0 ? "0 caught" : "1 caught";
  if (caught === throws) return `${caught} caught`;
  const escapedPart = escaped ? ` (${escaped} escaped)` : "";
  return spend ? `${spend} Monballs · ${caught}/${throws} caught${escapedPart}` : `${caught}/${throws} caught${escapedPart}`;
}

export function describeWildLogBalance(entry) {
  const after = Number(entry?.monballsLeft);
  if (Number.isFinite(after)) return String(after);
  return "—";
}
