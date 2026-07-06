/** Shared security helpers for the MonEx API Worker. */

export function timingSafeEqual(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

export function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function sanitizeReturnTo(returnTo) {
  const fallback = "/home.html";
  if (!returnTo || typeof returnTo !== "string") return fallback;
  const trimmed = returnTo.trim();
  if (!trimmed.startsWith("/")) return fallback;
  if (trimmed.startsWith("//")) return fallback;
  if (trimmed.includes("..")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  return trimmed;
}

function parseExtraOrigins(env) {
  const raw = env.ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  const extras = parseExtraOrigins(env);
  const frontend = (env.FRONTEND_ORIGIN || "https://monexmonad.xyz").replace(/\/$/, "");
  if (origin === frontend) return true;
  if (extras.includes(origin)) return true;
  if (env.ALLOW_STAGING_ORIGINS !== "0") {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      if (host.endsWith(".pages.dev")) return true;
      if (host === "localhost" || host === "127.0.0.1") return true;
    } catch (_) {}
  }
  return false;
}

export function buildCorsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
    Vary: "Origin",
  };
  if (origin && isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function simulateAllowed(env) {
  return env.ENABLE_SIMULATE === "1";
}

export async function checkRateLimit(kv, bucket, { limit = 60, windowSec = 60 } = {}) {
  const key = `monex:rl:${bucket}`;
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (Number.isFinite(count) && count >= limit) {
    return { ok: false, retryAfterSec: windowSec };
  }
  await kv.put(key, String((Number.isFinite(count) ? count : 0) + 1), {
    expirationTtl: windowSec,
  });
  return { ok: true };
}

export async function enforceRateLimit(request, env, routeKey, options = {}) {
  const ip = getClientIp(request);
  const result = await checkRateLimit(env.MONEX_KV, `${routeKey}:${ip}`, options);
  if (!result.ok) {
    const err = new Error("rate_limited");
    err.code = "rate_limited";
    err.retryAfterSec = result.retryAfterSec;
    throw err;
  }
}
