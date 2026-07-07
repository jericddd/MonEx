import {
  buildNaturalCatchReply,
  buildNaturalInvalidDenomReply,
  buildNaturalInsufficientReply,
  getReplySeed,
} from "./natural-reply.js";
import { tryAiMentionReply } from "./ai-reply.js";

export async function buildMentionReplyText(result, tweet, env) {
  const username = tweet.username || "player";
  const seed = getReplySeed(tweet);

  const aiText = await tryAiMentionReply(result, tweet, env);
  if (aiText) return aiText;

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
