/** X login session + cloud save client */

const SESSION_KEY = "monex_session_token";
const USER_KEY = "monex_user";

function getApiBase() {
  if (typeof getMonexApiBase === "function") return getMonexApiBase();
  if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
  return "https://monex-api.0xjericd.workers.dev";
}

function authHeaders() {
  const token = localStorage.getItem(SESSION_KEY);
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
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
  const path = returnTo || "/home.html";
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

async function ensureUser() {
  if (captureSessionFromUrl()) {
    try {
      return await fetchMe();
    } catch {
      await logout();
      return null;
    }
  }
  if (!isLoggedIn()) return null;
  try {
    return await fetchMe();
  } catch {
    await logout();
    return null;
  }
}

async function loadCloudSave() {
  const base = getApiBase();
  const res = await fetch(`${base}/api/save`, { headers: authHeaders() });
  if (!res.ok) throw new Error("cloud save load failed");
  return res.json();
}

let _saveTimer = null;
let _saveInflight = null;

function buildSavePayload(state) {
  return {
    party: state.party,
    box: state.box,
    monballs: state.monballs,
    money: state.money,
    essence: state.essence,
    monShards: state.monShards,
    trainerXp: state.trainerXp,
    highestStageCleared: state.highestStageCleared,
    adventureGlobalBest: state.adventureGlobalBest,
    currentChapter: state.currentChapter,
    currentStage: state.currentStage,
    gearInventory: state.gearInventory,
    lastResetDate: state.lastResetDate,
    xHandle: state.xHandle,
    resourceChestLastCollectAt: state.resourceChestLastCollectAt,
    adventureBattleActive: !!state.adventureBattleActive,
    saveVersion: state.saveVersion ?? 1,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
}

async function pushCloudSave(payload) {
  const base = getApiBase();
  const res = await fetch(`${base}/api/save`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ save: payload }),
  });
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    return { conflict: true, save: data.save || null };
  }
  if (!res.ok) throw new Error("cloud save failed");
  const data = await res.json();
  return { conflict: false, save: data.save || null };
}

function scheduleCloudSave(state, delayMs = 800) {
  if (!isLoggedIn()) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveInflight = pushCloudSave(buildSavePayload(state))
      .then((result) => {
        if (result?.conflict && result.save && typeof window.handleCloudSaveConflict === "function") {
          window.handleCloudSaveConflict(result.save);
        }
      })
      .catch(() => {});
  }, delayMs);
}

async function flushCloudSave(state) {
  if (!isLoggedIn()) return null;
  clearTimeout(_saveTimer);
  if (_saveInflight) await _saveInflight;
  const result = await pushCloudSave(buildSavePayload(state));
  if (result?.conflict && result.save && typeof window.handleCloudSaveConflict === "function") {
    window.handleCloudSaveConflict(result.save);
  }
  return result;
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
  loadCloudSave,
  scheduleCloudSave,
  flushCloudSave,
  buildSavePayload,
  authHeaders,
};
