import { xApiGet, xApiPost } from "./x-oauth-fetch.js";

const MENTION_FIELDS = {
  max_results: "50",
  "tweet.fields": "author_id,created_at,conversation_id,in_reply_to_user_id",
  expansions: "author_id",
  "user.fields": "username",
};

export function assertXKeys(env) {
  const required = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

export async function resolveBotUser(env) {
  assertXKeys(env);
  const data = await xApiGet(env, "/users/me", { "user.fields": "username,id" });
  return data.data;
}

export async function fetchMentions(env, botUserId, sinceId) {
  assertXKeys(env);
  const params = { ...MENTION_FIELDS };
  if (sinceId) params.since_id = sinceId;
  const data = await xApiGet(env, `/users/${botUserId}/mentions`, params);
  return mapMentionResults(data);
}

/** Backup source: recent search for @bot catch (helps surface reply mentions). */
export async function fetchCatchMentionSearch(env, botUsername, sinceId) {
  assertXKeys(env);
  const bot = (botUsername || "monexmonad").replace("@", "");
  const params = {
    ...MENTION_FIELDS,
    query: `@${bot} catch -is:retweet`,
  };
  if (sinceId) params.since_id = sinceId;
  const data = await xApiGet(env, "/tweets/search/recent", params);
  return mapMentionResults(data);
}

function mapMentionResults(data) {
  const users = {};
  (data.includes?.users || []).forEach((u) => {
    users[u.id] = u.username;
  });

  const tweets = (data.data || [])
    .map((t) => ({
      id: t.id,
      text: t.text,
      authorId: t.author_id,
      username: users[t.author_id] || "player",
      inReplyToUserId: t.in_reply_to_user_id || null,
    }))
    .reverse();

  return { tweets, meta: data.meta };
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

/** Post a reply tweet as @monexmonad (requires X app Read+Write + OAuth 1.0a keys). */
export async function postReply(env, text, inReplyToTweetId) {
  assertXKeys(env);
  if (!inReplyToTweetId) throw new Error("inReplyToTweetId required");
  const data = await xApiPost(env, "/tweets", {
    text: String(text).slice(0, 280),
    reply: { in_reply_to_tweet_id: String(inReplyToTweetId) },
  });
  return data.data;
}
