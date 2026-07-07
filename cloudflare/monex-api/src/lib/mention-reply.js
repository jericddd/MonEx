import {
  buildNaturalCatchReply,
  buildNaturalInvalidDenomReply,
  buildNaturalInsufficientReply,
  getReplySeed,
} from "./natural-reply.js";

export function buildMentionReplyText(result, tweet, _env) {
  const username = tweet.username || "player";
  const seed = getReplySeed(tweet);

  if (result.activity) {
    return buildNaturalCatchReply({
      username,
      monballSpend: result.activity.spend,
      results: result.catchResults || [],
      monballsLeft: result.activity.monballsLeft,
      seed,
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
