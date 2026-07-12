/** Daily login + mailbox API client (homepage + game). */

const mailboxApiClaimPromises = new Map();

function mailboxAuthHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (typeof MonExAuth !== "undefined" && MonExAuth.authHeaders) {
    Object.assign(headers, MonExAuth.authHeaders());
    return headers;
  }
  const token = localStorage.getItem("monex_session_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (window.MonExGameSession?.getGameSessionId) {
    headers["X-Game-Session-Id"] = window.MonExGameSession.getGameSessionId();
  }
  return headers;
}

function mailboxClaimBody(mailId) {
  const body = { mailId };
  if (window.MonExGameSession?.getGameSessionId) {
    body.gameSessionId = window.MonExGameSession.getGameSessionId();
  }
  return body;
}

function mailboxApiBase() {
  if (typeof getMonexApiBase === "function") return getMonexApiBase();
  if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
  return "https://monex-api.0xjericd.workers.dev";
}

async function runDedupedClaim(key, fn) {
  const id = String(key || "").trim();
  if (mailboxApiClaimPromises.has(id)) return mailboxApiClaimPromises.get(id);
  const promise = fn().finally(() => mailboxApiClaimPromises.delete(id));
  mailboxApiClaimPromises.set(id, promise);
  return promise;
}

async function fetchDailyLoginStatus() {
  const res = await fetch(`${mailboxApiBase()}/api/daily-login/status`, {
    headers: mailboxAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "status failed");
  }
  return res.json();
}

async function claimDailyLogin() {
  return runDedupedClaim("daily-login", async () => {
    const res = await fetch(`${mailboxApiBase()}/api/daily-login/claim`, {
      method: "POST",
      headers: mailboxAuthHeaders(),
      body: "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data?.error) throw new Error("claim failed");
    return data;
  });
}

async function claimMailboxMail(mailId) {
  const id = String(mailId || "").trim();
  if (!id) throw new Error("mail_id_required");
  return runDedupedClaim(`mailbox:${id}`, async () => {
    if (window.MonExGameSession?.isGameplayAllowed && !window.MonExGameSession.isGameplayAllowed()) {
      throw new Error("game_session_inactive");
    }
    const res = await fetch(`${mailboxApiBase()}/api/mailbox/claim`, {
      method: "POST",
      headers: mailboxAuthHeaders(),
      body: JSON.stringify(mailboxClaimBody(id)),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && (data.error === "game_session_inactive" || data.error === "game_session_required")) {
      window.MonExGameSession?.handleInactiveFromApi?.();
      throw new Error(data.error || "game_session_inactive");
    }
    if (!res.ok) throw new Error(data.error || "mailbox claim failed");
    return data;
  });
}

function formatCooldownRemaining(nextClaimAt) {
  if (!nextClaimAt) return "";
  const ms = Date.parse(nextClaimAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Ready!";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

window.MonExMailbox = {
  fetchDailyLoginStatus,
  claimDailyLogin,
  claimMailboxMail,
  formatCooldownRemaining,
};
