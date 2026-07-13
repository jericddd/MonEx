const PROCESSED_TWEET_PREFIX = "monex:processed:";
const PROCESSED_TWEET_TTL_SECONDS = 60 * 60 * 24 * 90;
const CLAIM_PREFIX = "claim:";

export function processedTweetKey(tweetId) {
  return `${PROCESSED_TWEET_PREFIX}${String(tweetId)}`;
}

function isCompletedMarker(value) {
  if (!value || typeof value !== "string") return false;
  return !value.startsWith(CLAIM_PREFIX);
}

export async function wasTweetProcessedKv(kv, tweetId) {
  if (!kv || !tweetId) return false;
  const raw = await kv.get(processedTweetKey(tweetId));
  return isCompletedMarker(raw);
}

export async function markTweetProcessedKv(kv, tweetId) {
  if (!kv || !tweetId) return;
  await kv.put(processedTweetKey(tweetId), new Date().toISOString(), {
    expirationTtl: PROCESSED_TWEET_TTL_SECONDS,
  });
}

/**
 * Cross-isolate claim: put a unique claim id, then verify we still own the key.
 * Losers of the race see a mismatched value and skip processing.
 */
export async function tryClaimTweetForProcessing(kv, tweetId) {
  if (!kv || !tweetId) return { claimed: false, reason: "invalid_tweet" };
  const key = processedTweetKey(tweetId);
  const existing = await kv.get(key);
  if (existing) {
    return { claimed: false, reason: isCompletedMarker(existing) ? "already_processed" : "in_progress" };
  }

  const claimId = `${CLAIM_PREFIX}${crypto.randomUUID()}`;
  await kv.put(key, claimId, { expirationTtl: PROCESSED_TWEET_TTL_SECONDS });
  const verify = await kv.get(key);
  if (verify !== claimId) {
    return { claimed: false, reason: "lost_race" };
  }
  return { claimed: true, claimId };
}

export async function finalizeTweetProcessed(kv, tweetId) {
  await markTweetProcessedKv(kv, tweetId);
}

export async function releaseTweetClaim(kv, tweetId) {
  if (!kv || !tweetId) return;
  const key = processedTweetKey(tweetId);
  const existing = await kv.get(key);
  if (existing?.startsWith?.(CLAIM_PREFIX)) {
    await kv.delete(key);
  }
}
