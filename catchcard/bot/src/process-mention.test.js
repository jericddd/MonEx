import test from "node:test";
import assert from "node:assert/strict";
import { processMentionTweet } from "./process-mention.js";

const memoryKv = () => {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
};

const baseEnv = (kv) => ({
  CATCHCARD_KV: kv,
  BOT_USERNAME: "catchcard",
});

test("help command", async () => {
  const result = await processMentionTweet(
    { id: "1", text: "@CatchCard help", authorId: "u1", username: "alice" },
    baseEnv(memoryKv())
  );
  assert.equal(result.action, "reply");
  assert.match(result.text, /CatchCard/);
  assert.match(result.text, /mint/);
});

test("link then mint (simulated)", async () => {
  const kv = memoryKv();
  const env = baseEnv(kv);
  const wallet = "0x" + "a".repeat(40);

  const link = await processMentionTweet(
    { id: "2", text: `@CatchCard link ${wallet}`, authorId: "u1", username: "alice" },
    env
  );
  assert.match(link.text, /Linked/);

  const mint = await processMentionTweet(
    { id: "3", text: "@CatchCard mint spark", authorId: "u1", username: "alice" },
    env
  );
  assert.equal(mint.action, "reply");
  assert.match(mint.text, /MINTED!/);
  assert.ok(mint.cardSvg);
});

test("mint requires wallet", async () => {
  const result = await processMentionTweet(
    { id: "4", text: "@CatchCard mint", authorId: "u2", username: "bob" },
    baseEnv(memoryKv())
  );
  assert.match(result.text, /Link a wallet/);
});
