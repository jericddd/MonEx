import { runCatchSession, formatSkillsShort, MIN_MONBALLS } from "./catch-engine.js";
import { parseMention } from "./parse-mention.js";
import { getUser, addPendingMons } from "./store.js";
import { makeActivityId } from "./activity-log.js";

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
export function processMentionTweet(tweet, botUsername, state, startingMonballs) {
  const parsed = parseMention(tweet.text, botUsername);

  if (parsed.type === "ignore") {
    return { parsed, activity: null, state };
  }

  if (parsed.type === "invalid_denom") {
    return {
      parsed,
      activity: null,
      state,
      skipReason: "invalid_denom",
    };
  }

  if (parsed.type === "catch") {
    const user = getUser(state, tweet.authorId, tweet.username, startingMonballs);

    if (user.monballs < MIN_MONBALLS || user.monballs < parsed.spend) {
      return {
        parsed,
        activity: null,
        state,
        skipReason: "insufficient",
        monballs: user.monballs,
      };
    }

    user.monballs -= parsed.spend;
    const { throws, results } = runCatchSession(parsed.spend);
    const { caught, escaped, highlights, mons } = summarizeResults(results);
    const caughtMons = caught.map((r) => r.mon).slice(0, throws);
    addPendingMons(user, caughtMons);

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
      mons: mons.slice(0, throws),
      monballsLeft: user.monballs,
      status: "success",
      at: new Date().toISOString(),
    };

    return { parsed, activity, state };
  }

  return { parsed, activity: null, state };
}
