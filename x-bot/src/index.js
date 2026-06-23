/**
 * Standalone X mention poller — log only, no replies.
 * Prefer: npm run server (with ENABLE_X_POLL=1)
 */
import "dotenv/config";
import { processMentionTweet } from "./process-mention.js";
import {
  loadState,
  saveState,
  wasProcessed,
  markProcessed,
} from "./store.js";
import {
  createXClient,
  resolveBotUser,
  fetchMentions,
} from "./x-client.js";

const env = process.env;
const POLL_MS = parseInt(env.POLL_MS || "45000", 10);
const STARTING_MONBALLS = parseInt(env.STARTING_MONBALLS || "50", 10);
const BOT_USERNAME = env.BOT_USERNAME || "MonEx";

let sinceId = null;

async function handleMention(client, tweet, botUsername) {
  const state = loadState();
  if (wasProcessed(state, tweet.id)) return;

  const result = processMentionTweet(tweet, botUsername, state, STARTING_MONBALLS);
  markProcessed(state, tweet.id);
  saveState(state);

  if (result.activity) {
    console.log(`[log] @${tweet.username} spent ${result.activity.spend} → ${result.activity.caughtCount} caught`);
  } else if (result.parsed?.type === "ignore") {
    // silent
  } else {
    console.log(`[skip] @${tweet.username} ${result.skipReason || result.parsed?.type}`);
  }
}

async function poll(client, botUser) {
  const { tweets, meta } = await fetchMentions(client, botUser.id, sinceId);
  if (meta?.newest_id) sinceId = meta.newest_id;

  for (const tweet of tweets) {
    await handleMention(client, tweet, botUser.username || BOT_USERNAME);
  }

  if (tweets.length === 0) {
    console.log(`[poll] No new mentions (since ${sinceId || "start"})`);
  }
}

async function main() {
  console.log("MonEx X ingest — log only, no replies");
  const client = createXClient(env).readWrite;
  const botUser = await resolveBotUser(client);
  console.log(`Bot: @${botUser.username} (${botUser.id})`);
  console.log(`Polling every ${POLL_MS}ms → activity log`);

  await poll(client, botUser);
  setInterval(() => poll(client, botUser).catch((e) => console.error("[poll error]", e)), POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
