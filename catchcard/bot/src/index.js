import { processMentionTweet } from "./process-mention.js";
import {
  tryClaimTweetForProcessing,
  finalizeTweetProcessed,
  releaseTweetClaim,
} from "./tweet-dedupe.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "catchcard-bot", rulesVersion: 1 });
    }

    if (url.pathname === "/simulate" && request.method === "POST") {
      const body = await request.json();
      const tweet = {
        id: body.tweetId || `sim_${Date.now()}`,
        text: body.text || "",
        authorId: body.authorId || "sim_user",
        username: body.username || "simuser",
      };
      const result = await handleTweet(tweet, env);
      return Response.json({ tweet, result });
    }

    return new Response("CatchCard bot", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    if (env.ENABLE_X_POLL !== "1") return;
    // TODO: poll X mentions API, dedupe, reply with PNG
    console.log("CatchCard cron tick — X poll not wired yet");
  },
};

async function handleTweet(tweet, env) {
  const kv = env.CATCHCARD_KV;
  const claim = await tryClaimTweetForProcessing(kv, tweet.id);
  if (!claim.claimed) {
    return { skipped: true, reason: claim.reason };
  }

  try {
    const result = await processMentionTweet(tweet, env);
    if (env.ENABLE_X_REPLY === "1" && result.action === "reply") {
      // TODO: post reply via X API v2 (text + cardSvg upload)
      console.log("Would reply:", result.text?.slice(0, 120));
    }
    await finalizeTweetProcessed(kv, tweet.id);
    return result;
  } catch (err) {
    await releaseTweetClaim(kv, tweet.id);
    throw err;
  }
}

export { handleTweet };
