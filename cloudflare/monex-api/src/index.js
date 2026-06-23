import { processMentionTweet } from "./lib/process-mention.js";
import { parseMention } from "./lib/parse-mention.js";
import {
  loadState,
  saveState,
  wasProcessed,
  markProcessed,
  getUser,
  appendActivity,
  listActivities,
  getPendingForUsername,
  syncPendingToSlots,
  getPollSinceId,
  setPollSinceId,
} from "./kv-store.js";
import { createXClient, resolveBotUser, fetchMentions } from "./lib/x-client.js";
import {
  oauthConfigured,
  devAuthAllowed,
  buildXAuthorizeUrl,
  consumeOAuthState,
  exchangeXCode,
  fetchXUser,
  createSession,
  createDevSession,
  deleteSession,
  requireSession,
  getBearerToken,
} from "./lib/auth.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./lib/save.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function handleSimulate(body, env) {
  const text = body?.text || "";
  const username = (body?.username || "test_trainer").replace("@", "");
  const authorId = body?.authorId || `sim_${username.toLowerCase()}`;
  const tweetId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const starting = parseInt(env.STARTING_MONBALLS || "10", 10);
  const bot = env.BOT_USERNAME || "monexmonad";

  const state = await loadState(env.MONEX_KV);
  const parsed = parseMention(text, bot);
  if (parsed.type === "catch") {
    const user = getUser(state, authorId, username, starting);
    if (user.monballs < parsed.spend) user.monballs = starting;
  }

  const result = processMentionTweet(
    { id: tweetId, text, authorId, username },
    bot,
    state,
    starting
  );
  if (result.activity) await appendActivity(env.MONEX_KV, result.activity);
  await saveState(env.MONEX_KV, state);

  return json({
    ok: true,
    parsed: result.parsed,
    activity: result.activity,
    skipReason: result.skipReason || null,
  });
}

async function pollXMentions(env) {
  if (env.ENABLE_X_POLL !== "1") return;
  const required = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
  if (required.some((k) => !env[k])) return;

  const client = createXClient(env).readWrite;
  const botUser = await resolveBotUser(client);
  let sinceId = await getPollSinceId(env.MONEX_KV);
  const starting = parseInt(env.STARTING_MONBALLS || "10", 10);
  const bot = botUser.username || env.BOT_USERNAME || "monexmonad";

  const { tweets, meta } = await fetchMentions(client, botUser.id, sinceId);
  if (meta?.newest_id) {
    sinceId = meta.newest_id;
    await setPollSinceId(env.MONEX_KV, sinceId);
  }

  for (const tweet of tweets) {
    const state = await loadState(env.MONEX_KV);
    if (wasProcessed(state, tweet.id)) continue;

    const result = processMentionTweet(tweet, bot, state, starting);
    markProcessed(state, tweet.id);
    if (result.activity) await appendActivity(env.MONEX_KV, result.activity);
    await saveState(env.MONEX_KV, state);
  }
}

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === "/api/health") {
      const hasXKeys = !!(
        env.X_API_KEY &&
        env.X_API_SECRET &&
        env.X_ACCESS_TOKEN &&
        env.X_ACCESS_TOKEN_SECRET
      );
      return json({
        ok: true,
        service: "monex-cloudflare",
        xPoll: env.ENABLE_X_POLL === "1",
        xKeys: hasXKeys,
        xOAuth: oauthConfigured(env),
        devAuth: devAuthAllowed(env),
        bot: env.BOT_USERNAME || "monexmonad",
      });
    }

    if (path === "/api/auth/x" && request.method === "GET") {
      if (!oauthConfigured(env)) {
        return json({ ok: false, error: "X OAuth not configured on server" }, 503);
      }
      const returnTo = url.searchParams.get("returnTo") || env.FRONTEND_ORIGIN || "/home.html";
      const authorizeUrl = await buildXAuthorizeUrl(env, env.MONEX_KV, returnTo);
      return Response.redirect(authorizeUrl, 302);
    }

    if (path === "/api/auth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthErr = url.searchParams.get("error");
      const frontend = env.FRONTEND_ORIGIN || "https://jericddd.github.io/MonEx";

      if (oauthErr || !code || !state) {
        const dest = `${frontend}/home.html?auth_error=${encodeURIComponent(oauthErr || "denied")}`;
        return Response.redirect(dest, 302);
      }

      const pending = await consumeOAuthState(env.MONEX_KV, state);
      if (!pending) {
        const dest = `${frontend}/home.html?auth_error=expired_state`;
        return Response.redirect(dest, 302);
      }

      const tokenData = await exchangeXCode(env, code, pending.codeVerifier);
      const xUser = await fetchXUser(tokenData.access_token);
      const { token, session } = await createSession(env.MONEX_KV, {
        xUserId: xUser.id,
        username: xUser.username,
        name: xUser.name,
        profileImageUrl: xUser.profile_image_url,
      });

      const returnTo = pending.returnTo || "/home.html";
      const dest = `${frontend}${returnTo}${returnTo.includes("?") ? "&" : "?"}session=${token}`;
      return Response.redirect(dest, 302);
    }

    if (path === "/api/auth/me" && request.method === "GET") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      return json({
        ok: true,
        user: {
          xUserId: auth.session.xUserId,
          username: auth.session.username,
          name: auth.session.name,
          profileImageUrl: auth.session.profileImageUrl,
        },
      });
    }

    if (path === "/api/auth/logout" && request.method === "POST") {
      const token = getBearerToken(request);
      await deleteSession(env.MONEX_KV, token);
      return json({ ok: true });
    }

    if (path === "/api/auth/dev" && request.method === "POST") {
      if (!devAuthAllowed(env)) {
        return json({ ok: false, error: "dev auth disabled" }, 403);
      }
      const body = await request.json();
      const username = (body?.username || "").trim();
      if (!username) return json({ ok: false, error: "username required" }, 400);
      const { token, session } = await createDevSession(env.MONEX_KV, username);
      return json({
        ok: true,
        token,
        user: {
          xUserId: session.xUserId,
          username: session.username,
          name: session.name,
        },
      });
    }

    if (path === "/api/save" && request.method === "GET") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      const { found, save } = await loadCloudSave(env.MONEX_KV, auth.session.xUserId);
      return json({ ok: true, found, save, user: { username: auth.session.username, xUserId: auth.session.xUserId } });
    }

    if (path === "/api/save" && request.method === "PUT") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
      const body = await request.json();
      const payload = buildSavePayload(body?.save || body, auth.session);
      await writeCloudSave(env.MONEX_KV, auth.session.xUserId, payload);
      return json({ ok: true, savedAt: payload.updatedAt });
    }

    if (path === "/api/activity" && request.method === "GET") {
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "50", 10));
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const result = await listActivities(env.MONEX_KV, { limit, page, successOnly: true });
      return json({ ok: true, ...result });
    }

    if (path === "/api/activity/mine" && request.method === "GET") {
      const username = (url.searchParams.get("username") || "").trim();
      if (!username) return json({ ok: false, error: "username required" }, 400);
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "30", 10));
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const result = await listActivities(env.MONEX_KV, { limit, page, username, successOnly: true });
      return json({ ok: true, username: username.replace("@", ""), ...result });
    }

    if (path === "/api/pending" && request.method === "GET") {
      const username = (url.searchParams.get("username") || "").trim();
      if (!username) return json({ ok: false, error: "username required" }, 400);
      const state = await loadState(env.MONEX_KV);
      const result = getPendingForUsername(state, username);
      return json({
        ok: true,
        username: username.replace("@", ""),
        found: result.found,
        monballs: result.monballs,
        pendingMons: result.pendingMons,
        count: result.pendingMons.length,
      });
    }

    if (path === "/api/sync" && request.method === "POST") {
      const body = await request.json();
      let username = (body?.username || "").trim();
      const auth = await requireSession(request, env.MONEX_KV);
      if (auth.ok) username = auth.session.username;
      if (!username) return json({ ok: false, error: "username required" }, 400);
      const partyCount = Math.max(0, parseInt(body?.partyCount ?? 0, 10));
      const boxCount = Math.max(0, parseInt(body?.boxCount ?? 0, 10));
      const state = await loadState(env.MONEX_KV);
      const { party, box, remaining } = syncPendingToSlots(
        state,
        username,
        partyCount,
        boxCount
      );
      await saveState(env.MONEX_KV, state);
      return json({
        ok: true,
        username: username.replace("@", ""),
        party,
        box,
        added: party.length + box.length,
        remaining,
      });
    }

    if (path === "/api/simulate-mention" && request.method === "POST") {
      const body = await request.json();
      return handleSimulate(body, env);
    }

    return json({ ok: false, error: "not found" }, 404);
  } catch (err) {
    return json({ ok: false, error: err.message || "server error" }, 500);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
  async scheduled(event, env) {
    try {
      await pollXMentions(env);
    } catch (err) {
      console.error("[cron]", err.message);
    }
  },
};
