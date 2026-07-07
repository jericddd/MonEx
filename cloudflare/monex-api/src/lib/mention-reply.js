import { formatCatchReply } from "./catch-engine.js";
import { invalidDenomReply, insufficientReply } from "./parse-mention.js";

export function buildMentionReplyText(result, tweet, env) {
  const username = tweet.username || "player";

  if (result.activity) {
    return formatCatchReply({
      username,
      monballSpend: result.activity.spend,
      results: result.catchResults || [],
      monballsLeft: result.activity.monballsLeft,
    });
  }

  if (result.skipReason === "invalid_denom") {
    return invalidDenomReply(username);
  }

  if (result.skipReason === "insufficient") {
    return insufficientReply(username, result.monballs ?? 0, result.parsed?.spend ?? 10);
  }

  return null;
}
