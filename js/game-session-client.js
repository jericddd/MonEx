/**
 * Single active in-game session guard (play/index.html only).
 *
 * IMPORTANT: wrapped in an IIFE. Classic <script> tags share one global
 * lexical scope, and top-level const collisions with other scripts cause a
 * parse-time SyntaxError that silently kills the whole file (this exact bug
 * disabled session enforcement in production). Never declare top-level
 * const/let in this file outside the IIFE.
 */
(() => {
"use strict";

const GAME_SESSION_STORAGE_KEY = "monex_game_session_id";
const GAME_SESSION_OPENED_AT_KEY = "monex_game_session_opened_at";
const GAME_SESSION_HEADER = "X-Game-Session-Id";
const GAME_SESSION_OPENED_AT_HEADER = "X-Game-Session-Opened-At";
const GAME_SESSION_BROADCAST = "monex-game-session";
const STATUS_POLL_VISIBLE_MS = 1500;
const STATUS_POLL_HIDDEN_MS = 4000;
const HEARTBEAT_MS = 10000;
const TAB_LOCK_PREFIX = "monex_gs_tab_lock_";
const TAB_LOCK_FRESH_MS = 5000;
const TAB_LOCK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OWNER_PING_WAIT_MS = 350;

/** @type {"pending" | "active" | "superseded"} */
let _state = "pending";
let _gameSessionId = null;
let _sessionOpenedAt = null;
let _statusTimer = null;
let _heartbeatTimer = null;
let _onSuperseded = null;
let _onActive = null;
let _guardRunning = false;
let _broadcast = null;
let _fetchPatched = false;
let _clickBlocker = null;
let _apiUnavailable = false;
let _ensureUniquePromise = null;
let _lockEstablished = false;
const _sentPingNonces = new Set();

function debugLog(event, detail) {
  try {
    console.info("[monex-session]", event, {
      state: _state,
      gameSessionId: _gameSessionId,
      ...detail,
    });
  } catch (_) {}
}

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

function getSessionOpenedAt() {
  if (_sessionOpenedAt) return _sessionOpenedAt;
  try {
    const existing = sessionStorage.getItem(GAME_SESSION_OPENED_AT_KEY);
    if (existing) {
      const n = Number(existing);
      if (Number.isFinite(n) && n > 0) {
        _sessionOpenedAt = Math.floor(n);
        return _sessionOpenedAt;
      }
    }
    _sessionOpenedAt = Date.now();
    sessionStorage.setItem(GAME_SESSION_OPENED_AT_KEY, String(_sessionOpenedAt));
    return _sessionOpenedAt;
  } catch {
    _sessionOpenedAt = Date.now();
    return _sessionOpenedAt;
  }
}

function getGameSessionId() {
  if (_gameSessionId) return _gameSessionId;
  try {
    const existing = sessionStorage.getItem(GAME_SESSION_STORAGE_KEY);
    if (existing) {
      _gameSessionId = existing;
      getSessionOpenedAt();
      return _gameSessionId;
    }
    _gameSessionId = createGameSessionId();
    sessionStorage.setItem(GAME_SESSION_STORAGE_KEY, _gameSessionId);
    getSessionOpenedAt();
    return _gameSessionId;
  } catch {
    _gameSessionId = createGameSessionId();
    getSessionOpenedAt();
    return _gameSessionId;
  }
}

function sessionPayload() {
  return {
    gameSessionId: getGameSessionId(),
    sessionOpenedAt: getSessionOpenedAt(),
  };
}

// ---- Duplicate-tab detection ----
// Duplicating a tab copies sessionStorage, so the duplicate inherits the
// original's game session ID and both tabs would look like ONE session to the
// server. Each live tab therefore maintains an ownership lock for its ID in
// localStorage (heartbeat + released-on-pagehide) and answers BroadcastChannel
// owner pings. At boot, if the stored ID is still owned by a living tab, the
// new tab mints a fresh ID (with a newer openedAt) and takes over.

function tabLockKey(id) {
  return TAB_LOCK_PREFIX + id;
}

function writeTabLockRaw(released) {
  if (!_gameSessionId) return;
  try {
    localStorage.setItem(
      tabLockKey(_gameSessionId),
      JSON.stringify({ ts: Date.now(), released: !!released })
    );
  } catch (_) {}
}

/**
 * Refresh this tab's ownership lock. No-op until ensureUniqueGameSessionId
 * has decided which ID this tab owns — otherwise a boot-time lock write with
 * the inherited (copied) ID would make a plain refresh look like a duplicate.
 */
function writeTabLock(released) {
  if (!_lockEstablished) return;
  writeTabLockRaw(released);
}

function establishTabLock() {
  _lockEstablished = true;
  writeTabLockRaw(false);
}

function readTabLock(id) {
  try {
    const raw = localStorage.getItem(tabLockKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cleanupStaleTabLocks() {
  try {
    const now = Date.now();
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(TAB_LOCK_PREFIX)) continue;
      try {
        const lock = JSON.parse(localStorage.getItem(key));
        if (!lock || !Number.isFinite(lock.ts) || now - lock.ts > TAB_LOCK_MAX_AGE_MS) {
          stale.push(key);
        }
      } catch {
        stale.push(key);
      }
    }
    stale.forEach((key) => localStorage.removeItem(key));
  } catch (_) {}
}

function mintNewGameSession(reason) {
  _gameSessionId = createGameSessionId();
  _sessionOpenedAt = Date.now();
  try {
    sessionStorage.setItem(GAME_SESSION_STORAGE_KEY, _gameSessionId);
    sessionStorage.setItem(GAME_SESSION_OPENED_AT_KEY, String(_sessionOpenedAt));
  } catch (_) {}
  establishTabLock();
  debugLog("minted_new_session", { reason });
  return _gameSessionId;
}

function pingForOwner(gameSessionId, timeoutMs) {
  return new Promise((resolve) => {
    if (typeof BroadcastChannel === "undefined") {
      resolve(false);
      return;
    }
    let channel;
    try {
      channel = new BroadcastChannel(GAME_SESSION_BROADCAST);
    } catch {
      resolve(false);
      return;
    }
    let done = false;
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    _sentPingNonces.add(nonce);
    const finish = (value) => {
      if (done) return;
      done = true;
      try {
        channel.close();
      } catch (_) {}
      resolve(value);
    };
    channel.addEventListener("message", (event) => {
      const data = event.data;
      if (data?.type === "gs-owner-pong" && data.gameSessionId === gameSessionId && data.nonce === nonce) {
        finish(true);
      }
    });
    try {
      channel.postMessage({ type: "gs-owner-ping", gameSessionId, nonce });
    } catch (_) {
      finish(false);
      return;
    }
    setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Guarantee this tab has a game session ID no other LIVING tab owns.
 * - Fresh tab (no stored ID): mint.
 * - Duplicated tab (stored ID owned by a live tab): mint a new ID.
 * - Refreshed tab (stored ID released on pagehide, no live owner): keep it.
 */
function ensureUniqueGameSessionId() {
  if (_ensureUniquePromise) return _ensureUniquePromise;
  _ensureUniquePromise = (async () => {
    cleanupStaleTabLocks();
    let stored = null;
    try {
      stored = sessionStorage.getItem(GAME_SESSION_STORAGE_KEY);
    } catch (_) {}

    if (!stored) {
      getGameSessionId();
      establishTabLock();
      return _gameSessionId;
    }

    _gameSessionId = stored;
    getSessionOpenedAt();

    const lock = readTabLock(stored);
    const lockFresh = lock && Number.isFinite(lock.ts) && Date.now() - lock.ts < TAB_LOCK_FRESH_MS;
    if (lockFresh && !lock.released) {
      // Another live tab is heartbeating this ID right now → duplicate.
      return mintNewGameSession("duplicate_tab_lock");
    }

    // Lock released (refresh) or stale (throttled background tab): ask over
    // BroadcastChannel whether any living tab owns this ID.
    const owned = await pingForOwner(stored, OWNER_PING_WAIT_MS);
    if (owned) {
      return mintNewGameSession("duplicate_tab_ping");
    }
    establishTabLock();
    debugLog("adopted_existing_session");
    return _gameSessionId;
  })();
  return _ensureUniquePromise;
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
  const openedAt = getSessionOpenedAt();
  if (openedAt) headers[GAME_SESSION_OPENED_AT_HEADER] = String(openedAt);
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
    sessionOpenedAt: getSessionOpenedAt(),
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
  const myOpened = getSessionOpenedAt();
  const theirOpened = Number(payload.sessionOpenedAt) || Number(payload.at) || 0;
  if (theirOpened > 0 && myOpened > 0 && myOpened > theirOpened) return;
  markSuperseded("broadcast");
}

function handleBroadcastMessage(data) {
  if (data?.type === "gs-owner-ping") {
    if (!data.gameSessionId || !data.nonce) return;
    if (_sentPingNonces.has(data.nonce)) return; // our own boot ping
    if (data.gameSessionId !== _gameSessionId) return;
    try {
      _broadcast?.postMessage({
        type: "gs-owner-pong",
        gameSessionId: _gameSessionId,
        nonce: data.nonce,
      });
    } catch (_) {}
    return;
  }
  if (data?.type === "gs-owner-pong") return;
  onForeignSessionClaim(data);
}

function initCrossTabListeners() {
  if (typeof BroadcastChannel !== "undefined" && !_broadcast) {
    _broadcast = new BroadcastChannel(GAME_SESSION_BROADCAST);
    _broadcast.addEventListener("message", (event) => handleBroadcastMessage(event.data));
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
    window.addEventListener("pagehide", () => {
      // Release the tab lock so a refresh of THIS tab keeps its session ID,
      // while a duplicate of a still-open tab is forced to mint a new one.
      writeTabLock(true);
    });
  }
}

function markActive() {
  if (_state === "active") return;
  _state = "active";
  debugLog("active");
  if (typeof _onActive === "function") _onActive();
}

function markSuperseded(reason) {
  if (_state === "superseded") return;
  _state = "superseded";
  debugLog("superseded", { reason });
  if (typeof _onSuperseded === "function") _onSuperseded();
}

function markApiUnavailable(where) {
  if (!_apiUnavailable) {
    _apiUnavailable = true;
    try {
      console.warn(
        `[monex-session] game-session API unavailable (${where}); single-session enforcement is disabled until the API is deployed`
      );
    } catch (_) {}
  }
  markActive();
}

function applyServerStatus(status) {
  if (!status?.ok) return null;
  if (status.active) {
    markActive();
    return "active";
  }
  if (status.reason === "superseded") {
    markSuperseded("server");
    return "superseded";
  }
  return status.reason || "inactive";
}

async function verifyAndApplyStatus() {
  const status = await fetchSessionStatus();
  if (!status?.ok) return status;
  applyServerStatus(status);
  return status;
}

async function claimActiveSession() {
  if (!MonExAuth?.isLoggedIn?.()) return { ok: false, error: "not_logged_in" };
  initCrossTabListeners();
  await ensureUniqueGameSessionId();
  const res = await fetch(`${getApiBase()}/api/game-session/claim`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(sessionPayload()),
  });
  if (res.status === 404) {
    markApiUnavailable("claim");
    return { ok: true, active: true, unsupported: true };
  }
  const data = await res.json().catch(() => ({}));
  debugLog("claim_response", { httpStatus: res.status, active: data.active, tookOver: data.tookOver, reason: data.reason });
  if (!res.ok || data.ok === false) {
    if (data.reason === "superseded") markSuperseded("claim_rejected");
    return data;
  }

  const verified = await verifyAndApplyStatus();
  if (verified?.active && data.tookOver) {
    publishSessionTakeover(getUsername(), getGameSessionId());
  } else if (verified?.reason === "superseded") {
    markSuperseded("claim_verify");
  }
  return verified || data;
}

async function fetchSessionStatus() {
  await ensureUniqueGameSessionId();
  const gameSessionId = getGameSessionId();
  const url = new URL(`${getApiBase()}/api/game-session/status`);
  url.searchParams.set("gameSessionId", gameSessionId);
  url.searchParams.set("sessionOpenedAt", String(getSessionOpenedAt()));
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (res.status === 404) {
    markApiUnavailable("status");
    return { ok: true, active: true, unsupported: true };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "status_failed", httpStatus: res.status };
  return data;
}

async function sendHeartbeat() {
  if (_state === "superseded") return { ok: true, active: false, reason: "superseded" };
  await ensureUniqueGameSessionId();
  writeTabLock(false);
  const res = await fetch(`${getApiBase()}/api/game-session/heartbeat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(sessionPayload()),
  });
  if (res.status === 404) {
    markApiUnavailable("heartbeat");
    return { ok: true, active: true, unsupported: true };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error || "heartbeat_failed" };
  const before = _state;
  applyServerStatus(data);
  if (data.tookOver && _state === "active" && before !== "active") {
    publishSessionTakeover(getUsername(), getGameSessionId());
  }
  return data;
}

async function pollSessionStatus() {
  if (!MonExAuth?.isLoggedIn?.()) return;
  await ensureUniqueGameSessionId();
  writeTabLock(false);
  if (_state === "superseded") return;
  try {
    const status = await fetchSessionStatus();
    if (!status.ok) return;

    if (status.active) {
      markActive();
      return;
    }

    if (status.reason === "superseded") {
      markSuperseded("poll");
      return;
    }

    if (status.reason === "unclaimed") {
      await claimActiveSession();
      return;
    }

    if (status.reason === "stale_other" && status.canReclaim) {
      await claimActiveSession();
    }
  } catch (_) {
    /* keep state on transient network errors */
  }
}

function isGameplayResponseInactive(response, data) {
  if (response?.status !== 403 || !data) return false;
  return data.error === "game_session_inactive" || data.error === "game_session_required";
}

function installFetchInterceptor() {
  if (_fetchPatched || typeof window.fetch !== "function") return;
  _fetchPatched = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    const response = await nativeFetch(input, init);
    if (!_guardRunning || _state === "active") return response;
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (!url.includes("/api/")) return response;
      if (url.includes("/api/game-session/")) return response;
      if (response.status !== 403) return response;
      const clone = response.clone();
      const data = await clone.json().catch(() => ({}));
      if (isGameplayResponseInactive(response, data)) {
        if (data.reason === "superseded") {
          markSuperseded("api_fetch");
        } else {
          handleInactiveFromApi().catch(() => {});
        }
      }
    } catch (_) {}
    return response;
  };
}

function installClickBlocker() {
  if (_clickBlocker) return;
  _clickBlocker = (event) => {
    if (_state !== "superseded") return;
    event.stopPropagation();
    event.preventDefault();
  };
  document.addEventListener("click", _clickBlocker, true);
  document.addEventListener("keydown", _clickBlocker, true);
  document.addEventListener("pointerdown", _clickBlocker, true);
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
  installFetchInterceptor();
  installClickBlocker();
  getGameSessionId();
  debugLog("guard_started");

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
      body: JSON.stringify(sessionPayload()),
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

function isGameplayAllowed() {
  return _state === "active";
}

function hasGameSessionId() {
  return !!getGameSessionId();
}

async function handleInactiveFromApi() {
  const status = await fetchSessionStatus().catch(() => null);
  if (status?.ok && status.active) {
    markActive();
    return;
  }
  if (status?.ok && status.reason === "superseded") {
    markSuperseded("api");
    return;
  }
  if (status?.ok && (status.reason === "unclaimed" || (status.reason === "stale_other" && status.canReclaim))) {
    await claimActiveSession();
  }
}

/** Block gameplay unless this tab is the authoritative active session. */
function ensureGameplayApiAllowed() {
  return _state === "active";
}

function gameplayRequestExtras() {
  return sessionPayload();
}

window.MonExGameSession = {
  GAME_SESSION_HEADER,
  GAME_SESSION_OPENED_AT_HEADER,
  GAME_SESSION_STORAGE_KEY,
  getGameSessionId,
  getSessionOpenedAt,
  ensureUniqueGameSessionId,
  claimActiveSession,
  fetchSessionStatus,
  sendHeartbeat,
  pollSessionStatus,
  startSessionGuard,
  stopSessionGuard,
  releaseSession,
  isActive,
  isSuperseded,
  isGameplayAllowed,
  hasGameSessionId,
  handleInactiveFromApi,
  ensureGameplayApiAllowed,
  gameplayRequestExtras,
  authHeaders,
  initCrossTabListeners,
};
})();
