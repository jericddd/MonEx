const OAUTH_STATE_TTL_SEC = 600;
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

export function oauthConfigured(env) {
  return !!(env.X_CLIENT_ID && env.X_CLIENT_SECRET);
}

export function devAuthAllowed(env) {
  return env.ENABLE_DEV_AUTH === "1";
}

function sessionKey(token) {
  return `monex:session:${token}`;
}

function oauthStateKey(state) {
  return `monex:oauth:${state}`;
}

export async function createOAuthState(kv, { codeVerifier, returnTo }) {
  const state = randomToken(16);
  await kv.put(
    oauthStateKey(state),
    JSON.stringify({ codeVerifier, returnTo, createdAt: Date.now() }),
    { expirationTtl: OAUTH_STATE_TTL_SEC }
  );
  return state;
}

export async function consumeOAuthState(kv, state) {
  const key = oauthStateKey(state);
  const raw = await kv.get(key);
  if (!raw) return null;
  await kv.delete(key);
  return JSON.parse(raw);
}

export async function buildXAuthorizeUrl(env, kv, returnTo) {
  const codeVerifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = await createOAuthState(kv, { codeVerifier, returnTo });
  const redirectUri = env.X_REDIRECT_URI || `${new URL(env.WORKER_ORIGIN || "https://monex-api.0xjericd.workers.dev").origin}/api/auth/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.X_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "tweet.read users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://twitter.com/i/oauth2/authorize?${params}`;
}

export async function exchangeXCode(env, code, codeVerifier) {
  const redirectUri = env.X_REDIRECT_URI || `${new URL(env.WORKER_ORIGIN || "https://monex-api.0xjericd.workers.dev").origin}/api/auth/callback`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: env.X_CLIENT_ID,
  });

  const basic = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X token exchange failed: ${err}`);
  }
  return res.json();
}

export async function fetchXUser(accessToken) {
  const res = await fetch("https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`X user fetch failed: ${err}`);
  }
  const data = await res.json();
  return data.data;
}

export async function createSession(kv, { xUserId, username, name, profileImageUrl }) {
  const token = randomToken(32);
  const session = {
    xUserId,
    username: (username || "").toLowerCase().replace("@", ""),
    name: name || username,
    profileImageUrl: profileImageUrl || null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_SEC * 1000).toISOString(),
  };
  await kv.put(sessionKey(token), JSON.stringify(session), { expirationTtl: SESSION_TTL_SEC });
  return { token, session };
}

export async function createDevSession(kv, username) {
  const clean = (username || "").toLowerCase().replace("@", "").trim();
  if (!clean) throw new Error("username required");
  return createSession(kv, {
    xUserId: `sim_${clean}`,
    username: clean,
    name: clean,
  });
}

export async function getSession(kv, token) {
  if (!token) return null;
  const raw = await kv.get(sessionKey(token));
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    await kv.delete(sessionKey(token));
    return null;
  }
  return session;
}

export async function deleteSession(kv, token) {
  if (token) await kv.delete(sessionKey(token));
}

export function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

export async function requireSession(request, kv) {
  const token = getBearerToken(request);
  const session = await getSession(kv, token);
  if (!session) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true, token, session };
}
