/**
 * X login session + cloud save client.
 *
 * IMPORTANT: wrapped in an IIFE. Classic <script> tags share one global
 * lexical scope; top-level const/let collisions with other scripts throw a
 * parse-time SyntaxError that silently kills whole files. Keep every
 * declaration inside the IIFE and expose only window.MonExAuth.
 */
(() => {
"use strict";

const SESSION_KEY = "monex_session_token";
const USER_KEY = "monex_user";
const RESET_EPOCH_KEY = "monex_client_reset_epoch";
const GAME_SESSION_STORAGE_KEY = "monex_game_session_id";
const GAME_SESSION_HEADER = "X-Game-Session-Id";

function readGameSessionId() {
  if (window.MonExGameSession?.getGameSessionId) {
    return window.MonExGameSession.getGameSessionId();
  }
  try {
    return sessionStorage.getItem(GAME_SESSION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function readSessionOpenedAt() {
  if (window.MonExGameSession?.getSessionOpenedAt) {
    return window.MonExGameSession.getSessionOpenedAt();
  }
  try {
    const raw = sessionStorage.getItem("monex_game_session_opened_at");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function wipeMonexLocalData() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || key === RESET_EPOCH_KEY) continue;
    if (
      key.startsWith("monex_") ||
      key === "monex_session_token" ||
      key === "monex_user"
    ) {
      keys.push(key);
    }
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

async function enforceServerResetEpoch() {
  const base = getApiBase();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/health`);
    if (!res.ok) return false;
    const health = await res.json();
    const serverEpoch = parseInt(health.resetEpoch ?? 0, 10) || 0;
    const clientEpoch = parseInt(localStorage.getItem(RESET_EPOCH_KEY) || "0", 10) || 0;
    if (serverEpoch <= clientEpoch) return false;
    wipeMonexLocalData();
    localStorage.setItem(RESET_EPOCH_KEY, String(serverEpoch));
    return true;
  } catch {
    return false;
  }
}

function getApiBase() {
  if (typeof getMonexApiBase === "function") return getMonexApiBase();
  if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
  return "https://monex-api.0xjericd.workers.dev";
}

function authHeaders() {
  const token = localStorage.getItem(SESSION_KEY);
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const gameSessionId = readGameSessionId();
  if (gameSessionId) headers[GAME_SESSION_HEADER] = gameSessionId;
  const sessionOpenedAt = readSessionOpenedAt();
  if (sessionOpenedAt) headers["X-Game-Session-Opened-At"] = String(sessionOpenedAt);
  return headers;
}

function cacheUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function readCachedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function captureSessionFromUrl() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const hashToken = hashParams.get("session");
    if (hashToken) {
      localStorage.setItem(SESSION_KEY, hashToken);
      hashParams.delete("session");
      const remaining = hashParams.toString();
      history.replaceState({}, "", location.pathname + location.search + (remaining ? `#${remaining}` : ""));
      return true;
    }
  }

  const params = new URLSearchParams(location.search);
  const token = params.get("session");
  if (!token) return false;
  localStorage.setItem(SESSION_KEY, token);
  params.delete("session");
  const next = params.toString();
  const clean = location.pathname + (next ? `?${next}` : "") + location.hash;
  history.replaceState({}, "", clean);
  return true;
}

async function fetchMe() {
  const base = getApiBase();
  const res = await fetch(`${base}/api/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error("not logged in");
  const data = await res.json();
  if (data.user) cacheUser(data.user);
  return data.user;
}

async function startXLogin(returnTo) {
  const base = getApiBase();
  const path = returnTo || "/";
  window.location.href = `${base}/api/auth/x?returnTo=${encodeURIComponent(path)}`;
}

async function devLogin(username) {
  const base = getApiBase();
  const res = await fetch(`${base}/api/auth/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.replace("@", "") }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "dev login failed");
  }
  const data = await res.json();
  localStorage.setItem(SESSION_KEY, data.token);
  cacheUser(data.user);
  return data.user;
}

async function logout() {
  const base = getApiBase();
  try {
    if (window.MonExGameSession?.releaseSession) {
      await window.MonExGameSession.releaseSession();
    }
    await fetch(`${base}/api/auth/logout`, { method: "POST", headers: authHeaders() });
  } catch (_) {}
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("monex_current_user");
}

function isLoggedIn() {
  return !!localStorage.getItem(SESSION_KEY);
}

function getDisplayName() {
  const user = readCachedUser();
  return user?.name || user?.username || "Trainer";
}

function getUsername() {
  return readCachedUser()?.username || "";
}

function getXUserId() {
  return readCachedUser()?.xUserId || "";
}

function normalizeProfileImageUrl(url) {
  if (!url || typeof url !== "string") return null;
  let trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://")) trimmed = `https://${trimmed.slice(7)}`;
  if (!/^https:\/\/(pbs|abs)\.twimg\.com\//i.test(trimmed)) return null;
  // Keep the URL X returned (_normal). Forcing _400x400 404s for some accounts.
  return trimmed;
}

function profileImageFallbackUrls(url) {
  const base = normalizeProfileImageUrl(url);
  if (!base) return [];
  const candidates = [];
  const add = (candidate) => {
    const normalized = normalizeProfileImageUrl(candidate);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  add(base);

  const match = base.match(
    /^(https:\/\/(?:pbs|abs)\.twimg\.com\/.+?)(_(?:normal|400x400|bigger|mini|200x200))?(\.(?:jpg|jpeg|png|webp))(\?.*)?$/i
  );
  if (match) {
    const [, prefix, , ext, query = ""] = match;
    for (const size of ["_normal", "_400x400", "_bigger", ""]) {
      add(`${prefix}${size}${ext}${query}`);
    }
  }

  return candidates;
}

function applyProfileAvatar(el, url, altText) {
  if (!el) return;
  const candidates = profileImageFallbackUrls(url);
  if (!candidates.length) {
    el.classList.remove("has-image");
    el.innerHTML = "";
    el.removeAttribute("data-avatar-key");
    return;
  }

  const key = candidates.join("|");
  if (el.getAttribute("data-avatar-key") === key && el.querySelector("img")) {
    return;
  }

  el.classList.add("has-image");
  el.setAttribute("data-avatar-key", key);
  el.innerHTML = "";

  const img = document.createElement("img");
  img.alt = altText || "Trainer avatar";
  img.referrerPolicy = "no-referrer";
  img.decoding = "async";

  let index = 0;
  img.addEventListener("error", () => {
    index += 1;
    if (index >= candidates.length) {
      el.classList.remove("has-image");
      el.innerHTML = "";
      el.removeAttribute("data-avatar-key");
      return;
    }
    img.src = candidates[index];
  });

  el.appendChild(img);
  img.src = candidates[0];
}

function getProfileImageUrl() {
  return normalizeProfileImageUrl(readCachedUser()?.profileImageUrl);
}

async function ensureUser() {
  if (await enforceServerResetEpoch()) return null;
  const justCaptured = captureSessionFromUrl();
  if (justCaptured || isLoggedIn()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await fetchMe();
      } catch (err) {
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        if (justCaptured) {
          console.warn("MonExAuth: session validation failed after X login", err);
        }
        await logout();
        return null;
      }
    }
  }
  return null;
}

// ---- Save revision (server-managed optimistic locking) ----
let _saveRevision = null;

function setSaveRevision(rev) {
  const n = Number(rev);
  if (Number.isFinite(n) && n >= 0) _saveRevision = n;
}

function getSaveRevision() {
  return _saveRevision;
}

async function loadCloudSave() {
  const base = getApiBase();
  const res = await fetch(`${base}/api/save`, { headers: authHeaders() });
  if (res.status === 401) {
    throw new Error("not_logged_in");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "cloud save load failed");
  }
  const data = await res.json();
  if (data?.save?.revision != null) setSaveRevision(data.save.revision);
  return data;
}

async function hydrateCloudSave() {
  const base = getApiBase();
  const res = await fetch(`${base}/api/hydrate`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: "{}",
  });
  if (res.status === 401) {
    throw new Error("not_logged_in");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "hydrate failed");
  }
  const data = await res.json();
  if (data?.save?.revision != null) setSaveRevision(data.save.revision);
  return data;
}

let _saveTimer = null;
let _saveInflight = null;
let _pendingSaveState = null;
let _liveSaveProvider = null;
/** Optional gate: when true, cloud autosave/flush/visibility must not push. */
let _cloudSaveGate = null;

function setLiveSaveProvider(fn) {
  _liveSaveProvider = typeof fn === "function" ? fn : null;
}

function setCloudSaveGate(fn) {
  _cloudSaveGate = typeof fn === "function" ? fn : null;
}

function isCloudSaveBlocked() {
  try {
    return typeof _cloudSaveGate === "function" && !!_cloudSaveGate();
  } catch (_) {
    return false;
  }
}

function cancelPendingCloudSave() {
  clearTimeout(_saveTimer);
  _saveTimer = null;
  _pendingSaveState = null;
}

async function awaitCloudSaveIdle() {
  cancelPendingCloudSave();
  if (_saveInflight) {
    try {
      await _saveInflight;
    } catch (_) {}
  }
}

function buildSavePayload(state) {
  return {
    party: state.party,
    box: state.box,
    monballs: state.monballs,
    money: state.money,
    essence: state.essence,
    monShards: state.monShards,
    trainerXp: state.trainerXp,
    trainerRewardLevel: state.trainerRewardLevel,
    highestStageCleared: state.highestStageCleared,
    adventureGlobalBest: state.adventureGlobalBest,
    currentChapter: state.currentChapter,
    currentStage: state.currentStage,
    gearInventory: state.gearInventory,
    gearInventorySeedVersion: state.gearInventorySeedVersion,
    lastResetDate: state.lastResetDate,
    xHandle: state.xHandle,
    resourceChestLastCollectAt: state.resourceChestLastCollectAt,
    patrolScansUsed: state.patrolScansUsed,
    patrolScansDay: state.patrolScansDay,
    patrolBonusAttempts: state.patrolBonusAttempts,
    patrolBonusDay: state.patrolBonusDay,
    questState: state.questState,
    mailbox: state.mailbox,
    dailyLoginLastClaimAt: state.dailyLoginLastClaimAt,
    releaseLog: state.releaseLog,
    releasedRecoveryIds: state.releasedRecoveryIds,
    adventureBattleActive: !!state.adventureBattleActive,
    saveVersion: state.saveVersion ?? 1,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
}

async function pushCloudSave(payload) {
  const base = getApiBase();
  const body = { save: payload };
  const gameSessionId = readGameSessionId();
  if (gameSessionId) body.gameSessionId = gameSessionId;
  const sessionOpenedAt = readSessionOpenedAt();
  if (sessionOpenedAt) body.sessionOpenedAt = sessionOpenedAt;
  if (_saveRevision != null) body.baseRevision = _saveRevision;
  if (window.MonExGameSession?.isGameplayAllowed && !window.MonExGameSession.isGameplayAllowed()) {
    console.info("[monex-save] push skipped: game session not active", { gameSessionId });
    return { conflict: false, save: null, skipped: "game_session_inactive" };
  }
  const res = await fetch(`${base}/api/save`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
    // keepalive lets an in-flight save survive tab close / navigation so the
    // last few seconds of progress are not lost on unload.
    keepalive: true,
  });
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    console.warn("[monex-save] push rejected 403", { error: data.error, reason: data.reason, gameSessionId });
    if (data.error === "game_session_inactive" || data.error === "game_session_required") {
      window.MonExGameSession?.handleInactiveFromApi?.();
      return { conflict: false, save: null, skipped: data.error };
    }
  }
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    console.warn("[monex-save] push conflict 409", {
      error: data.error,
      serverRevision: data.save?.revision ?? data.revision,
      baseRevision: body.baseRevision,
      gameSessionId,
    });
    if (data.save?.revision != null) setSaveRevision(data.save.revision);
    else if (data.revision != null) setSaveRevision(data.revision);
    return { conflict: true, save: data.save || null };
  }
  if (!res.ok) throw new Error("cloud save failed");
  const data = await res.json();
  if (data?.save?.revision != null) setSaveRevision(data.save.revision);
  else if (data?.revision != null) setSaveRevision(data.revision);
  if (window.MONEX_DEBUG_SAVE) {
    console.info("[monex-save] push ok", {
      revision: data?.save?.revision ?? data?.revision,
      baseRevision: body.baseRevision,
      gameSessionId,
      updatedAt: payload.updatedAt,
    });
  }
  return { conflict: false, save: data.save || null };
}

async function runCloudSavePush() {
  if (_saveInflight) {
    try {
      await _saveInflight;
    } catch (_) {}
  }
  if (!isLoggedIn()) return null;
  const state = _pendingSaveState;
  if (!state && !_liveSaveProvider) return null;
  _pendingSaveState = null;
  const payload = _liveSaveProvider ? _liveSaveProvider() : buildSavePayload(state);
  if (!payload) return null;
  _saveInflight = pushCloudSave(payload)
    .then((result) => {
      if (result?.conflict && result.save && typeof window.handleCloudSaveConflict === "function") {
        window.handleCloudSaveConflict(result.save);
      } else if (result?.save && typeof window.applyServerSaveCorrections === "function") {
        window.applyServerSaveCorrections(result.save);
      }
      return result;
    })
    .catch((err) => {
      console.warn("[monex-save] push failed", err?.message || err);
      return null;
    })
    .finally(() => {
      _saveInflight = null;
      if (_pendingSaveState) runCloudSavePush();
    });
  return _saveInflight;
}

function scheduleCloudSave(state, delayMs = 800) {
  if (!isLoggedIn()) return;
  if (isCloudSaveBlocked()) return;
  _pendingSaveState = state;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    runCloudSavePush();
  }, delayMs);
}

async function flushCloudSave(state) {
  if (!isLoggedIn()) return null;
  if (isCloudSaveBlocked()) return null;
  clearTimeout(_saveTimer);
  _pendingSaveState = state;
  if (_saveInflight) {
    try {
      await _saveInflight;
    } catch (_) {}
  }
  _pendingSaveState = state;
  return runCloudSavePush();
}

// Save session token as soon as auth-client loads (OAuth return URL).
captureSessionFromUrl();

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && isLoggedIn()) {
      if (isCloudSaveBlocked()) return;
      const payload = _liveSaveProvider ? _liveSaveProvider() : _pendingSaveState;
      if (payload) void flushCloudSave(payload);
    }
  });
}

window.MonExAuth = {
  SESSION_KEY,
  USER_KEY,
  captureSessionFromUrl,
  startXLogin,
  devLogin,
  logout,
  isLoggedIn,
  ensureUser,
  fetchMe,
  getDisplayName,
  getUsername,
  getXUserId,
  getProfileImageUrl,
  normalizeProfileImageUrl,
  profileImageFallbackUrls,
  applyProfileAvatar,
  loadCloudSave,
  hydrateCloudSave,
  scheduleCloudSave,
  flushCloudSave,
  setLiveSaveProvider,
  setCloudSaveGate,
  cancelPendingCloudSave,
  awaitCloudSaveIdle,
  buildSavePayload,
  authHeaders,
  enforceServerResetEpoch,
  wipeMonexLocalData,
  setSaveRevision,
  getSaveRevision,
};
})();
