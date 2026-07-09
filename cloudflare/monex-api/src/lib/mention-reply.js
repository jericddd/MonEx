import {
  buildNaturalCatchReply,
  buildNaturalInvalidDenomReply,
  buildNaturalInsufficientReply,
  getReplySeed,
} from "./natural-reply.js";
import { getDailyReplyLimitForUser } from "./reply-limits.js";

export function buildMentionReplyText(result, tweet, env, quota = {}) {
  const username = tweet.username || "player";
  const seed = getReplySeed(tweet);
  const dailyLimit = Math.max(
    1,
    Number.parseInt(quota.dailyLimit ?? getDailyReplyLimitForUser(username, env), 10)
  );
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
    return buildNaturalInsufficientReply(username, result.monballs ?? 0, result.parsed?.spend ?? 1, seed);
  }

  return null;
}
