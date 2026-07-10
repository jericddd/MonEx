/** Authoritative single active in-game session per authenticated user. */

export const GAME_SESSION_HEADER = "X-Game-Session-Id";
export const GAME_SESSION_STALE_MS = 45_000;
export const GAME_SESSION_TTL_SEC = 60 * 60 * 24 * 30;

const ACTIVE_PREFIX = "monex:active-game-session:";

export function activeGameSessionKey(xUserId) {
  return `${ACTIVE_PREFIX}${String(xUserId || "")}`;
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

/**
 * Claim or refresh the active in-game session. A different gameSessionId always wins.
 */
export async function claimGameSession(kv, xUserId, gameSessionId) {
  const id = String(gameSessionId || "").trim();
  if (!xUserId || !id) {
    return { ok: false, error: "game_session_id_required" };
  }

  const active = await loadActiveGameSession(kv, xUserId);
  const now = nowIso();
  if (active?.gameSessionId === id) {
    const refreshed = { ...active, gameSessionId: id, lastSeenAt: now };
    await writeActiveGameSession(kv, xUserId, refreshed);
    return { ok: true, active: true, refreshed: true, gameSessionId: id, lastSeenAt: now };
  }

  const record = { gameSessionId: id, claimedAt: now, lastSeenAt: now };
  await writeActiveGameSession(kv, xUserId, record);
  return { ok: true, active: true, tookOver: true, gameSessionId: id, claimedAt: now, lastSeenAt: now };
}

export async function heartbeatGameSession(kv, xUserId, gameSessionId) {
  const id = String(gameSessionId || "").trim();
  if (!xUserId || !id) {
    return { ok: false, error: "game_session_id_required" };
  }

  const active = await loadActiveGameSession(kv, xUserId);
  if (!active) {
    return claimGameSession(kv, xUserId, id);
  }
  if (active.gameSessionId === id) {
    const now = nowIso();
    const refreshed = { ...active, lastSeenAt: now };
    await writeActiveGameSession(kv, xUserId, refreshed);
    return { ok: true, active: true, gameSessionId: id, lastSeenAt: now };
  }
  if (isGameSessionStale(active)) {
    return claimGameSession(kv, xUserId, id);
  }
  return {
    ok: true,
    active: false,
    reason: "superseded",
    activeGameSessionId: active.gameSessionId,
    lastSeenAt: active.lastSeenAt,
  };
}

export async function getGameSessionStatus(kv, xUserId, gameSessionId) {
  const id = String(gameSessionId || "").trim();
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
    };
  }
  return {
    ok: true,
    active: false,
    reason: "superseded",
    canReclaim: false,
    activeGameSessionId: active.gameSessionId,
    lastSeenAt: active.lastSeenAt,
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

  let status = await getGameSessionStatus(kv, session.xUserId, gameSessionId);
  if (!status.ok) {
    return { ok: false, status: 400, error: status.error || "game_session_invalid" };
  }

  if (!status.active && status.canReclaim) {
    await claimGameSession(kv, session.xUserId, gameSessionId);
    status = await getGameSessionStatus(kv, session.xUserId, gameSessionId);
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
