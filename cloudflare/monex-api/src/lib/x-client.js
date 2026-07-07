import { TwitterApi } from "twitter-api-v2";

export function createXClient(env) {
  const required = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}. Copy x-bot/.env.example → .env`);
  }

  return new TwitterApi({
    appKey: env.X_API_KEY,
    appSecret: env.X_API_SECRET,
    accessToken: env.X_ACCESS_TOKEN,
    accessSecret: env.X_ACCESS_TOKEN_SECRET,
  });
}

export async function resolveBotUser(client) {
  const me = await client.v2.me({ "user.fields": ["username", "id"] });
  return me.data;
}

export async function fetchMentions(client, botUserId, sinceId) {
  const params = {
    max_results: 50,
    "tweet.fields": ["author_id", "created_at", "conversation_id", "in_reply_to_user_id"],
    expansions: ["author_id"],
    "user.fields": ["username"],
  };
  if (sinceId) params.since_id = sinceId;

  const res = await client.v2.userMentionTimeline(botUserId, params);
  return mapMentionResults(res);
}

/** Backup source: recent search for @bot catch (helps surface reply mentions). */
export async function fetchCatchMentionSearch(client, botUsername, sinceId) {
  const bot = (botUsername || "monexmonad").replace("@", "");
  const query = `@${bot} catch -is:retweet`;
  const params = {
    max_results: 50,
    "tweet.fields": ["author_id", "created_at", "conversation_id", "in_reply_to_user_id"],
    expansions: ["author_id"],
    "user.fields": ["username"],
  };
  if (sinceId) params.since_id = sinceId;

  const res = await client.v2.search(query, params);
  return mapMentionResults(res);
}

function mapMentionResults(res) {
  const users = {};
  (res.includes?.users || []).forEach((u) => {
    users[u.id] = u.username;
  });

  const tweets = (res.data?.data || [])
    .map((t) => ({
      id: t.id,
      text: t.text,
      authorId: t.author_id,
      username: users[t.author_id] || "player",
      inReplyToUserId: t.in_reply_to_user_id || null,
    }))
    .reverse();

  return { tweets, meta: res.data?.meta };
}

export function mergeMentionTweets(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const tweet of group || []) {
      if (!tweet?.id) continue;
      byId.set(tweet.id, tweet);
    }
  }
  return [...byId.values()].sort((a, b) => {
    try {
      return Number(BigInt(a.id) - BigInt(b.id));
    } catch {
      return String(a.id).localeCompare(String(b.id));
    }
  });
}

export async function postReply(client, text, inReplyToTweetId, dryRun) {
  if (dryRun) {
    console.log("\n--- DRY RUN REPLY ---\n" + text + "\n---------------------\n");
    return { dryRun: true };
  }

  const res = await client.v2.tweet({
    text: text.slice(0, 280),
    reply: { in_reply_to_tweet_id: inReplyToTweetId },
  });
  return res.data;
}
