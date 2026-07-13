import test from "node:test";
import assert from "node:assert/strict";
import {
  processedTweetKey,
  wasTweetProcessedKv,
  markTweetProcessedKv,
  tryClaimTweetForProcessing,
  finalizeTweetProcessed,
  releaseTweetClaim,
} from "./tweet-dedupe.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
    async delete(key) {
      delete store[key];
    },
  };
}

test("tweet dedupe keys are independent per tweet id", async () => {
  const store = {};
  const kv = {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
  };

  assert.equal(await wasTweetProcessedKv(kv, "123"), false);
  await markTweetProcessedKv(kv, "123");
  assert.equal(await wasTweetProcessedKv(kv, "123"), true);
  assert.equal(await wasTweetProcessedKv(kv, "456"), false);
  assert.equal(processedTweetKey("123"), "monex:processed:123");
});

test("tryClaimTweetForProcessing grants exactly one winner under contention", async () => {
  const kv = makeKv();
  const [a, b] = await Promise.all([
    tryClaimTweetForProcessing(kv, "tweet_1"),
    tryClaimTweetForProcessing(kv, "tweet_1"),
  ]);
  const winners = [a, b].filter((r) => r.claimed);
  assert.equal(winners.length, 1);
  assert.equal([a, b].filter((r) => !r.claimed).length, 1);
});

test("finalizeTweetProcessed marks tweet complete and blocks re-claim", async () => {
  const kv = makeKv();
  const claim = await tryClaimTweetForProcessing(kv, "tweet_2");
  assert.equal(claim.claimed, true);
  await finalizeTweetProcessed(kv, "tweet_2");
  assert.equal(await wasTweetProcessedKv(kv, "tweet_2"), true);
  const retry = await tryClaimTweetForProcessing(kv, "tweet_2");
  assert.equal(retry.claimed, false);
});

test("releaseTweetClaim allows retry after processing failure", async () => {
  const kv = makeKv();
  const claim = await tryClaimTweetForProcessing(kv, "tweet_3");
  assert.equal(claim.claimed, true);
  await releaseTweetClaim(kv, "tweet_3");
  const retry = await tryClaimTweetForProcessing(kv, "tweet_3");
  assert.equal(retry.claimed, true);
});
