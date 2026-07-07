/** OAuth 1.0a signed fetch for X API v2 (Cloudflare Workers compatible). */

function pctEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function randomNonce() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Base64(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  let binary = "";
  for (const byte of new Uint8Array(sig)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildOAuthHeader(oauth) {
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(oauth[k])}"`)
      .join(", ")
  );
}

export async function oauth1Sign(method, baseUrl, queryParams, env) {
  const oauth = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const params = {};
  for (const [k, v] of Object.entries(queryParams || {})) {
    if (v !== undefined && v !== null && v !== "") params[k] = String(v);
  }

  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(all[k])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    pctEncode(baseUrl),
    pctEncode(paramString),
  ].join("&");

  const signingKey = `${pctEncode(env.X_API_SECRET)}&${pctEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const signature = await hmacSha1Base64(signingKey, baseString);

  return { ...oauth, oauth_signature: signature };
}

export async function xApiGet(env, path, queryParams = {}) {
  const baseUrl = `https://api.twitter.com/2${path}`;
  const params = {};
  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== undefined && v !== null && v !== "") params[k] = String(v);
  }

  const oauth = await oauth1Sign("GET", baseUrl, params, env);
  const queryString = Object.keys(params)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(params[k])}`)
    .join("&");
  const url = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  const res = await fetch(url, {
    headers: { Authorization: buildOAuthHeader(oauth) },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || data?.title || data?.detail || JSON.stringify(data);
    throw new Error(`X API ${res.status}: ${detail}`);
  }
  return data;
}
