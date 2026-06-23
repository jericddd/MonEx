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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
        bot: env.BOT_USERNAME || "monexmonad",
      });
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
      const username = (body?.username || "").trim();
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
