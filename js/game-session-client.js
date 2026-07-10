/** Single active in-game session guard (play/index.html only). */

const GAME_SESSION_STORAGE_KEY = "monex_game_session_id";
const GAME_SESSION_HEADER = "X-Game-Session-Id";
const GAME_SESSION_BROADCAST = "monex-game-session";
const STATUS_POLL_VISIBLE_MS = 1500;
const STATUS_POLL_HIDDEN_MS = 4000;
const HEARTBEAT_MS = 10000;

/** @type {"pending" | "active" | "superseded"} */
let _state = "pending";
let _gameSessionId = null;
let _statusTimer = null;
let _heartbeatTimer = null;
let _onSuperseded = null;
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

function publishSessionTakeover(username, gameSessionId) {
  const payload = {
    type: "claimed",
    gameSessionId,
    username: String(username || getUsername() || "").toLowerCase().replace(/^@/, ""),
    tookOver: true,
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
  if (!payload || payload.type !== "claimed" || !payload.tookOver) return;
  const mine = getGameSessionId();
  if (!mine || payload.gameSessionId === mine) return;
  const user = String(getUsername() || "").toLowerCase().replace(/^@/, "");
  if (payload.username && user && payload.username !== user) return;
  markSuperseded("broadcast");
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
  if (_state === "active") return;
  _state = "active";
  if (typeof _onActive === "function") _onActive();
}

function markSuperseded(reason) {
  if (_state === "superseded") return;
  _state = "superseded";
  if (typeof _onSuperseded === "function") _onSuperseded();
  try {
    console.info("[game-session] superseded:", reason, getGameSessionId());
  } catch (_) {}
}

function applyServerStatus(status) {
  if (!status?.ok) return null;
  if (status.active) {
    if (_state !== "active") {
      _state = "active";
      if (typeof _onActive === "function") _onActive();
    }
    return "active";
  }
  if (status.reason === "superseded") {
    markSuperseded("server");
    return "superseded";
  }
  return status.reason || "inactive";
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
  if (!res.ok || data.ok === false) return data;
  if (data.active) {
    markActive();
    if (data.tookOver) publishSessionTakeover(getUsername(), gameSessionId);
  }
  return data;
}

async function fetchSessionStatus() {
  const gameSessionId = getGameSessionId();
  const url = new URL(`${getApiBase()}/api/game-session/status`);
  url.searchParams.set("gameSessionId", gameSessionId);
  const res = await fetch(url.toString(), { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "status_failed", httpStatus: res.status };
  return data;
}

async function sendHeartbeat() {
  if (_state === "superseded") return { ok: true, active: false, reason: "superseded" };
  const gameSessionId = getGameSessionId();
  const res = await fetch(`${getApiBase()}/api/game-session/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ gameSessionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "heartbeat_failed" };
  applyServerStatus(data);
  if (data.tookOver) publishSessionTakeover(getUsername(), gameSessionId);
  return data;
}

async function pollSessionStatus() {
  if (!MonExAuth?.isLoggedIn?.()) return;
  if (_state === "superseded") return;
  try {
    let status = await fetchSessionStatus();
    if (!status.ok) return;

    if (status.active) {
      if (_state !== "active") {
        _state = "active";
        if (typeof _onActive === "function") _onActive();
      }
      return;
    }

    if (status.reason === "superseded") {
      markSuperseded("poll");
      return;
    }

    if (status.canReclaim || status.reason === "unclaimed" || status.reason === "stale_other") {
      const claimed = await claimActiveSession();
      if (claimed?.active) return;
      status = await fetchSessionStatus();
      if (status.ok && status.active) {
        _state = "active";
        if (typeof _onActive === "function") _onActive();
      } else if (status.ok && status.reason === "superseded") {
        markSuperseded("poll_after_claim");
      }
    }
  } catch (_) {
    /* keep state on transient network errors */
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
  _onSuperseded = options.onSuperseded || options.onInactive || null;
  _onActive = options.onActive || null;
  initCrossTabListeners();
  getGameSessionId();

  if (!_guardRunning) {
    _guardRunning = true;
    const runHeartbeat = () => {
      if (_state !== "superseded") sendHeartbeat().catch(() => {});
    };
    _heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_MS);

    document.addEventListener("visibilitychange", () => {
      scheduleStatusPoll();
      if (document.visibilityState === "visible") {
        pollSessionStatus().catch(() => {});
        if (_state !== "superseded") sendHeartbeat().catch(() => {});
      }
    });
  }

  scheduleStatusPoll();
  pollSessionStatus().catch(() => {});
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
  _state = "pending";
}

function isActive() {
  return _state === "active";
}

function isSuperseded() {
  return _state === "superseded";
}

function hasGameSessionId() {
  return !!getGameSessionId();
}

async function handleInactiveFromApi() {
  const status = await fetchSessionStatus().catch(() => null);
  if (status?.ok && status.active) {
    _state = "active";
    if (typeof _onActive === "function") _onActive();
    return;
  }
  if (status?.ok && status.reason === "superseded") {
    markSuperseded("api");
    return;
  }
  if (status?.ok && status.canReclaim) {
    const claimed = await claimActiveSession();
    if (claimed?.active) return;
  }
  if (status?.ok && status.reason === "superseded") markSuperseded("api");
}

/** Block gameplay only when this tab is confirmed superseded. */
function ensureGameplayApiAllowed() {
  return _state !== "superseded";
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
  isSuperseded,
  hasGameSessionId,
  handleInactiveFromApi,
  ensureGameplayApiAllowed,
  gameplayRequestExtras,
  authHeaders,
  initCrossTabListeners,
};
