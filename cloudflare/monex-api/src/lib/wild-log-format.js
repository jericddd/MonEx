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

export function resolveMonballsBefore(entry) {
  const recorded = Number(entry?.monballsBefore);
  if (Number.isFinite(recorded)) return recorded;
  const after = Number(entry?.monballsLeft);
  const spend = Math.max(0, Number(entry?.spend) || 0);
  if (Number.isFinite(after)) return after + spend;
  return null;
}

export function describeWildLogBalance(entry) {
  const after = Number(entry?.monballsLeft);
  const before = resolveMonballsBefore(entry);
  if (Number.isFinite(before) && Number.isFinite(after) && before !== after) {
    return `${before} → ${after}`;
  }
  if (Number.isFinite(after)) return String(after);
  return "—";
}
