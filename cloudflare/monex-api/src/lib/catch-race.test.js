import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withUserSyncLock } from "../kv-store.js";
import { processMentionTweet } from "./process-mention.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
  };
}

describe("catch spend race mitigation", () => {
  it("serializes two catch tweets for the same user under per-user lock", async () => {
    const kv = makeKv({
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: {
          u1: { username: "daniel_freire15", monballs: 5, pendingMons: [], updatedAt: new Date(0).toISOString() },
        },
      }),
    });

    const tweetA = {
      id: "tweet_a",
      text: "@monexmonad catch 5",
      authorId: "u1",
      username: "Daniel_Freire15",
      inReplyToUserId: null,
    };
    const tweetB = {
      id: "tweet_b",
      text: "@monexmonad catch 5",
      authorId: "u1",
      username: "Daniel_Freire15",
      inReplyToUserId: null,
    };

    const results = [];
    await Promise.all([
      withUserSyncLock("daniel_freire15", async () => {
        const { loadState, saveState } = await import("../kv-store.js");
        const state = await loadState(kv);
        const result = processMentionTweet(tweetA, "monexmonad", state, 10, "bot");
        if (result.activity) await saveState(kv, state);
        results.push(result);
      }),
      withUserSyncLock("daniel_freire15", async () => {
        const { loadState, saveState } = await import("../kv-store.js");
        const state = await loadState(kv);
        const result = processMentionTweet(tweetB, "monexmonad", state, 10, "bot");
        if (result.activity) await saveState(kv, state);
        results.push(result);
      }),
    ]);

    const successes = results.filter((r) => r.activity);
    const failures = results.filter((r) => r.skipReason === "insufficient");
    assert.equal(successes.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(successes[0].activity.monballsLeft, 0);
  });
});
