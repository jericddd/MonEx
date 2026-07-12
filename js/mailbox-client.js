/** Daily login + mailbox API client (homepage + game). */

const mailboxClaimPromises = new Map();

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
  const res = await fetch(`${mailboxApiBase()}/api/daily-login/claim`, {
    method: "POST",
    headers: mailboxAuthHeaders(),
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data?.error) throw new Error("claim failed");
  return data;
}

async function claimMailboxMail(mailId) {
  const id = String(mailId || "").trim();
  if (!id) throw new Error("mail_id_required");
  if (mailboxClaimPromises.has(id)) {
    return mailboxClaimPromises.get(id);
  }
  if (window.MonExGameSession?.isGameplayAllowed && !window.MonExGameSession.isGameplayAllowed()) {
    throw new Error("game_session_inactive");
  }
  const promise = (async () => {
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
  })();
  mailboxClaimPromises.set(id, promise);
  try {
    return await promise;
  } finally {
    mailboxClaimPromises.delete(id);
  }
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
