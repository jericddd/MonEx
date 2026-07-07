import {
  buildNaturalCatchReply,
  buildNaturalInvalidDenomReply,
  buildNaturalInsufficientReply,
  getReplySeed,
} from "./natural-reply.js";

export function buildMentionReplyText(result, tweet, env, quota = {}) {
  const username = tweet.username || "player";
  const seed = getReplySeed(tweet);
  const dailyLimit = Math.max(1, parseInt(env?.DAILY_REPLY_LIMIT || quota.dailyLimit || "4", 10));
  const repliesLeftAfter = quota.repliesLeftAfter;

  if (result.activity) {
    return buildNaturalCatchReply({
      username,
      monballSpend: result.activity.spend,
      results: result.catchResults || [],
      monballsLeft: result.activity.monballsLeft,
      seed,
      repliesLeftAfter,
      dailyLimit,
    });
  }

  if (result.skipReason === "invalid_denom") {
    return buildNaturalInvalidDenomReply(username, seed);
  }

  if (result.skipReason === "insufficient") {
    return buildNaturalInsufficientReply(username, result.monballs ?? 0, result.parsed?.spend ?? 10, seed);
  }

  return null;
}
