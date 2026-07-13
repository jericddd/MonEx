const PROCESSED_TWEET_PREFIX = "monex:processed:";
const PROCESSED_TWEET_TTL_SECONDS = 60 * 60 * 24 * 90;

export function processedTweetKey(tweetId) {
  return `${PROCESSED_TWEET_PREFIX}${String(tweetId)}`;
}

export async function wasTweetProcessedKv(kv, tweetId) {
  if (!kv || !tweetId) return false;
  return !!(await kv.get(processedTweetKey(tweetId)));
}

export async function markTweetProcessedKv(kv, tweetId) {
  if (!kv || !tweetId) return;
  await kv.put(processedTweetKey(tweetId), new Date().toISOString(), {
    expirationTtl: PROCESSED_TWEET_TTL_SECONDS,
  });
}
