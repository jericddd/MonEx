import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCatchReceipt,
  computeCatchReceiptStatus,
  enrichActivityWithReceipt,
} from "./catch-receipt.js";
import { commitCatchTransaction } from "./catch-commit.js";
import { appendActivity } from "../kv-store.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value, opts) {
      store[key] = value;
      store[`${key}:opts`] = opts;
    },
    async list() {
      return { keys: Object.keys(store).filter((k) => !k.endsWith(":opts")).map((name) => ({ name })) };
    },
  };
}

test("buildCatchReceipt links pendingIds to activity mons", () => {
  const receipt = buildCatchReceipt({
    tweet: { id: "t1", authorId: "u1", username: "trainer" },
    activity: {
      id: "act1",
      spend: 3,
      throws: 3,
      caughtCount: 2,
      monballsBefore: 10,
      monballsLeft: 7,
      at: "2026-07-15T00:00:00.000Z",
    },
    pendingMonsAdded: [
      { pendingId: "p_a", name: "Chog", rarity: "Common", skills: [] },
      { pendingId: "p_b", name: "Mouch", rarity: "Rare", skills: [] },
    ],
  });
  assert.equal(receipt.mons.length, 2);
  assert.equal(receipt.mons[0].pendingId, "p_a");
  assert.equal(receipt.catchId, "catch_t1");
});

test("computeCatchReceiptStatus marks delivered when wildPendingIds present", () => {
  const receipt = buildCatchReceipt({
    tweet: { id: "t1", authorId: "u1", username: "trainer" },
    activity: {
      id: "act1",
      spend: 1,
      throws: 1,
      caughtCount: 1,
      monballsBefore: 5,
      monballsLeft: 4,
      at: "2026-07-15T00:00:00.000Z",
    },
    pendingMonsAdded: [{ pendingId: "p_a", name: "Chog", rarity: "Common", skills: [] }],
  });
  const status = computeCatchReceiptStatus(
    receipt,
    {
      party: [{ name: "Chog", wildPendingId: "p_a" }],
      box: [],
    },
    { pendingMons: [] }
  );
  assert.equal(status.deliveryStatus, "delivered");
  assert.equal(status.mons[0].delivered, true);
  assert.equal(status.mons[0].destination, "party");
});

test("commitCatchTransaction is idempotent per tweetId", async () => {
  const store = {
    "monex:activity": JSON.stringify({ entries: [] }),
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 7,
      pendingMons: [{ pendingId: "p_a", name: "Chog", rarity: "Common", skills: [] }],
      updatedAt: new Date().toISOString(),
    }),
    "monex:save:u1": JSON.stringify({
      revision: 1,
      monballs: 7,
      party: [],
      box: [],
      xHandle: "trainer",
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const tweet = { id: "tw1", authorId: "u1", username: "trainer" };
  const processResult = {
    activity: {
      id: "act1",
      tweetId: "tw1",
      xUserId: "u1",
      xUsername: "trainer",
      spend: 3,
      throws: 1,
      caughtCount: 1,
      escapedCount: 0,
      highlights: [],
      mons: [{ name: "Chog", rarity: "Common", skills: [], pendingId: "p_a" }],
      monballsBefore: 10,
      monballsLeft: 7,
      status: "success",
      at: new Date().toISOString(),
    },
    pendingMonsAdded: [{ pendingId: "p_a", name: "Chog", rarity: "Common", skills: [] }],
  };
  const catchUser = JSON.parse(store["monex:catch-user:u1"]);

  const first = await commitCatchTransaction(kv, {
    tweet,
    catchUser,
    processResult,
    startingMonballs: 10,
  });
  assert.equal(first.ok, true);
  assert.equal(first.receipt.completionStatus, "completed");

  const log = JSON.parse(store["monex:activity"]);
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].mons[0].pendingId, "p_a");

  const second = await commitCatchTransaction(kv, {
    tweet,
    catchUser,
    processResult,
    startingMonballs: 10,
  });
  assert.equal(second.idempotent, true);
  assert.equal(JSON.parse(store["monex:activity"]).entries.length, 1);
});

test("appendActivity dedupes by tweetId", async () => {
  const kv = makeKv({ "monex:activity": JSON.stringify({ entries: [] }) });
  await appendActivity(kv, { tweetId: "t1", status: "success", id: "a1" });
  await appendActivity(kv, { tweetId: "t1", status: "success", id: "a2" });
  const log = JSON.parse(await kv.get("monex:activity"));
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].id, "a1");
});
