import test from "node:test";
import assert from "node:assert/strict";
import { processedTweetKey, wasTweetProcessedKv, markTweetProcessedKv } from "./tweet-dedupe.js";

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
