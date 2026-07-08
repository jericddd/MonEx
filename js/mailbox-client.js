/** Daily login + mailbox API client (homepage + game). */

function mailboxAuthHeaders() {
  if (typeof MonExAuth !== "undefined" && MonExAuth.authHeaders) {
    return MonExAuth.authHeaders();
  }
  const token = localStorage.getItem("monex_session_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
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
  const res = await fetch(`${mailboxApiBase()}/api/mailbox/claim`, {
    method: "POST",
    headers: mailboxAuthHeaders(),
    body: JSON.stringify({ mailId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "mailbox claim failed");
  return data;
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
