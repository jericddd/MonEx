/** Single active in-game session guard (play/index.html only). */

const GAME_SESSION_STORAGE_KEY = "monex_game_session_id";
const GAME_SESSION_HEADER = "X-Game-Session-Id";
const STATUS_POLL_MS = 5000;
const HEARTBEAT_MS = 15000;

let _gameSessionId = null;
let _active = false;
let _statusTimer = null;
let _heartbeatTimer = null;
let _onInactive = null;
let _onActive = null;
let _guardRunning = false;

function getApiBase() {
  if (typeof getMonexApiBase === "function") return getMonexApiBase();
  if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
  return "https://monex-api.0xjericd.workers.dev";
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

function setActiveState(active) {
  const next = !!active;
  if (_active === next) return;
  _active = next;
  if (_active) {
    if (typeof _onActive === "function") _onActive();
  } else if (typeof _onInactive === "function") {
    _onInactive();
  }
}

async function claimActiveSession() {
  if (!MonExAuth?.isLoggedIn?.()) return { ok: false, error: "not_logged_in" };
  const gameSessionId = getGameSessionId();
  const res = await fetch(`${getApiBase()}/api/game-session/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ gameSessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    setActiveState(false);
    return data;
  }
  setActiveState(!!data.active);
  return data;
}

async function fetchSessionStatus() {
  const gameSessionId = getGameSessionId();
  const url = new URL(`${getApiBase()}/api/game-session/status`);
  url.searchParams.set("gameSessionId", gameSessionId);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, active: false, error: data.error || "status_failed" };
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
  if (!res.ok) return { ok: false, active: false, error: data.error || "heartbeat_failed" };
  if (data.active) {
    setActiveState(true);
    return data;
  }
  if (data.reason === "superseded") {
    setActiveState(false);
    return data;
  }
  if (data.tookOver || data.active) {
    setActiveState(true);
    return data;
  }
  setActiveState(false);
  return data;
}

async function pollSessionStatus() {
  if (!MonExAuth?.isLoggedIn?.()) return;
  try {
    let status = await fetchSessionStatus();
    if (status.active) {
      setActiveState(true);
      return;
    }
    if (status.canReclaim || status.reason === "unclaimed" || status.reason === "stale_other") {
      const claimed = await claimActiveSession();
      if (claimed?.active) return;
      status = await fetchSessionStatus();
    }
    setActiveState(!!status.active);
  } catch (_) {
    /* keep current state on transient network errors */
  }
}

function startSessionGuard(options = {}) {
  if (_guardRunning) return;
  _guardRunning = true;
  _onInactive = options.onInactive || null;
  _onActive = options.onActive || null;
  getGameSessionId();

  const runHeartbeat = () => {
    if (!document.hidden && _active) sendHeartbeat().catch(() => {});
  };
  const runStatus = () => {
    pollSessionStatus().catch(() => {});
  };

  runStatus();
  _statusTimer = setInterval(runStatus, STATUS_POLL_MS);
  _heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pollSessionStatus().catch(() => {});
      if (_active) sendHeartbeat().catch(() => {});
    }
  });

  window.addEventListener("pagehide", () => {
    if (_active) {
      fetch(`${getApiBase()}/api/game-session/release`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ gameSessionId: getGameSessionId() }),
        keepalive: true,
      }).catch(() => {});
      _active = false;
    }
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
  setActiveState(false);
}

function isActive() {
  return _active;
}

function handleInactiveFromApi() {
  setActiveState(false);
  pollSessionStatus().catch(() => {});
}

function ensureGameplayApiAllowed() {
  return _active;
}

window.MonExGameSession = {
  GAME_SESSION_HEADER,
  getGameSessionId,
  claimActiveSession,
  fetchSessionStatus,
  sendHeartbeat,
  pollSessionStatus,
  startSessionGuard,
  stopSessionGuard,
  releaseSession,
  isActive,
  handleInactiveFromApi,
  ensureGameplayApiAllowed,
  authHeaders,
};
