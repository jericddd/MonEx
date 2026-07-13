import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withUserSyncLock } from "../kv-store.js";
import { processMentionTweet } from "./process-mention.js";
import { resolveCatchUserKv, saveCatchUserRecord } from "./catch-user-store.js";

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

describe("catch spend race mitigation", () => {
  it("serializes two catch tweets for the same user under per-user lock", async () => {
    const kv = makeKv({
      "monex:catch-user:u1": JSON.stringify({
        username: "daniel_freire15",
        monballs: 5,
        pendingMons: [],
        updatedAt: new Date(0).toISOString(),
      }),
      "monex:catch-username:daniel_freire15": "u1",
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
        const user = await resolveCatchUserKv(kv, "u1", "Daniel_Freire15", 10);
        const result = processMentionTweet(tweetA, "monexmonad", user, 10, "bot");
        if (result.activity) await saveCatchUserRecord(kv, "u1", user);
        results.push(result);
      }),
      withUserSyncLock("daniel_freire15", async () => {
        const user = await resolveCatchUserKv(kv, "u1", "Daniel_Freire15", 10);
        const result = processMentionTweet(tweetB, "monexmonad", user, 10, "bot");
        if (result.activity) await saveCatchUserRecord(kv, "u1", user);
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
