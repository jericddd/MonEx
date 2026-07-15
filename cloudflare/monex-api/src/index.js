import { processMentionTweet } from "./lib/process-mention.js";
import { parseMention } from "./lib/parse-mention.js";
import {
  appendActivity,
  listActivities,
  getPollSinceId,
  setPollSinceId,
  clearPollSinceId,
  getPollStatus,
  setPollStatus,
  resetAllData,
  withUserSyncLock,
  userSyncLockKey,
  DEFAULT_PARTY_MAX,
  DEFAULT_BOX_MAX,
  getResetEpoch,
} from "./kv-store.js";
import {
  canSendReply,
  recordReplySent,
  getReplyCountToday,
  wasLimitNoticeSentToday,
  markLimitNoticeSent,
} from "./lib/reply-tracker.js";
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
import { loadCloudSave, writeCloudSave, buildSavePayload, preserveServerAuthoritativeFields } from "./lib/save.js";
import { grantMonballs, alignCatchMonballsToMerged } from "./lib/grant-monballs.js";
import { resolveMergedMonballs, reconcileMonballsForCloudSave, syncSaveMonballsAfterCatch, getAuthoritativeMonballs, seedOrHydrateCloudSaveFromCatch } from "./lib/save-reconcile.js";
import { reconcileUnpaidMonballQuestGrants } from "./lib/quest-monball-grants.js";
import { reconcileOneTimeDailyQuestReset } from "./lib/quest-one-time-reset.js";
import { guardSavePayload } from "./lib/save-economy-guard.js";
import { claimQuestTask, claimQuestChest } from "./lib/quest-claim.js";
import { purchaseShopItem } from "./lib/shop-purchase.js";
import { listMonballPackages, purchaseMonballPackage, publicPackageView } from "./lib/monball-packages.js";
import { listGoldPackages, purchaseGoldPackage, publicGoldPackageView } from "./lib/gold-packages.js";
import { collectResourceChest } from "./lib/resource-chest.js";
import { claimBattleReward } from "./lib/battle-reward.js";
import { releaseMonFromBox } from "./lib/release-mon.js";
import {
  resolveCatchUserKv,
  saveCatchUserRecord,
  getPendingForCatchUserKv,
} from "./lib/catch-user-store.js";
import { backfillPendingForCatchUser } from "./lib/backfill-pending.js";
import {
  hydrateUserCloudSave,
  lookupCatchUserReadOnly,
  recoverMissingMonsFromActivity,
} from "./lib/hydrate-save.js";
import { listReleaseLog } from "./lib/release-log.js";
import { tryClaimTweetForProcessing, finalizeTweetProcessed, releaseTweetClaim } from "./lib/tweet-dedupe.js";
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
import { commitCatchTransaction, retryPendingCatchDeliveries } from "./lib/catch-commit.js";
import { claimCatchFromLog, enrichActivityEntriesWithReceipts } from "./lib/catch-claim.js";
import { getWalletMonballs } from "./lib/monball-wallet.js";
import {
  buildCorsHeaders,
  enforceRateLimit,
  sanitizeReturnTo,
  simulateAllowed,
  timingSafeEqual,
  parseBoundedInt,
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
    try {
      console.log(JSON.stringify({
        evt: "gameplay_rejected",
        path: new URL(request.url).pathname,
        xUserId: auth.session.xUserId,
        username: auth.session.username,
        gameSessionId: getGameSessionIdFromRequest(request, body),
        error: gs.error,
        reason: gs.reason,
      }));
    } catch (_) {}
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

  const user = await resolveCatchUserKv(env.MONEX_KV, authorId, username, starting);
  const replyToBot = body?.replyToBot === true;
  const walletMonballs = await getWalletMonballs(env.MONEX_KV, authorId, username, starting);

  const result = processMentionTweet(
    { id: tweetId, text, authorId, username, inReplyToUserId: replyToBot ? "bot" : null },
    bot,
    user,
    starting,
    replyToBot ? "bot" : null,
    { walletMonballs, deliveryModel: "claim" }
  );
  if (result.activity) {
    await commitCatchTransaction(env.MONEX_KV, {
      tweet: { id: tweetId, authorId, username },
      catchUser: user,
      processResult: result,
      startingMonballs: starting,
    });
  }

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
      const lockKey = userSyncLockKey(tweet.authorId, tweet.username);
      await withUserSyncLock(lockKey, async () => {
      const claim = await tryClaimTweetForProcessing(env.MONEX_KV, tweet.id);
      if (!claim.claimed) {
        status.skipped.push({ id: tweet.id, reason: claim.reason || "already_processed" });
        return;
      }

      const user = await resolveCatchUserKv(
        env.MONEX_KV,
        tweet.authorId,
        tweet.username,
        starting
      );

      let result;
      try {
        const walletMonballs = await getWalletMonballs(
          env.MONEX_KV,
          tweet.authorId,
          tweet.username,
          starting
        );
        result = processMentionTweet(tweet, bot, user, starting, botUser.id, {
          walletMonballs,
          deliveryModel: "claim",
        });
      } catch (err) {
        await releaseTweetClaim(env.MONEX_KV, tweet.id);
        status.errors = status.errors || [];
        status.errors.push({ id: tweet.id, error: err.message || String(err) });
        return;
      }

      if (result.activity) {
        try {
          const committed = await commitCatchTransaction(env.MONEX_KV, {
            tweet,
            catchUser: user,
            processResult: result,
            startingMonballs: starting,
          });
          if (committed.activity) {
            status.activities += 1;
          }
          if (committed.delivery) {
            status.deliveries = status.deliveries || [];
            status.deliveries.push({
              tweetId: tweet.id,
              catchId: committed.receipt?.catchId,
              deliveryStatus: committed.delivery.deliveryStatus,
              completionStatus: committed.delivery.completionStatus,
            });
          }
        } catch (commitErr) {
          status.errors = status.errors || [];
          status.errors.push({
            id: tweet.id,
            error: commitErr.message || String(commitErr),
            phase: "catch_commit",
          });
          await releaseTweetClaim(env.MONEX_KV, tweet.id);
          return;
        }
      } else if (result.skipReason) {
        status.skipped.push({ id: tweet.id, user: tweet.username, reason: result.skipReason });
        if (user) {
          await saveCatchUserRecord(env.MONEX_KV, tweet.authorId, user);
        }
      }

      if (env.ENABLE_X_REPLY === "1") {
        const replyUser = user;
        const dailyLimit = getDailyReplyLimitForUser(tweet.username, env);
        const usedToday = await getReplyCountToday(env.MONEX_KV, tweet.authorId, replyUser);
        const repliesLeftAfter = dailyLimit - usedToday - 1;
        const mayReply = await canSendReply(env.MONEX_KV, tweet.authorId, dailyLimit, replyUser);

        if (replyUser && mayReply) {
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
              await recordReplySent(env.MONEX_KV, tweet.authorId, replyUser);
              if (repliesLeftAfter <= 0) {
                await markLimitNoticeSent(env.MONEX_KV, tweet.authorId);
              }
              status.replies += 1;
            } catch (err) {
              status.replyErrors = status.replyErrors || [];
              status.replyErrors.push({ id: tweet.id, error: err.message || String(err) });
            }
          }
        } else if (replyUser && result.activity && !mayReply) {
          if (!(await wasLimitNoticeSentToday(env.MONEX_KV, tweet.authorId, replyUser))) {
            const notice = buildDailyLimitNoticeReply(
              tweet.username,
              dailyLimit,
              getReplySeed(tweet)
            );
            try {
              await postReply(env, notice, tweet.id);
              await markLimitNoticeSent(env.MONEX_KV, tweet.authorId);
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
        } else if (replyUser && !mayReply) {
          status.skipped.push({
            id: tweet.id,
            user: tweet.username,
            reason: "daily_reply_limit",
          });
        }
      }

      await finalizeTweetProcessed(env.MONEX_KV, tweet.id);
      status.processed += 1;
      });
    }

    const pollHadErrors = Array.isArray(status.errors) && status.errors.length > 0;
    if (!pollHadErrors && meta?.newest_id && tweets.length > 0) {
      await setPollSinceId(env.MONEX_KV, meta.newest_id);
      status.newSinceId = meta.newest_id;
    } else if (!pollHadErrors && meta?.newest_id && status.processed === 0 && status.skipped.length > 0) {
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

function isAdminDiagnosticsRequest(request, env) {
  if (env.ENABLE_ADMIN_RESET !== "1") return false;
  const adminSecret = env.ADMIN_RESET_SECRET;
  if (!adminSecret) return false;
  const provided = request.headers.get("X-Admin-Secret") || "";
  return timingSafeEqual(provided, adminSecret);
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
      const publicHealth = {
        ok: true,
        service: "monex-cloudflare",
        xOAuth: oauthConfigured(env),
        resetEpoch,
      };
      if (!isAdminDiagnosticsRequest(request, env)) {
        return json(publicHealth, 200, request, env);
      }
      return json(
        {
          ...publicHealth,
          xPoll: env.ENABLE_X_POLL === "1",
          xKeys: xKeysConfigured(env),
          devAuth: devAuthAllowed(env, request),
          stagingDevAuth: stagingDevAuthEnabled(env),
          bot: env.BOT_USERNAME || "monexmonad",
          codeVersion: API_CODE_VERSION,
          keyCheck: xKeyDiagnostics(env),
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
      if (!isAdminDiagnosticsRequest(request, env)) {
        return json({ ok: true }, 200, request, env);
      }
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
      if (env.ENABLE_ADMIN_RESET !== "1") {
        return json({ ok: false, error: "admin disabled" }, 404, request, env);
      }
      await enforceRateLimit(request, env, "admin-grant", { limit: 20, windowSec: 60 });
      const adminSecret = env.ADMIN_RESET_SECRET;
      if (!adminSecret) {
        return json({ ok: false, error: "ADMIN_RESET_SECRET not configured" }, 503, request, env);
      }
      const body = await request.json().catch(() => ({}));
      const provided = request.headers.get("X-Admin-Secret") || "";
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
      if (env.ENABLE_ADMIN_RESET !== "1") {
        return json({ ok: false, error: "admin disabled" }, 404, request, env);
      }
      await enforceRateLimit(request, env, "admin-poll", { limit: 10, windowSec: 60 });
      const adminSecret = env.ADMIN_RESET_SECRET;
      if (!adminSecret) {
        return json({ ok: false, error: "ADMIN_RESET_SECRET not configured" }, 503, request, env);
      }
      const body = await request.json().catch(() => ({}));
      const provided = request.headers.get("X-Admin-Secret") || "";
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

      let token;
      try {
        const tokenData = await exchangeXCode(env, code, pending.codeVerifier);
        const xUser = await fetchXUser(tokenData.access_token);
        ({ token } = await createSession(env.MONEX_KV, {
          xUserId: xUser.id,
          username: xUser.username,
          name: xUser.name,
          profileImageUrl: xUser.profile_image_url,
        }));
      } catch (err) {
        // Never surface X API error bodies to the browser; log server-side only.
        console.error("[oauth] callback failed:", err?.message || err);
        return Response.redirect(`${frontend}/?auth_error=login_failed`, 302);
      }

      const returnTo = sanitizeReturnTo(pending.returnTo || "/");
      const joiner = returnTo.includes("?") ? "&" : "?";
      // Session token is delivered in the URL fragment (not the query string) so
      // it is not sent to servers, logged in access logs, or leaked via Referer.
      // auth-client.js reads it from the hash and immediately clears it.
      const dest = `${frontend}${returnTo}${joiner}auth=1#session=${encodeURIComponent(token)}`;
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
      await enforceRateLimit(request, env, "game-session-claim", { limit: 30, windowSec: 60 });
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
      await enforceRateLimit(request, env, "game-session-status", { limit: 120, windowSec: 60 });
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
      await enforceRateLimit(request, env, "game-session-heartbeat", { limit: 180, windowSec: 60 });
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
      await enforceRateLimit(request, env, "game-session-release", { limit: 60, windowSec: 60 });
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
      const body = await request.json().catch(() => null);
      if (!body) return json({ ok: false, error: "invalid_json" }, 400, request, env);
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
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const { found, corrupt, save: loadedSave } = await loadCloudSave(env.MONEX_KV, auth.session.xUserId);
      if (corrupt) {
        console.error(JSON.stringify({ evt: "save_load_corrupt", xUserId: auth.session.xUserId }));
        return json({ ok: false, error: "save_corrupt" }, 500, request, env);
      }

      const catchUser = await lookupCatchUserReadOnly(
        env.MONEX_KV,
        auth.session.xUserId,
        auth.session.username,
        starting
      );
      let save = loadedSave;
      if (found && loadedSave) {
        save = await reconcileUnpaidMonballQuestGrants(
          env.MONEX_KV,
          auth.session,
          loadedSave,
          starting
        );
        save = await reconcileOneTimeDailyQuestReset(env.MONEX_KV, auth.session, save);
      }
      const monballs = resolveMergedMonballs(
        catchUser,
        save,
        catchUser?.monballs ?? save?.monballs ?? starting
      );
      save = { ...save, monballs };

      return json(
        { ok: true, found, save, user: { username: auth.session.username, xUserId: auth.session.xUserId } },
        200,
        request,
        env
      );
    }

    if (path === "/api/hydrate" && request.method === "POST") {
      const auth = await requireSession(request, env.MONEX_KV);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status, request, env);
      await enforceRateLimit(request, env, "hydrate", {
        limit: 30,
        windowSec: 60,
        userId: auth.session.xUserId,
      });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      try {
        const result = await hydrateUserCloudSave(
          env.MONEX_KV,
          auth.session.xUserId,
          auth.session.username,
          starting
        );
        return json(result, 200, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "hydrate failed" }, 500, request, env);
      }
    }

    if (path === "/api/save" && request.method === "PUT") {
      const body = await request.json().catch(() => null);
      if (!body) return json({ ok: false, error: "invalid_json" }, 400, request, env);
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "save-put", { limit: 120, windowSec: 60, userId: auth.session.xUserId });
      const payload = buildSavePayload(body?.save || body, auth.session);
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const baseRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : null;
      let saved;
      try {
        const { save: existingSave, found: saveFound } = await loadCloudSave(env.MONEX_KV, auth.session.xUserId);
        const currentRevision = Number.isFinite(Number(existingSave?.revision))
          ? Math.max(0, Math.floor(Number(existingSave.revision)))
          : 0;
        if (saveFound && currentRevision > 0 && baseRevision == null) {
          return json(
            { ok: false, error: "revision_required", revision: currentRevision },
            400,
            request,
            env
          );
        }
        // Server-authoritative fields (mailbox, daily-login cooldown) are never
        // taken from the client payload — only trusted endpoints mutate them.
        preserveServerAuthoritativeFields(payload, existingSave);
        Object.assign(payload, guardSavePayload(existingSave, payload));
        await reconcileMonballsForCloudSave(env.MONEX_KV, auth.session, payload, starting);
        saved = await writeCloudSave(env.MONEX_KV, auth.session.xUserId, payload, {
          expectedRevision: baseRevision,
        });
      } catch (err) {
        if (err?.code === "stale_save" || err?.code === "revision_conflict") {
          try {
            console.log(JSON.stringify({
              evt: "save_put_conflict",
              xUserId: auth.session.xUserId,
              gameSessionId: auth.gameSessionId,
              error: err.code,
              baseRevision,
              currentRevision: err.currentRevision ?? err.existingSave?.revision,
              incomingUpdatedAt: payload.updatedAt,
              existingUpdatedAt: err.existingSave?.updatedAt,
            }));
          } catch (_) {}
          return json(
            {
              ok: false,
              error: err.code,
              save: err.existingSave,
              revision: err.currentRevision ?? err.existingSave?.revision,
            },
            409,
            request,
            env
          );
        }
        throw err;
      }
      try {
        console.log(JSON.stringify({
          evt: "save_put_ok",
          xUserId: auth.session.xUserId,
          gameSessionId: auth.gameSessionId,
          baseRevision,
          revision: saved.revision,
          updatedAt: saved.updatedAt,
          monballs: saved.monballs,
          money: saved.money,
        }));
      } catch (_) {}
      return json({ ok: true, savedAt: saved.updatedAt, save: saved, revision: saved.revision }, 200, request, env);
    }

    if (path === "/api/release-mon" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "release-mon", { limit: 60, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      const instanceId = String(body?.instanceId || "").trim();
      try {
        const result = await withUserSyncLock(
          userSyncLockKey(auth.session.xUserId, auth.session.username),
          () => releaseMonFromBox(
            env.MONEX_KV,
            auth.session,
            {
              instanceId,
              expectedRevision,
              releaseToken: body?.releaseToken || null,
            },
            starting
          )
        );
        const status = result.ok
          ? 200
          : result.error === "instance_id_required" || result.error === "mon_not_in_box"
            ? 400
            : result.error === "mon_not_found"
              ? 404
              : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "release failed" }, 500, request, env);
      }
    }

    if (path === "/api/activity" && request.method === "GET") {
      await enforceRateLimit(request, env, "activity-feed", { limit: 120, windowSec: 60 });
      const limit = parseBoundedInt(url.searchParams.get("limit"), { fallback: 50, min: 1, max: 50 });
      const page = parseBoundedInt(url.searchParams.get("page"), { fallback: 1, min: 1, max: 9999 });
      const username = url.searchParams.get("username") || null;
      const result = await listActivities(env.MONEX_KV, { limit, page, username, successOnly: true });
      return json({ ok: true, ...result }, 200, request, env);
    }

    if (path === "/api/activity/mine" && request.method === "GET") {
      const auth = await requireGameplay(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      const username = auth.session.username;
      const limit = parseBoundedInt(url.searchParams.get("limit"), { fallback: 30, min: 1, max: 50 });
      const page = parseBoundedInt(url.searchParams.get("page"), { fallback: 1, min: 1, max: 9999 });
      const result = await listActivities(env.MONEX_KV, { limit, page, username, successOnly: true });
      const entries = await enrichActivityEntriesWithReceipts(env.MONEX_KV, result.entries || []);
      return json({ ok: true, username, ...result, entries }, 200, request, env);
    }

    if (path === "/api/catch/claim" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) {
        return json(
          { ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim },
          auth.status,
          request,
          env
        );
      }
      await enforceRateLimit(request, env, "catch-claim", {
        limit: 60,
        windowSec: 60,
        userId: auth.session.xUserId,
      });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision =
        body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
          ? Number(body.baseRevision)
          : undefined;
      try {
        const result = await claimCatchFromLog(env.MONEX_KV, auth.session, {
          tweetId: body?.tweetId,
          partyCount: body?.partyCount,
          boxCount: body?.boxCount,
          partyMax: body?.partyMax ?? DEFAULT_PARTY_MAX,
          boxMax: body?.boxMax ?? DEFAULT_BOX_MAX,
          expectedRevision,
          startingMonballs: starting,
        });
        const status = result.ok
          ? 200
          : result.error === "insufficient_monballs"
            ? 400
            : result.error === "catch_not_found" || result.error === "forbidden"
              ? 404
              : result.error === "claim_conflict"
                ? 409
                : 400;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "catch claim failed" }, 500, request, env);
      }
    }

    if (path === "/api/releases/mine" && request.method === "GET") {
      const auth = await requireGameplay(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      const limit = parseBoundedInt(url.searchParams.get("limit"), { fallback: 30, min: 1, max: 50 });
      const page = parseBoundedInt(url.searchParams.get("page"), { fallback: 1, min: 1, max: 9999 });
      const { save } = await loadCloudSave(env.MONEX_KV, auth.session.xUserId);
      const result = listReleaseLog(save, { limit, page });
      return json({ ok: true, username: auth.session.username, ...result }, 200, request, env);
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
      const result = await getPendingForCatchUserKv(
        env.MONEX_KV,
        auth.session.xUserId,
        auth.session.username,
        starting
      );
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
      const body = await request.json().catch(() => null);
      if (!body) return json({ ok: false, error: "invalid_json" }, 400, request, env);
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "sync", { limit: 60, windowSec: 60, userId: auth.session.xUserId });
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
        syncResult = await withUserSyncLock(userSyncLockKey(xUserId, username), async () => {
          const retried = await retryPendingCatchDeliveries(
            env.MONEX_KV,
            xUserId,
            username,
            starting,
            {
              partyMax,
              boxMax,
              partyCount: body?.partyCount,
              boxCount: body?.boxCount,
            }
          );
          await alignCatchMonballsToMerged(env.MONEX_KV, auth.session, retried.monballs, starting);
          return {
            ok: retried.ok,
            save: retried.save,
            added: retried.added,
            remaining: retried.remaining,
            monballs: retried.monballs,
            syncedParty: [],
            syncedBox: [],
          };
        });
      } else {
        syncResult = {
          ok: false,
          added: 0,
          remaining: 0,
          syncedParty: [],
          syncedBox: [],
          monballs: null,
          save: null,
          reason: "login_required",
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
      const body = await request.json().catch(() => null);
      if (!body) return json({ ok: false, error: "invalid_json" }, 400, request, env);
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
      await enforceRateLimit(request, env, "daily-login", { limit: 20, windowSec: 60, userId: auth.session.xUserId });
      try {
        const result = await claimDailyLoginReward(env.MONEX_KV, auth.session);
        const status = result.ok ? 200 : result.error === "cooldown" ? 429 : 400;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "claim failed" }, 500, request, env);
      }
    }

    if (path === "/api/quest/claim-task" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "quest-claim", { limit: 60, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      try {
        const result = await claimQuestTask(env.MONEX_KV, auth.session, {
          tab: body?.tab,
          taskId: body?.taskId,
          expectedRevision,
        }, starting);
        const status = result.ok ? 200 : result.error === "progress_insufficient" ? 400 : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "claim failed" }, 500, request, env);
      }
    }

    if (path === "/api/quest/claim-chest" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "quest-claim", { limit: 60, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      try {
        const result = await claimQuestChest(env.MONEX_KV, auth.session, {
          track: body?.track,
          milestone: body?.milestone,
          expectedRevision,
        }, starting);
        const status = result.ok ? 200 : result.error === "points_insufficient" ? 400 : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "claim failed" }, 500, request, env);
      }
    }

    if (path === "/api/shop/monball-packages" && request.method === "GET") {
      await enforceRateLimit(request, env, "monball-packages", { limit: 60, windowSec: 60 });
      const packages = listMonballPackages(env).map(publicPackageView);
      return json({ ok: true, currency: "MONEX", packages }, 200, request, env);
    }

    if (path === "/api/shop/monball-packages/purchase" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "monball-package-purchase", { limit: 30, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      try {
        const result = await purchaseMonballPackage(
          env.MONEX_KV,
          auth.session,
          {
            packageId: body?.packageId,
            expectedRevision,
            paymentProof: body?.paymentProof,
          },
          starting,
          env
        );
        const status = result.ok
          ? 200
          : result.error === "monex_payment_required" || result.error === "monex_payment_unverified"
            ? 402
            : result.error === "invalid_package"
              ? 400
              : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "purchase failed" }, 500, request, env);
      }
    }

    if (path === "/api/shop/gold-packages" && request.method === "GET") {
      await enforceRateLimit(request, env, "gold-packages", { limit: 60, windowSec: 60 });
      const packages = listGoldPackages(env).map(publicGoldPackageView);
      return json({ ok: true, currency: "MONEX", packages }, 200, request, env);
    }

    if (path === "/api/shop/gold-packages/purchase" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "gold-package-purchase", { limit: 30, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      try {
        const result = await purchaseGoldPackage(
          env.MONEX_KV,
          auth.session,
          {
            packageId: body?.packageId,
            expectedRevision,
            paymentProof: body?.paymentProof,
          },
          starting,
          env
        );
        const status = result.ok
          ? 200
          : result.error === "monex_payment_required" || result.error === "monex_payment_unverified"
            ? 402
            : result.error === "invalid_package"
              ? 400
              : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "purchase failed" }, 500, request, env);
      }
    }

    if (path === "/api/shop/purchase" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "shop-purchase", { limit: 60, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      try {
        const result = await purchaseShopItem(env.MONEX_KV, auth.session, {
          itemId: body?.itemId,
          qty: body?.qty,
          expectedRevision,
        }, starting);
        const status = result.ok
          ? 200
          : result.error === "insufficient_funds" || result.error === "invalid_item" || result.error === "item_unavailable"
            ? 400
            : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "purchase failed" }, 500, request, env);
      }
    }

    if (path === "/api/resource-chest/collect" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "resource-chest", { limit: 30, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      try {
        const result = await collectResourceChest(env.MONEX_KV, auth.session, { expectedRevision }, starting);
        const status = result.ok ? 200 : result.error === "chest_empty" ? 400 : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "collect failed" }, 500, request, env);
      }
    }

    if (path === "/api/battle/claim-reward" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "battle-reward", { limit: 120, windowSec: 60, userId: auth.session.xUserId });
      const starting = parseInt(env.STARTING_MONBALLS || "10", 10) || 10;
      const expectedRevision = body?.baseRevision != null && Number.isFinite(Number(body.baseRevision))
        ? Number(body.baseRevision)
        : undefined;
      try {
        const result = await withUserSyncLock(
          userSyncLockKey(auth.session.xUserId, auth.session.username),
          () => claimBattleReward(env.MONEX_KV, auth.session, {
            mode: body?.mode,
            win: body?.win === true,
            encounterId: body?.encounterId,
            claimId: body?.claimId,
            chapter: body?.chapter,
            stage: body?.stage,
            patrolScansDay: body?.patrolScansDay,
            patrolScansUsed: body?.patrolScansUsed,
            expectedRevision,
          }, starting)
        );
        const status = result.ok
          ? 200
          : result.error === "win_required" || result.error === "claim_id_required"
            ? 400
            : 409;
        return json(result, status, request, env);
      } catch (err) {
        return json({ ok: false, error: err.message || "battle reward failed" }, 500, request, env);
      }
    }

    if (path === "/api/mailbox/claim" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const auth = await requireGameplay(request, env, body);
      if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason, canReclaim: auth.canReclaim }, auth.status, request, env);
      await enforceRateLimit(request, env, "mailbox-claim", { limit: 60, windowSec: 60, userId: auth.session.xUserId });
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
      await enforceRateLimit(request, env, "catch-card-preview", { limit: 30, windowSec: 60 });
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
    // Log full detail server-side; return a generic message so internal error
    // strings (library/API messages) never reach clients.
    console.error("[handler]", err?.stack || err?.message || err);
    return json({ ok: false, error: "server_error" }, 500, request, env);
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
