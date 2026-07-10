/** Authoritative single active in-game session per authenticated user. */

export const GAME_SESSION_HEADER = "X-Game-Session-Id";
export const GAME_SESSION_OPENED_AT_HEADER = "X-Game-Session-Opened-At";
export const GAME_SESSION_STALE_MS = 45_000;
export const GAME_SESSION_TTL_SEC = 60 * 60 * 24 * 30;

const ACTIVE_PREFIX = "monex:active-game-session:";

export function activeGameSessionKey(xUserId) {
  return `${ACTIVE_PREFIX}${String(xUserId || "")}`;
}

export function normalizeSessionOpenedAt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function sessionOpenedAtFromRecord(record) {
  if (!record) return 0;
  const opened = normalizeSessionOpenedAt(record.openedAt);
  if (opened) return opened;
  const claimed = Date.parse(record.claimedAt || "");
  return Number.isFinite(claimed) ? claimed : 0;
}

export function getGameSessionIdFromRequest(request, body = null) {
  const headerId = request?.headers?.get(GAME_SESSION_HEADER);
  const bodyId = body?.gameSessionId;
  if (headerId && bodyId) {
    const h = String(headerId).trim();
    const b = String(bodyId).trim();
    if (h && b && h !== b) return b;
    return h || b;
  }
  if (headerId) return String(headerId).trim();
  if (bodyId) return String(bodyId).trim();
  return null;
}

export function getSessionOpenedAtFromRequest(request, body = null) {
  const headerAt = request?.headers?.get(GAME_SESSION_OPENED_AT_HEADER);
  const bodyAt = body?.sessionOpenedAt;
  const fromHeader = normalizeSessionOpenedAt(headerAt);
  const fromBody = normalizeSessionOpenedAt(bodyAt);
  return Math.max(fromHeader, fromBody);
}

export async function loadActiveGameSession(kv, xUserId) {
  if (!kv || !xUserId) return null;
  const raw = await kv.get(activeGameSessionKey(xUserId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.gameSessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function lastSeenMs(record) {
  const ts = Date.parse(record?.lastSeenAt || record?.claimedAt || "");
  return Number.isFinite(ts) ? ts : 0;
}

export function isGameSessionStale(record, now = Date.now()) {
  if (!record) return true;
  const seen = lastSeenMs(record);
  if (!seen) return true;
  return now - seen >= GAME_SESSION_STALE_MS;
}

export async function writeActiveGameSession(kv, xUserId, record) {
  await kv.put(activeGameSessionKey(xUserId), JSON.stringify(record), {
    expirationTtl: GAME_SESSION_TTL_SEC,
  });
  return record;
}

function supersededByActive(active) {
  return {
    ok: true,
    active: false,
    reason: "superseded",
    activeGameSessionId: active.gameSessionId,
    lastSeenAt: active.lastSeenAt,
    openedAt: sessionOpenedAtFromRecord(active),
  };
}

/**
 * Claim or refresh the active in-game session.
 * A newer tab (higher sessionOpenedAt) displaces a live session; stale responses cannot steal.
 */
export async function claimGameSession(kv, xUserId, gameSessionId, options = {}) {
  const id = String(gameSessionId || "").trim();
  const openedAt = normalizeSessionOpenedAt(options.sessionOpenedAt) || Date.now();
  if (!xUserId || !id) {
    return { ok: false, error: "game_session_id_required" };
  }

  const active = await loadActiveGameSession(kv, xUserId);
  const now = nowIso();

  if (active?.gameSessionId === id) {
    const refreshed = {
      ...active,
      gameSessionId: id,
      lastSeenAt: now,
      openedAt: sessionOpenedAtFromRecord(active) || openedAt,
    };
    await writeActiveGameSession(kv, xUserId, refreshed);
    return {
      ok: true,
      active: true,
      refreshed: true,
      gameSessionId: id,
      lastSeenAt: now,
      openedAt: refreshed.openedAt,
    };
  }

  if (active && !isGameSessionStale(active)) {
    const activeOpenedAt = sessionOpenedAtFromRecord(active);
    if (openedAt <= activeOpenedAt) {
      return supersededByActive(active);
    }
  }

  const record = {
    gameSessionId: id,
    claimedAt: now,
    lastSeenAt: now,
    openedAt,
  };
  await writeActiveGameSession(kv, xUserId, record);
  return {
    ok: true,
    active: true,
    tookOver: !!active,
    gameSessionId: id,
    claimedAt: now,
    lastSeenAt: now,
    openedAt,
  };
}

export async function heartbeatGameSession(kv, xUserId, gameSessionId, options = {}) {
  const id = String(gameSessionId || "").trim();
  const openedAt = normalizeSessionOpenedAt(options.sessionOpenedAt) || Date.now();
  if (!xUserId || !id) {
    return { ok: false, error: "game_session_id_required" };
  }

  const active = await loadActiveGameSession(kv, xUserId);
  if (!active) {
    return claimGameSession(kv, xUserId, id, { sessionOpenedAt: openedAt });
  }
  if (active.gameSessionId === id) {
    const now = nowIso();
    const refreshed = { ...active, lastSeenAt: now };
    await writeActiveGameSession(kv, xUserId, refreshed);
    return { ok: true, active: true, gameSessionId: id, lastSeenAt: now, openedAt: sessionOpenedAtFromRecord(refreshed) };
  }
  if (isGameSessionStale(active)) {
    return claimGameSession(kv, xUserId, id, { sessionOpenedAt: openedAt });
  }
  return supersededByActive(active);
}

export async function getGameSessionStatus(kv, xUserId, gameSessionId, options = {}) {
  const id = String(gameSessionId || "").trim();
  const openedAt = normalizeSessionOpenedAt(options.sessionOpenedAt);
  if (!xUserId || !id) {
    return { ok: false, error: "game_session_id_required" };
  }

  const active = await loadActiveGameSession(kv, xUserId);
  if (!active) {
    return { ok: true, active: false, reason: "unclaimed", canReclaim: true };
  }
  if (active.gameSessionId === id) {
    return {
      ok: true,
      active: true,
      gameSessionId: id,
      lastSeenAt: active.lastSeenAt,
      claimedAt: active.claimedAt,
      openedAt: sessionOpenedAtFromRecord(active),
    };
  }
  if (isGameSessionStale(active)) {
    return {
      ok: true,
      active: false,
      reason: "stale_other",
      canReclaim: true,
      activeGameSessionId: active.gameSessionId,
      lastSeenAt: active.lastSeenAt,
      openedAt: sessionOpenedAtFromRecord(active),
    };
  }
  return {
    ...supersededByActive(active),
    canReclaim: false,
  };
}

export async function releaseGameSession(kv, xUserId, gameSessionId) {
  const id = String(gameSessionId || "").trim();
  if (!xUserId || !id) return { ok: true, released: false };
  const active = await loadActiveGameSession(kv, xUserId);
  if (active?.gameSessionId === id) {
    await kv.delete(activeGameSessionKey(xUserId));
    return { ok: true, released: true };
  }
  return { ok: true, released: false };
}

export async function requireGameplaySession(request, kv, session, body = null) {
  const gameSessionId = getGameSessionIdFromRequest(request, body);
  if (!gameSessionId) {
    return { ok: false, status: 403, error: "game_session_required" };
  }

  const sessionOpenedAt = getSessionOpenedAtFromRequest(request, body);
  const statusOpts = sessionOpenedAt ? { sessionOpenedAt } : {};
  let status = await getGameSessionStatus(kv, session.xUserId, gameSessionId, statusOpts);
  if (!status.ok) {
    return { ok: false, status: 400, error: status.error || "game_session_invalid" };
  }

  // Only auto-claim when no session record exists. Never reclaim stale/superseded via gameplay.
  if (!status.active && status.reason === "unclaimed") {
    await claimGameSession(kv, session.xUserId, gameSessionId, {
      sessionOpenedAt: sessionOpenedAt || Date.now(),
    });
    status = await getGameSessionStatus(kv, session.xUserId, gameSessionId, statusOpts);
  }

  if (!status.active) {
    return {
      ok: false,
      status: 403,
      error: "game_session_inactive",
      reason: status.reason,
      canReclaim: !!status.canReclaim,
    };
  }
  return { ok: true, gameSessionId };
}
