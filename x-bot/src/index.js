import "dotenv/config";
import {
  runCatchSession,
  formatCatchReply,
  MIN_MONBALLS,
} from "./catch-engine.js";
import {
  parseMention,
  helpReply,
  invalidDenomReply,
  insufficientReply,
} from "./parse-mention.js";
import {
  loadState,
  saveState,
  wasProcessed,
  markProcessed,
  getUser,
  addPendingMons,
} from "./store.js";
import {
  createXClient,
  resolveBotUser,
  fetchMentions,
  postReply,
} from "./x-client.js";

const env = process.env;
const POLL_MS = parseInt(env.POLL_MS || "45000", 10);
const DRY_RUN = env.DRY_RUN === "1" || env.DRY_RUN === "true";
const STARTING_MONBALLS = parseInt(env.STARTING_MONBALLS || "50", 10);
const GAME_URL = env.GAME_URL || "https://github.com/jericddd/MonEx";
const BOT_USERNAME = env.BOT_USERNAME || "MonEx";

let sinceId = null;

async function handleMention(client, tweet, botUsername) {
  const state = loadState();
  if (wasProcessed(state, tweet.id)) return;

  const parsed = parseMention(tweet.text, botUsername);
  let replyText;

  if (parsed.type === "ignore") {
    markProcessed(state, tweet.id);
    saveState(state);
    return;
  }

  if (parsed.type === "help") {
    replyText = helpReply(tweet.username);
  } else if (parsed.type === "invalid_denom") {
    replyText = invalidDenomReply(tweet.username);
  } else if (parsed.type === "catch") {
    const user = getUser(state, tweet.authorId, tweet.username, STARTING_MONBALLS);

    if (user.monballs < MIN_MONBALLS) {
      replyText = insufficientReply(tweet.username, user.monballs, MIN_MONBALLS);
    } else if (user.monballs < parsed.spend) {
      replyText = insufficientReply(tweet.username, user.monballs, parsed.spend);
    } else {
      user.monballs -= parsed.spend;
      const { results } = runCatchSession(parsed.spend);
      const caughtMons = results.filter((r) => !r.escaped).map((r) => r.mon);
      addPendingMons(user, caughtMons);
      replyText = formatCatchReply({
        username: tweet.username,
        monballSpend: parsed.spend,
        results,
        monballsLeft: user.monballs,
        gameUrl: GAME_URL,
      });
    }
  }

  try {
    await postReply(client, replyText, tweet.id, DRY_RUN);
    markProcessed(state, tweet.id);
    saveState(state);
    console.log(`[reply] @${tweet.username} tweet ${tweet.id} (${parsed.type})`);
  } catch (err) {
    console.error(`[error] Failed to reply to ${tweet.id}:`, err.message);
  }
}

async function poll(client, botUser) {
  const { tweets, meta } = await fetchMentions(client, botUser.id, sinceId);

  if (meta?.newest_id) {
    sinceId = meta.newest_id;
  }

  for (const tweet of tweets) {
    await handleMention(client, tweet, botUser.username || BOT_USERNAME);
  }

  if (tweets.length === 0) {
    console.log(`[poll] No new mentions (since ${sinceId || "start"})`);
  }
}

async function main() {
  console.log("MonEx X Bot POC starting…");
  if (DRY_RUN) console.log("DRY_RUN=1 — replies will be logged only, not posted.");

  const client = createXClient(env).readWrite;
  const botUser = await resolveBotUser(client);
  console.log(`Bot account: @${botUser.username} (${botUser.id})`);
  console.log(`Catch denominations: 10, 20, 30, 40, 50 Monballs (${MIN_MONBALLS} min balance)`);
  console.log(`Polling every ${POLL_MS}ms`);

  await poll(client, botUser);
  setInterval(() => poll(client, botUser).catch((e) => console.error("[poll error]", e)), POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
