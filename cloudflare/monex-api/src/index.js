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
  getPendingForSession,
  syncPendingForSession,
  getPollSinceId,
  setPollSinceId,
  clearPollSinceId,
  getPollStatus,
  setPollStatus,
  resetAllData,
  withUserSyncLock,
  DEFAULT_PARTY_MAX,
  DEFAULT_BOX_MAX,
  getResetEpoch,
  canSendReply,
  recordReplySent,
  getReplyCountToday,
} from "./kv-store.js";
import { resolveBotUser, fetchMentions, fetchCatchMentionSearch, fetchCatchThreadSearch, mergeMentionTweets, assertXKeys, postReply } from "./lib/x-client.js";
import { uploadTwitterMedia } from "./lib/x-media.js";
import { getFirstCaughtMon } from "./lib/catch-card-core.js";
import { renderCatchCardPng } from "./lib/catch-card.js";
import { generateSkills } from "./lib/catch-engine.js";
import {
  oauthConfigured,
  devAuthAllowed,
  stagingDevAuthEnabled,
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
import { grantMonballs, alignCatchMonballsToMerged } from "./lib/grant-monballs.js";
import { resolveMergedMonballs, reconcileMonballsForCloudSave, syncSaveMonballsAfterCatch, getAuthoritativeMonballs } from "./lib/save-reconcile.js";
import { appendMonballAudit } from "./lib/monball-audit.js";
import {
  claimGameSession,
  heartbeatGameSession,
  getGameSessionStatus,
  releaseGameSession,
  requireGameplaySession,
  getGameSessionIdFromRequest,
  getSessionOpenedAtFromRequest,
  normalizeSessionOpenedAt,
} from "./lib/game-session.js";
import { backfillPendingForUser } from "./lib/backfill-pending.js";
import {
  buildCorsHeaders,
  enforceRateLimit,
  sanitizeReturnTo,
  simulateAllowed,
  timingSafeEqual,
} from "./lib/security.js";
import { buildMentionReplyText } from "./lib/mention-reply.js";
import { buildDailyLimitNoticeReply, getReplySeed } from "./lib/natural-reply.js";
import { getDailyReplyLimitForUser } from "./lib/reply-limits.js";
import { claimDailyLoginReward, claimMailboxItem, getDailyLoginStatus } from "./lib/mailbox.js";

const API_CODE_VERSION = "fetch-oauth-v1";

async function requireGameplay(request, env, body = null) {
  const auth = await requireSession(request, env.MONEX_KV);
  if (!auth.ok) return auth;
  const gs = await requireGameplaySession(request, env.MONEX_KV, auth.session, body);
  if (!gs.ok) {
    return {
      ok: false,
      status: gs.status || 403,
      error: gs.error,
      reason: gs.reason,
      canReclaim: gs.canReclaim,
    };
  }
  return { ok: true, token: auth.token, session: auth.session, gameSessionId: gs.gameSessionId };
}

function json(data, status = 200, request, env) {
  const cors = request && env ? buildCorsHeaders(request, env) : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function handleSimulate(body, env, request) {
  const text = body?.text || "";
  const username = (body?.username || "test_trainer").replace("@", "");
  const authorId = body?.authorId || `sim_${username.toLowerCase()}`;
  const tweetId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const starting = parseInt(env.STARTING_MONBALLS || "10", 10);
  const bot = env.BOT_USERNAME || "monexmonad";

  const state = await loadState(env.MONEX_KV);
  const replyToBot = body?.replyToBot === true;
  const parsed = parseMention(text, bot, { replyToBot });
  if (parsed.type === "catch") {
    const user = getUser(state, authorId, username, starting);
    if (user.monballs < parsed.spend) user.monballs = starting;
  }

  const result = processMentionTweet(
    { id: tweetId, text, authorId, username, inReplyToUserId: replyToBot ? "bot" : null },
    bot,
    state,
    starting,
    replyToBot ? "bot" : null
  );
  if (result.activity) await appendActivity(env.MONEX_KV, result.activity);
  if (result.activity?.monballsLeft != null && authorId) {
    await appendMonballAudit(env.MONEX_KV, {
      xUserId: authorId,
      username,
      source: "x_catch_spend",
      delta: -(result.activity.spend || 0),
      balanceAfter: result.activity.monballsLeft,
      meta: { pool: "catch", tweetId },
    });
    await syncSaveMonballsAfterCatch(
      env.MONEX_KV,
      authorId,
      username,
      result.activity.monballsLeft,
      starting,
      { spend: result.activity.spend, tweetId }
    );
  }
  await saveState(env.MONEX_KV, state);

  return json(
    {
      ok: true,
      parsed: result.parsed,
      activity: result.activity,
      skipReason: result.skipReason || null,
    },
    200,
    request,
    env
  );
}

async function pollXMentions(env, { resetSinceId = false } = {}) {
  const status = { at: new Date().toISOString() };
  if (env.ENABLE_X_POLL !== "1") {
    status.ok = false;
    status.error = "poll_disabled";
    await setPollStatus(env.MONEX_KV, status);
    return status;
  }

  const required = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    status.ok = false;
    status.error = `missing_keys:${missing.join(",")}`;
    await setPollStatus(env.MONEX_KV, status);
    return status;
  }

  try {
    if (resetSinceId) await clearPollSinceId(env.MONEX_KV);

    assertXKeys(env);

    const botUser = await resolveBotUser(env);
    const sinceId = await getPollSinceId(env.MONEX_KV);
    const starting = parseInt(env.STARTING_MONBALLS || "10", 10);
    const bot = botUser.username || env.BOT_USERNAME || "monexmonad";

    let mentionTweets = [];
    let searchTweets = [];
    let threadTweets = [];
    let meta = null;
    status.sources = { mentionTimeline: 0, search: 0, threadSearch: 0, merged: 0 };

    try {
      const mentionRes = await fetchMentions(env, botUser.id, sinceId);
      mentionTweets = mentionRes.tweets;
      meta = mentionRes.meta;
      status.sources.mentionTimeline = mentionTweets.length;
    } catch (err) {
      status.mentionError = err.message || String(err);
    }

    try {
      const searchRes = await fetchCatchMentionSearch(env, bot, sinceId);
      searchTweets = searchRes.tweets;
      status.sources.search = searchTweets.length;
      if (!meta?.newest_id && searchRes.meta?.newest_id) meta = searchRes.meta;
    } catch (err) {
      status.searchError = err.message || String(err);
    }

    try {
      const threadRes = await fetchCatchThreadSearch(env, bot, sinceId);
      threadTweets = threadRes.tweets;
      status.sources.threadSearch = threadTweets.length;
      if (!meta?.newest_id && threadRes.meta?.newest_id) meta = threadRes.meta;
    } catch (err) {
      status.threadSearchError = err.message || String(err);
    }

    const tweets = mergeMentionTweets(mentionTweets, searchTweets, threadTweets);
    status.sources.merged = tweets.length;
    status.ok = true;
    status.botUsername = botUser.username;
    status.sinceId = sinceId;
    status.fetched = tweets.length;
    status.processed = 0;
    status.activities = 0;
    status.replies = 0;
    status.skipped = [];

    for (const tweet of tweets) {
      const state = await loadState(env.MONEX_KV);
      if (wasProcessed(state, tweet.id)) {
        status.skipped.push({ id: tweet.id, reason: "already_processed" });
        continue;
      }

      // Reserve tweet id before catch logic so concurrent polls cannot double-process.
      markProcessed(state, tweet.id);
      await saveState(env.MONEX_KV, state);

      const result = processMentionTweet(tweet, bot, state, starting, botUser.id);
      if (result.activity) {
        await appendMonballAudit(env.MONEX_KV, {
          xUserId: tweet.authorId,
          username: tweet.username,
          source: "x_catch_spend",
          delta: -(result.activity.spend || 0),
          balanceAfter: result.activity.monballsLeft,
          meta: { pool: "catch", tweetId: tweet.id },
        });
        await appendActivity(env.MONEX_KV, result.activity);
        await syncSaveMonballsAfterCatch(
          env.MONEX_KV,
          tweet.authorId,
          tweet.username,
          result.activity.monballsLeft,
          starting,
          { spend: result.activity.spend, tweetId: tweet.id }
        );
        status.activities += 1;
      } else if (result.skipReason) {
        status.skipped.push({ id: tweet.id, user: tweet.username, reason: result.skipReason });
      }

      if (env.ENABLE_X_REPLY === "1") {
        const dailyLimit = getDailyReplyLimitForUser(tweet.username, env);
        const replyUser = state.users[tweet.authorId];
        const usedToday = replyUser ? getReplyCountToday(replyUser) : 0;
        const repliesLeftAfter = dailyLimit - usedToday - 1;

        if (replyUser && canSendReply(replyUser, dailyLimit)) {
          const replyText = buildMentionReplyText(result, tweet, env, {
            dailyLimit,
            repliesLeftAfter,
          });
          if (replyText) {
            try {
              let mediaIds = [];
              const cardMon = getFirstCaughtMon(result.catchResults || []);
              if (cardMon) {
                try {
                  const png = await renderCatchCardPng(cardMon, env);
                  const mediaId = await uploadTwitterMedia(env, png);
                  mediaIds = [mediaId];
                } catch (cardErr) {
                  status.replyErrors = status.replyErrors || [];
                  status.replyErrors.push({
                    id: tweet.id,
                    error: `catch_card: ${cardErr.message || String(cardErr)}`,
                  });
                }
              }
              await postReply(env, replyText, tweet.id, mediaIds);
              recordReplySent(replyUser);
              if (repliesLeftAfter <= 0) {
                replyUser.limitNoticeDay = new Date().toISOString().slice(0, 10);
              }
              status.replies += 1;
            } catch (err) {
              status.replyErrors = status.replyErrors || [];
              status.replyErrors.push({ id: tweet.id, error: err.message || String(err) });
            }
          }
        } else if (replyUser && result.activity && !canSendReply(replyUser, dailyLimit)) {
          const today = new Date().toISOString().slice(0, 10);
          if (replyUser.limitNoticeDay !== today) {
            const notice = buildDailyLimitNoticeReply(
              tweet.username,
              dailyLimit,
              getReplySeed(tweet)
            );
            try {
              await postReply(env, notice, tweet.id);
              replyUser.limitNoticeDay = today;
              status.replies += 1;
            } catch (err) {
              status.replyErrors = status.replyErrors || [];
              status.replyErrors.push({ id: tweet.id, error: err.message || String(err) });
            }
          }
          status.skipped.push({
            id: tweet.id,
            user: tweet.username,
            reason: "daily_reply_limit",
          });
        } else if (replyUser && !canSendReply(replyUser, dailyLimit)) {
          status.skipped.push({
            id: tweet.id,
            user: tweet.username,
            reason: "daily_reply_limit",
          });
        }
      }

      await saveState(env.MONEX_KV, state);
      status.processed += 1;
    }

    if (meta?.newest_id && tweets.length > 0) {
      await setPollSinceId(env.MONEX_KV, meta.newest_id);
      status.newSinceId = meta.newest_id;
    }

    await setPollStatus(env.MONEX_KV, status);
    return status;
  } catch (err) {
    status.ok = false;
    status.error = err.message || String(err);
    await setPollStatus(env.MONEX_KV, status);
    throw err;
  }
}

function xKeysConfigured(env) {
  return ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"].every((k) => !!env[k]);
}

function xKeyDiagnostics(env) {
  const apiKey = env.X_API_KEY || "";
  const clientId = env.X_CLIENT_ID || "";
  return {
    apiKeySet: !!apiKey,
    apiSecretSet: !!env.X_API_SECRET,
    accessTokenSet: !!env.X_ACCESS_TOKEN,
    accessTokenSecretSet: !!env.X_ACCESS_TOKEN_SECRET,
    apiKeyLooksLikeOAuth2ClientId:
      !!clientId && !!apiKey && timingSafeEqual(apiKey, clientId),
  };
}

async function handleRequest(request, env) {
  const cors = buildCorsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === "/api/health") {
      const resetEpoch = await getResetEpoch(env.MONEX_KV);
      return json(
        {
          ok: true,
          service: "monex-cloudflare",
          xPoll: env.ENABLE_X_POLL === "1",
          xKeys: xKeysConfigured(env),
          xOAuth: oauthConfigured(env),
          devAuth: devAuthAllowed(env, request),
          stagingDevAuth: stagingDevAuthEnabled(env),
          bot: env.BOT_USERNAME || "monexmonad",
          codeVersion: API_CODE_VERSION,
          keyCheck: xKeyDiagnostics(env),
          resetEpoch,
          startingMonballs: parseInt(env.STARTING_MONBALLS || "10", 10),
          xReply: env.ENABLE_X_REPLY === "1",
          aiReply: env.ENABLE_AI_REPLY === "1",
        },
        200,
        request,
        env
      );
    }

    if (path === "/api/poll-status" && request.method === "GET") {
      const sinceId = await getPollSinceId(env.MONEX_KV);
      let last = await getPollStatus(env.MONEX_KV);
      const refresh = url.searchParams.get("refresh") === "1";

      if (refresh && env.ENABLE_X_POLL === "1" && xKeysConfigured(env)) {
        try {
          const botUser = await resolveBotUser(env);
          last = {
            at: new Date().toISOString(),
            ok: true,
            ping: true,
            botUsername: botUser.username,
            botId: botUser.id,
          };
          await setPollStatus(env.MONEX_KV, last);
        } catch (err) {
          last = {
            at: new Date().toISOString(),
            ok: false,
            error: err.message || String(err),
          };
          await setPollStatus(env.MONEX_KV, last);
        }
      }

      return json(
        {
          ok: true,
          codeVersion: API_CODE_VERSION,
          xPoll: env.ENABLE_X_POLL === "1",
          xKeys: xKeysConfigured(env),
          keyCheck: xKeyDiagnostics(env),
          sinceId,
          last,
        },
        200,
        request,
        env
      );
    }

    if (path === "/api/admin/grant-monballs" && request.method === "POST") {
      const adminSecret = env.ADMIN_RESET_SECRET;
      if (!adminSecret) {
        return json({ ok: false, error: "ADMIN_RESET_SECRET not configured" }, 503, request, env);
      }
      const body = await request.json().catch(() => ({}));
      const provided = request.headers.get("X-Admin-Secret") || body?.secret || "";
      if (!timingSafeEqual(provided, adminSecret)) {
        return json({ ok: false, error: "unauthorized" }, 401, request, env);
      }
      const username = body?.username || url.searchParams.get("username") || "";
      const amount = body?.amount ?? url.searchParams.get("amount") ?? 100;
      try {
        const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
        const result = await grantMonballs(env.MONEX_KV, username, amount, starting);
        return json(result, 200, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "grant failed" }, 400, request, env);
      }
    }

    if (path === "/api/admin/run-poll" && request.method === "POST") {
      const adminSecret = env.ADMIN_RESET_SECRET;
      if (!adminSecret) {
        return json({ ok: false, error: "ADMIN_RESET_SECRET not configured" }, 503, request, env);
      }
      const body = await request.json().catch(() => ({}));
      const provided = request.headers.get("X-Admin-Secret") || body?.secret || "";
      if (!timingSafeEqual(provided, adminSecret)) {
        return json({ ok: false, error: "unauthorized" }, 401, request, env);
      }
      const resetSinceId = body?.reset === true || url.searchParams.get("reset") === "1";
      try {
        const result = await pollXMentions(env, { resetSinceId });
        return json({ ok: true, result }, 200, request, env);
      } catch (err) {
        const last = await getPollStatus(env.MONEX_KV);
        return json({ ok: false, error: err.message || "poll failed", last }, 500, request, env);
      }
    }

    if (path === "/api/auth/x" && request.method === "GET") {
      if (!oauthConfigured(env)) {
        return json({ ok: false, error: "X OAuth not configured on server" }, 503, request, env);
      }
      await enforceRateLimit(request, env, "auth-x", { limit: 30, windowSec: 60 });
      const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo") || "/");
      const authorizeUrl = await buildXAuthorizeUrl(env, env.MONEX_KV, returnTo);
      return Response.redirect(authorizeUrl, 302);
    }

    if (path === "/api/auth/callback" && request.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthErr = url.searchParams.get("error");
      const frontend = env.FRONTEND_ORIGIN || "https://monexmonad.xyz";

      if (oauthErr || !code || !state) {
        const dest = `${frontend}/?auth_error=${encodeURIComponent(oauthErr || "denied")}`;
        return Response.redirect(dest, 302);
      }

      const pending = await consumeOAuthState(env.MONEX_KV, state);
      if (!pending) {
        const dest = `${frontend}/?auth_error=expired_state`;
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

      const returnTo = sanitizeReturnTo(pending.returnTo || "/");
      const joiner = returnTo.includes("?") ? "&" : "?";
      const dest = `${frontend}${returnTo}${joiner}session=${encodeURIComponent(token)}`;
      return Response.redirect(dest, 302);
    }

    if (path === "/api/auth/me" && request.method === "GET") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      return json(
        {
          ok: true,
          user: {
            xUserId: auth.session.xUserId,
            username: auth.session.username,
            name: auth.session.name,
            profileImageUrl: auth.session.profileImageUrl,
          },
        },
        200,
        request,
        env
      );
    }

    if (path === "/api/auth/logout" && request.method === "POST") {
      const auth = await requireSession(request, env.MONEX_KV);
      const gameSessionId = getGameSessionIdFromRequest(request);
      if (auth.ok && gameSessionId) {
        await releaseGameSession(env.MONEX_KV, auth.session.xUserId, gameSessionId);
      }
      const token = getBearerToken(request);
      await deleteSession(env.MONEX_KV, token);
      return json({ ok: true }, 200, request, env);
    }

    if (path === "/api/game-session/claim" && request.method === "POST") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      const body = await request.json().catch(() => ({}));
      const gameSessionId = body?.gameSessionId || getGameSessionIdFromRequest(request);
      const sessionOpenedAt = getSessionOpenedAtFromRequest(request, body);
      const result = await claimGameSession(env.MONEX_KV, auth.session.xUserId, gameSessionId, {
        sessionOpenedAt,
      });
      const status = result.ok ? 200 : 400;
      return json(result, status, request, env);
    }

    if (path === "/api/game-session/status" && request.method === "GET") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      const gameSessionId =
        url.searchParams.get("gameSessionId") || getGameSessionIdFromRequest(request);
      const sessionOpenedAt = normalizeSessionOpenedAt(
        url.searchParams.get("sessionOpenedAt")
      ) || getSessionOpenedAtFromRequest(request);
      const result = await getGameSessionStatus(env.MONEX_KV, auth.session.xUserId, gameSessionId, {
        sessionOpenedAt,
      });
      const status = result.ok ? 200 : 400;
      return json(result, status, request, env);
    }

    if (path === "/api/game-session/heartbeat" && request.method === "POST") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      const body = await request.json().catch(() => ({}));
      const gameSessionId = body?.gameSessionId || getGameSessionIdFromRequest(request);
      const sessionOpenedAt = getSessionOpenedAtFromRequest(request, body);
      const result = await heartbeatGameSession(env.MONEX_KV, auth.session.xUserId, gameSessionId, {
        sessionOpenedAt,
      });
      const status = result.ok ? 200 : 400;
      return json(result, status, request, env);
    }

    if (path === "/api/game-session/release" && request.method === "POST") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      const body = await request.json().catch(() => ({}));
      const gameSessionId = body?.gameSessionId || getGameSessionIdFromRequest(request);
      const result = await releaseGameSession(env.MONEX_KV, auth.session.xUserId, gameSessionId);
      return json(result, 200, request, env);
    }

    if (path === "/api/auth/dev" && request.method === "POST") {
      if (!devAuthAllowed(env, request)) {
        return json({ ok: false, error: "dev auth disabled" }, 403, request, env);
      }
      await enforceRateLimit(request, env, "auth-dev", { limit: 20, windowSec: 60 });
      const body = await request.json();
      const username = (body?.username || "").trim();
      if (!username) return json({ ok: false, error: "username required" }, 400, request, env);
      const { token, session } = await createDevSession(env.MONEX_KV, username);
      return json(
        {
          ok: true,
          token,
          user: {
            xUserId: session.xUserId,
            username: session.username,
            name: session.name,
          },
        },
        200,
        request,
        env
      );
    }

    if (path === "/api/save" && request.method === "GET") {
      const auth = await requireGameplay(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      const { found, save } = await loadCloudSave(env.MONEX_KV, auth.session.xUserId);
      return json(
        { ok: true, found, save, user: { username: auth.session.username, xUserId: auth.session.xUserId } },
        200,
        request,
        env
      );
    }

    if (path === "/api/save" && request.method === "PUT") {
      const body = await request.json();
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "save-put", { limit: 120, windowSec: 60 });
      const payload = buildSavePayload(body?.save || body, auth.session);
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      try {
        await reconcileMonballsForCloudSave(env.MONEX_KV, auth.session, payload, starting);
        await writeCloudSave(env.MONEX_KV, auth.session.xUserId, payload);
      } catch (err) {
        if (err?.code === "stale_save") {
          return json({ ok: false, error: "stale_save", save: err.existingSave }, 409, request, env);
        }
        throw err;
      }
      return json({ ok: true, savedAt: payload.updatedAt, save: payload }, 200, request, env);
    }

    if (path === "/api/activity" && request.method === "GET") {
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "50", 10));
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const result = await listActivities(env.MONEX_KV, { limit, page, successOnly: true });
      return json({ ok: true, ...result }, 200, request, env);
    }

    if (path === "/api/activity/mine" && request.method === "GET") {
      const auth = await requireGameplay(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      const username = auth.session.username;
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") || "30", 10));
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const result = await listActivities(env.MONEX_KV, { limit, page, username, successOnly: true });
      return json({ ok: true, username, ...result }, 200, request, env);
    }

    if (path === "/api/monballs" && request.method === "GET") {
      const auth = await requireGameplay(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const monballs = await getAuthoritativeMonballs(
        env.MONEX_KV,
        auth.session.xUserId,
        auth.session.username,
        starting
      );
      return json(
        { ok: true, monballs, username: auth.session.username },
        200,
        request,
        env
      );
    }

    if (path === "/api/pending" && request.method === "GET") {
      const auth = await requireGameplay(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const state = await loadState(env.MONEX_KV);
      const result = getPendingForSession(
        state,
        auth.session.xUserId,
        auth.session.username,
        starting
      );
      await saveState(env.MONEX_KV, state);
      return json(
        {
          ok: true,
          username: auth.session.username,
          found: result.found,
          monballs: result.monballs,
          pendingMons: result.pendingMons,
          count: result.pendingMons.length,
        },
        200,
        request,
        env
      );
    }

    if (path === "/api/sync" && request.method === "POST") {
      const body = await request.json();
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "sync", { limit: 60, windowSec: 60 });
      const username = auth.session.username;
      const xUserId = auth.session.xUserId;
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const partyMax = Math.max(1, parseInt(body?.partyMax ?? DEFAULT_PARTY_MAX, 10));
      const boxMax = Math.max(1, parseInt(body?.boxMax ?? DEFAULT_BOX_MAX, 10));

      let syncResult = {
        ok: false,
        added: 0,
        remaining: 0,
        syncedParty: [],
        syncedBox: [],
        monballs: null,
        save: null,
      };

      if (xUserId) {
        syncResult = await withUserSyncLock(xUserId || username, async () => {
          const state = await loadState(env.MONEX_KV);
          const { save } = await loadCloudSave(env.MONEX_KV, xUserId);
          const result = backfillPendingForUser(state, {
            xUserId,
            username,
            save,
            partyMax,
            boxMax,
            startingMonballs: starting,
          });
          await saveState(env.MONEX_KV, state);
          if (result.ok && result.save) {
            await writeCloudSave(env.MONEX_KV, xUserId, result.save, { skipStaleCheck: true });
            await alignCatchMonballsToMerged(env.MONEX_KV, auth.session, result.monballs, starting);
          }
          return result;
        });
      } else {
        const state = await loadState(env.MONEX_KV);
        const slots = syncPendingForSession(
          state,
          null,
          username,
          0,
          0,
          partyMax,
          boxMax,
          starting
        );
        await saveState(env.MONEX_KV, state);
        syncResult = {
          ok: true,
          added: slots.party.length + slots.box.length,
          remaining: slots.remaining,
          syncedParty: slots.party,
          syncedBox: slots.box,
          monballs: slots.monballs,
          save: null,
        };
      }

      return json(
        {
          ok: true,
          username,
          party: syncResult.syncedParty || [],
          box: syncResult.syncedBox || [],
          added: syncResult.added || 0,
          remaining: syncResult.remaining || 0,
          monballs: syncResult.monballs,
          save: syncResult.save || null,
        },
        200,
        request,
        env
      );
    }

    if (path === "/api/simulate-mention" && request.method === "POST") {
      if (!simulateAllowed(env)) {
        return json({ ok: false, error: "simulate disabled" }, 404, request, env);
      }
      await enforceRateLimit(request, env, "simulate", { limit: 30, windowSec: 60 });
      const body = await request.json();
      return handleSimulate(body, env, request);
    }

    if (path === "/api/daily-login/status" && request.method === "GET") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      const { save } = await loadCloudSave(env.MONEX_KV, auth.session.xUserId);
      const status = getDailyLoginStatus(save);
      return json({ ok: true, ...status }, 200, request, env);
    }

    if (path === "/api/daily-login/claim" && request.method === "POST") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      await enforceRateLimit(request, env, "daily-login", { limit: 20, windowSec: 60 });
      try {
        const result = await claimDailyLoginReward(env.MONEX_KV, auth.session);
        const status = result.ok ? 200 : result.error === "cooldown" ? 429 : 400;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "claim failed" }, 500, request, env);
      }
    }

    if (path === "/api/mailbox/claim" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "mailbox-claim", { limit: 60, windowSec: 60 });
      const mailId = body?.mailId || body?.id || "";
      try {
        const result = await claimMailboxItem(env.MONEX_KV, auth.session, mailId);
        const status = result.ok ? 200 : 404;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "claim failed" }, 500, request, env);
      }
    }

    if (path === "/api/catch-card-preview" && request.method === "GET") {
      const url = new URL(request.url);
      const monName = url.searchParams.get("mon") || "Chog";
      const rarity = url.searchParams.get("rarity") || "Rare";
      const previewMon = {
        name: monName,
        rarity,
        level: 1,
        skills: generateSkills(monName, rarity),
      };
      try {
        const png = await renderCatchCardPng(previewMon, env);
        return new Response(png, {
          status: 200,
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=300",
            ...buildCorsHeaders(request, env),
          },
        });
      } catch (err) {
        return json({ ok: false, error: err.message || "preview failed" }, 500, request, env);
      }
    }

    if (path === "/api/admin/reset" && request.method === "POST") {
      if (env.ENABLE_ADMIN_RESET !== "1") {
        return json({ ok: false, error: "admin reset disabled" }, 404, request, env);
      }
      await enforceRateLimit(request, env, "admin-reset", { limit: 10, windowSec: 300 });
      const adminSecret = env.ADMIN_RESET_SECRET;
      if (!adminSecret) {
        return json({ ok: false, error: "ADMIN_RESET_SECRET not configured" }, 503, request, env);
      }
      const body = await request.json().catch(() => ({}));
      const provided = request.headers.get("X-Admin-Secret") || body?.secret || "";
      if (!timingSafeEqual(provided, adminSecret)) {
        return json({ ok: false, error: "unauthorized" }, 401, request, env);
      }
      const result = await resetAllData(env.MONEX_KV);
      return json(
        {
          ok: true,
          message: "All user progress and X wild log cleared. Clients will refresh on next visit.",
          ...result,
        },
        200,
        request,
        env
      );
    }

    return json({ ok: false, error: "not found" }, 404, request, env);
  } catch (err) {
    if (err?.code === "rate_limited") {
      return json(
        { ok: false, error: "rate_limited", retryAfterSec: err.retryAfterSec || 60 },
        429,
        request,
        env
      );
    }
    return json({ ok: false, error: err.message || "server error" }, 500, request, env);
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
