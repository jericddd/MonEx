import { runCatchSession, formatSkillsShort } from "./catch-engine.js";
import { parseMention } from "./parse-mention.js";
import { addPendingMons } from "../kv-store.js";
import { makeActivityId } from "./activity-log.js";
import { trySpendCatchMonballs } from "./catch-spend.js";

function summarizeResults(results) {
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);
  const monSummary = (mon) => ({
    name: mon.name,
    rarity: mon.rarity,
    skills: formatSkillsShort(mon.skills),
  });
  const mons = caught.map((r) => monSummary(r.mon));
  const highlights = mons.slice(0, 3);
  return { caught, escaped, highlights, mons };
}

/**
 * Process a mention — no X reply. Logs successful catch sessions to activity feed.
 */
export function processMentionTweet(tweet, botUsername, user, startingMonballs, botUserId = null) {
  const replyToBot = botUserId != null && String(tweet.inReplyToUserId || "") === String(botUserId);
  const parsed = parseMention(tweet.text, botUsername, { replyToBot });

  if (parsed.type === "ignore") {
    return { parsed, activity: null };
  }

  if (parsed.type === "invalid_denom") {
    return {
      parsed,
      activity: null,
      skipReason: "invalid_denom",
    };
  }

  if (parsed.type === "catch") {
    if (!user) {
      return { parsed, activity: null, skipReason: "no_catch_user" };
    }

    const spendResult = trySpendCatchMonballs(user, parsed.spend);
    if (!spendResult.ok) {
      return {
        parsed,
        activity: null,
        skipReason: spendResult.reason || "insufficient",
        monballs: spendResult.before,
      };
    }
    const { throws, results } = runCatchSession(parsed.spend);
    const { caught, escaped, highlights, mons } = summarizeResults(results);
    const caughtMons = caught.map((r) => r.mon).slice(0, throws);
    const pendingBefore = user.pendingMons.length;
    addPendingMons(user, caughtMons);
    const pendingMonsAdded = user.pendingMons.slice(pendingBefore);
    const monsWithIds = mons.slice(0, throws).map((row, index) => ({
      ...row,
      pendingId: pendingMonsAdded[index]?.pendingId || null,
    }));

    const activity = {
      id: makeActivityId(),
      tweetId: tweet.id,
      xUserId: tweet.authorId,
      xUsername: tweet.username,
      spend: parsed.spend,
      throws,
      caughtCount: Math.min(caughtMons.length, throws),
      escapedCount: escaped.length,
      highlights,
      mons: monsWithIds,
      monballsBefore: spendResult.before,
      monballsLeft: spendResult.after,
      status: "success",
      at: new Date().toISOString(),
    };

    return { parsed, activity, catchResults: results, pendingMonsAdded };
  }

  return { parsed, activity: null };
}
