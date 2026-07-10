/** Single active in-game session guard (play/index.html only). */

const GAME_SESSION_STORAGE_KEY = "monex_game_session_id";
const GAME_SESSION_HEADER = "X-Game-Session-Id";
const GAME_SESSION_BROADCAST = "monex-game-session";
const STATUS_POLL_VISIBLE_MS = 2000;
const STATUS_POLL_HIDDEN_MS = 8000;
const HEARTBEAT_MS = 12000;

let _gameSessionId = null;
let _active = false;
let _statusTimer = null;
let _heartbeatTimer = null;
let _onInactive = null;
let _onActive = null;
let _guardRunning = false;
let _broadcast = null;

function getApiBase() {
  if (typeof getMonexApiBase === "function") return getMonexApiBase();
  if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
  return "https://monex-api.0xjericd.workers.dev";
}

function getUsername() {
  if (typeof MonExAuth !== "undefined" && MonExAuth.getUsername) {
    return MonExAuth.getUsername() || "";
  }
  try {
    const raw = localStorage.getItem("monex_user");
    return raw ? JSON.parse(raw)?.username || "" : "";
  } catch {
    return "";
  }
}

function createGameSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `gs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getGameSessionId() {
  if (_gameSessionId) return _gameSessionId;
  try {
    const existing = sessionStorage.getItem(GAME_SESSION_STORAGE_KEY);
    if (existing) {
      _gameSessionId = existing;
      return _gameSessionId;
    }
    _gameSessionId = createGameSessionId();
    sessionStorage.setItem(GAME_SESSION_STORAGE_KEY, _gameSessionId);
    return _gameSessionId;
  } catch {
    _gameSessionId = createGameSessionId();
    return _gameSessionId;
  }
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (typeof MonExAuth !== "undefined" && MonExAuth.authHeaders) {
    Object.assign(headers, MonExAuth.authHeaders());
  } else {
    const token = localStorage.getItem("monex_session_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const id = getGameSessionId();
  if (id) headers[GAME_SESSION_HEADER] = id;
  return headers;
}

function localSignalKey(username) {
  const user = String(username || getUsername() || "").toLowerCase().replace(/^@/, "");
  return user ? `monex_gs_active_${user}` : "monex_gs_active";
}

function publishSessionClaim(username, gameSessionId, tookOver = false) {
  const payload = {
    type: "claimed",
    gameSessionId,
    username: String(username || getUsername() || "").toLowerCase().replace(/^@/, ""),
    tookOver: !!tookOver,
    at: Date.now(),
  };
  try {
    _broadcast?.postMessage(payload);
  } catch (_) {}
  try {
    localStorage.setItem(localSignalKey(payload.username), JSON.stringify(payload));
  } catch (_) {}
}

function onForeignSessionClaim(payload) {
  if (!payload || payload.type !== "claimed") return;
  const mine = getGameSessionId();
  if (!mine || payload.gameSessionId === mine) return;
  const user = String(getUsername() || "").toLowerCase().replace(/^@/, "");
  if (payload.username && user && payload.username !== user) return;
  markInactive("superseded");
}

function initCrossTabListeners() {
  if (typeof BroadcastChannel !== "undefined" && !_broadcast) {
    _broadcast = new BroadcastChannel(GAME_SESSION_BROADCAST);
    _broadcast.addEventListener("message", (event) => onForeignSessionClaim(event.data));
  }
  if (!initCrossTabListeners._storageBound) {
    initCrossTabListeners._storageBound = true;
    window.addEventListener("storage", (event) => {
      if (!event.key || !event.key.startsWith("monex_gs_active_")) return;
      if (!event.newValue) return;
      try {
        onForeignSessionClaim(JSON.parse(event.newValue));
      } catch (_) {}
    });
  }
}

function markActive() {
  const wasActive = _active;
  _active = true;
  if (!wasActive && typeof _onActive === "function") _onActive();
}

function markInactive(reason) {
  _active = false;
  if (typeof _onInactive === "function") _onInactive();
  if (reason) {
    try {
      console.info("[game-session] inactive:", reason, getGameSessionId());
    } catch (_) {}
  }
}

function setActiveState(active, reason) {
  if (active) markActive();
  else markInactive(reason);
}

async function claimActiveSession() {
  if (!MonExAuth?.isLoggedIn?.()) return { ok: false, error: "not_logged_in" };
  initCrossTabListeners();
  const gameSessionId = getGameSessionId();
  const res = await fetch(`${getApiBase()}/api/game-session/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ gameSessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    markInactive("claim_failed");
    return data;
  }
  if (data.active) {
    markActive();
    if (data.tookOver) publishSessionClaim(getUsername(), gameSessionId, true);
  } else {
    markInactive("claim_rejected");
  }
  return data;
}

async function fetchSessionStatus() {
  const gameSessionId = getGameSessionId();
  const url = new URL(`${getApiBase()}/api/game-session/status`);
  url.searchParams.set("gameSessionId", gameSessionId);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || "status_failed", httpStatus: res.status };
  }
  return data;
}

async function sendHeartbeat() {
  const gameSessionId = getGameSessionId();
  const res = await fetch(`${getApiBase()}/api/game-session/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ gameSessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "heartbeat_failed" };
  if (data.active) {
    markActive();
    return data;
  }
  if (data.reason === "superseded") {
    markInactive("superseded");
    return data;
  }
  if (data.tookOver) {
    markActive();
    publishSessionClaim(getUsername(), gameSessionId, true);
    return data;
  }
  markInactive(data.reason || "heartbeat_inactive");
  return data;
}

async function pollSessionStatus() {
  if (!MonExAuth?.isLoggedIn?.()) return;
  try {
    const status = await fetchSessionStatus();
    if (!status.ok) return;

    if (status.active) {
      markActive();
      return;
    }

    if (status.reason === "superseded") {
      markInactive("superseded");
      return;
    }

    if (status.canReclaim || status.reason === "unclaimed" || status.reason === "stale_other") {
      const claimed = await claimActiveSession();
      if (claimed?.active) return;
      const again = await fetchSessionStatus();
      if (again.ok && again.active) markActive();
      else if (again.ok && again.reason === "superseded") markInactive("superseded");
      return;
    }

    markInactive(status.reason || "inactive");
  } catch (_) {
    /* keep current state on transient network errors */
  }
}

function scheduleStatusPoll() {
  if (_statusTimer) clearInterval(_statusTimer);
  const ms = document.hidden ? STATUS_POLL_HIDDEN_MS : STATUS_POLL_VISIBLE_MS;
  _statusTimer = setInterval(() => {
    pollSessionStatus().catch(() => {});
  }, ms);
}

function startSessionGuard(options = {}) {
  if (_guardRunning) {
    _onInactive = options.onInactive || _onInactive;
    _onActive = options.onActive || _onActive;
    return;
  }
  _guardRunning = true;
  _onInactive = options.onInactive || null;
  _onActive = options.onActive || null;
  initCrossTabListeners();
  getGameSessionId();

  const runHeartbeat = () => {
    if (_active) sendHeartbeat().catch(() => {});
  };

  pollSessionStatus().catch(() => {});
  scheduleStatusPoll();
  _heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_MS);

  document.addEventListener("visibilitychange", () => {
    scheduleStatusPoll();
    if (document.visibilityState === "visible") {
      pollSessionStatus().catch(() => {});
      if (_active) sendHeartbeat().catch(() => {});
    }
  });

  window.addEventListener("pagehide", () => {
    if (!_active) return;
    const gameSessionId = getGameSessionId();
    fetch(`${getApiBase()}/api/game-session/release`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ gameSessionId }),
      keepalive: true,
    }).catch(() => {});
    _active = false;
  });
}

function stopSessionGuard() {
  _guardRunning = false;
  if (_statusTimer) clearInterval(_statusTimer);
  if (_heartbeatTimer) clearInterval(_heartbeatTimer);
  _statusTimer = null;
  _heartbeatTimer = null;
}

async function releaseSession() {
  if (!MonExAuth?.isLoggedIn?.()) return;
  try {
    await fetch(`${getApiBase()}/api/game-session/release`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ gameSessionId: getGameSessionId() }),
      keepalive: true,
    });
  } catch (_) {}
  stopSessionGuard();
  markInactive("released");
}

function isActive() {
  return _active;
}

function hasGameSessionId() {
  return !!getGameSessionId();
}

function handleInactiveFromApi() {
  markInactive("api_rejected");
  pollSessionStatus().catch(() => {});
}

/** True when this tab may call gameplay APIs (has session id and is active). */
function ensureGameplayApiAllowed() {
  return _active && hasGameSessionId();
}

function gameplayRequestExtras() {
  const gameSessionId = getGameSessionId();
  return gameSessionId ? { gameSessionId } : {};
}

window.MonExGameSession = {
  GAME_SESSION_HEADER,
  GAME_SESSION_STORAGE_KEY,
  getGameSessionId,
  claimActiveSession,
  fetchSessionStatus,
  sendHeartbeat,
  pollSessionStatus,
  startSessionGuard,
  stopSessionGuard,
  releaseSession,
  isActive,
  hasGameSessionId,
  handleInactiveFromApi,
  ensureGameplayApiAllowed,
  gameplayRequestExtras,
  authHeaders,
};
