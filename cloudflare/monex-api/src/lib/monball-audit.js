const AUDIT_PREFIX = "monex:monball-audit:";
const MAX_ENTRIES = 100;

export function monballAuditKey(xUserId) {
  return `${AUDIT_PREFIX}${String(xUserId || "")}`;
}

/**
 * Append a monball balance change to the per-user audit log (KV) and Workers console.
 */
export async function appendMonballAudit(kv, entry) {
  if (!kv || !entry?.xUserId) return null;

  const payload = {
    xUserId: String(entry.xUserId),
    username: entry.username
      ? String(entry.username).toLowerCase().replace(/^@/, "").trim()
      : undefined,
    source: String(entry.source || "unknown"),
    delta: Math.floor(Number(entry.delta) || 0),
    balanceAfter: Math.max(0, Math.floor(Number(entry.balanceAfter) || 0)),
    at: entry.at || new Date().toISOString(),
    ...(entry.balanceBefore != null
      ? { balanceBefore: Math.max(0, Math.floor(Number(entry.balanceBefore) || 0)) }
      : {}),
    ...(entry.meta && typeof entry.meta === "object" ? { meta: entry.meta } : {}),
  };
  if (payload.balanceBefore == null && Number.isFinite(payload.delta) && Number.isFinite(payload.balanceAfter)) {
    payload.balanceBefore = Math.max(0, payload.balanceAfter - payload.delta);
  }

  console.info("[monball-audit]", JSON.stringify(payload));

  const key = monballAuditKey(entry.xUserId);
  let list = [];
  const raw = await kv.get(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }

  list.unshift(payload);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  await kv.put(key, JSON.stringify(list));
  return payload;
}

export async function listMonballAudit(kv, xUserId, limit = 50) {
  if (!kv || !xUserId) return [];
  const raw = await kv.get(monballAuditKey(xUserId));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, Math.max(1, limit)) : [];
  } catch {
    return [];
  }
}
