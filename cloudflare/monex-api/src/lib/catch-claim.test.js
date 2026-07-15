import test from "node:test";
import assert from "node:assert/strict";
import { claimCatchFromLog } from "./catch-claim.js";
import { buildCatchReceipt, saveCatchReceipt, catchReceiptKey } from "./catch-receipt.js";
import { commitCatchTransaction } from "./catch-commit.js";
import { processMentionTweet } from "./process-mention.js";
import { recoverMissingMonsFromActivity } from "./hydrate-save.js";
import { hydrateCloudSaveWithCatchState } from "./save-reconcile.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
    async list() {
      return { keys: Object.keys(store).map((name) => ({ name })) };
    },
  };
}

const session = { xUserId: "u1", username: "trainer" };

test("deferred claim dispatches mons without debiting wallet again", async () => {
  const store = {
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 7,
      pendingMons: [
        {
          pendingId: "p_def",
          name: "Chog",
          rarity: "Common",
          skills: [],
          awaitingProfileClaim: true,
          catchTweetId: "tw_def",
        },
      ],
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
  const receipt = buildCatchReceipt({
    tweet: { id: "tw_def", authorId: "u1", username: "trainer" },
    activity: {
      id: "act1",
      spend: 3,
      throws: 1,
      caughtCount: 1,
      monballsBefore: 10,
      monballsLeft: 7,
      at: "2026-07-15T00:00:00.000Z",
    },
    pendingMonsAdded: [{ pendingId: "p_def", name: "Chog", rarity: "Common", skills: [] }],
    claimModel: "deferred",
  });
  receipt.completionStatus = "pending";
  receipt.spendApplied = true;
  receipt.catchLogStatus = "written";
  await saveCatchReceipt(kv, receipt);

  const result = await claimCatchFromLog(kv, session, { tweetId: "tw_def", startingMonballs: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.deferred, true);
  assert.equal(result.added, 1);
  assert.equal(result.monballs, 7);

  const save = JSON.parse(store["monex:save:u1"]);
  assert.equal(save.monballs, 7);
  assert.equal(save.party.length + save.box.length, 1);

  const savedReceipt = JSON.parse(store[catchReceiptKey("tw_def")]);
  assert.equal(savedReceipt.completionStatus, "completed");
  assert.equal(savedReceipt.spendApplied, true);
});

test("legacy claim delivers without debiting wallet again", async () => {
  const store = {
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 7,
      pendingMons: [{ pendingId: "p_leg", name: "Mouch", rarity: "Common", skills: [] }],
      updatedAt: new Date().toISOString(),
    }),
    "monex:save:u1": JSON.stringify({
      revision: 2,
      monballs: 7,
      party: [],
      box: [],
      xHandle: "trainer",
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const receipt = buildCatchReceipt({
    tweet: { id: "tw_leg", authorId: "u1", username: "trainer" },
    activity: {
      id: "act2",
      spend: 3,
      throws: 1,
      caughtCount: 1,
      monballsBefore: 10,
      monballsLeft: 7,
      at: "2026-07-15T00:00:00.000Z",
    },
    pendingMonsAdded: [{ pendingId: "p_leg", name: "Mouch", rarity: "Common", skills: [] }],
    claimModel: "legacy",
  });
  receipt.completionStatus = "pending";
  receipt.catchLogStatus = "written";
  await saveCatchReceipt(kv, receipt);

  const result = await claimCatchFromLog(kv, session, { tweetId: "tw_leg", startingMonballs: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.monballs, 7);
  assert.equal(result.added, 1);

  const save = JSON.parse(store["monex:save:u1"]);
  assert.equal(save.monballs, 7);
});

test("claim is idempotent when already completed", async () => {
  const store = {
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 5,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:save:u1": JSON.stringify({
      revision: 3,
      monballs: 5,
      party: [{ name: "Chog", wildPendingId: "p_done" }],
      box: [],
      xHandle: "trainer",
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const receipt = buildCatchReceipt({
    tweet: { id: "tw_done", authorId: "u1", username: "trainer" },
    activity: {
      id: "act3",
      spend: 1,
      throws: 1,
      caughtCount: 1,
      monballsBefore: 6,
      monballsLeft: 5,
      at: "2026-07-15T00:00:00.000Z",
    },
    pendingMonsAdded: [{ pendingId: "p_done", name: "Chog", rarity: "Common", skills: [] }],
    claimModel: "legacy",
  });
  receipt.completionStatus = "completed";
  receipt.catchLogStatus = "written";
  await saveCatchReceipt(kv, receipt);

  const result = await claimCatchFromLog(kv, session, { tweetId: "tw_done", startingMonballs: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyClaimed, true);
  assert.equal(result.monballs, 5);
});

test("deferred commit spends monballs immediately and stages mons for claim", async () => {
  const store = {
    "monex:activity": JSON.stringify({ entries: [] }),
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 10,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:save:u1": JSON.stringify({
      revision: 1,
      monballs: 10,
      party: [],
      box: [],
      xHandle: "trainer",
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const user = JSON.parse(store["monex:catch-user:u1"]);
  const tweet = { id: "tw_new", authorId: "u1", username: "trainer", text: "@monexmonad catch 1" };
  const processed = processMentionTweet(tweet, "monexmonad", user, 10, null, {
    walletMonballs: 10,
    deliveryModel: "claim",
  });
  assert.ok(processed.activity);
  assert.equal(processed.deliveryModel, "claim");

  const committed = await commitCatchTransaction(kv, {
    tweet,
    catchUser: user,
    processResult: processed,
    startingMonballs: 10,
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.delivery.deferred, true);
  assert.equal(committed.delivery.spendApplied, true);
  assert.equal(committed.delivery.added, 0);

  const save = JSON.parse(store["monex:save:u1"]);
  assert.ok(save.monballs < 10, "monballs should be spent at commit time");

  const catchUser = JSON.parse(store["monex:catch-user:u1"]);
  assert.ok(catchUser.pendingMons.length > 0);
  assert.equal(catchUser.pendingMons[0].awaitingProfileClaim, true);
  assert.equal(save.party.length + save.box.length, 0, "mons stay staged until profile claim");
});

test("multiple unclaimed deferred catches each spend monballs at commit", async () => {
  const store = {
    "monex:activity": JSON.stringify({ entries: [] }),
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 10,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:save:u1": JSON.stringify({
      revision: 1,
      monballs: 10,
      party: [],
      box: [],
      xHandle: "trainer",
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  let user = JSON.parse(store["monex:catch-user:u1"]);
  let totalCaught = 0;

  for (const tweetId of ["tw_a", "tw_b", "tw_c"]) {
    const tweet = { id: tweetId, authorId: "u1", username: "trainer", text: "@monexmonad catch 1" };
    const processed = processMentionTweet(tweet, "monexmonad", user, 10, null, {
      walletMonballs: JSON.parse(store["monex:save:u1"]).monballs,
      deliveryModel: "claim",
    });
    assert.ok(processed.activity);
    const committed = await commitCatchTransaction(kv, {
      tweet,
      catchUser: user,
      processResult: processed,
      startingMonballs: 10,
    });
    assert.equal(committed.ok, true);
    assert.equal(committed.receipt.spendApplied, true);
    totalCaught += committed.receipt.caughtCount || 0;
    user = JSON.parse(store["monex:catch-user:u1"]);
  }

  const save = JSON.parse(store["monex:save:u1"]);
  assert.equal(save.monballs, 7, "each catch should deduct even without claiming");
  assert.equal(JSON.parse(store["monex:activity"]).entries.length, 3);
  assert.equal(user.pendingMons.length, totalCaught);
  assert.equal(save.party.length + save.box.length, 0);
});

test("deferred commit rejects when wallet cannot cover spend", async () => {
  const store = {
    "monex:activity": JSON.stringify({ entries: [] }),
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 1,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:save:u1": JSON.stringify({
      revision: 1,
      monballs: 1,
      party: [],
      box: [],
      xHandle: "trainer",
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const user = JSON.parse(store["monex:catch-user:u1"]);
  const tweet = { id: "tw_low", authorId: "u1", username: "trainer", text: "@monexmonad catch 5" };
  const processed = processMentionTweet(tweet, "monexmonad", user, 10, null, {
    walletMonballs: 1,
    deliveryModel: "claim",
  });
  assert.equal(processed.activity, null);
  assert.equal(processed.skipReason, "insufficient");
});

test("hydrate skips claim-gated pending mons until profile claim", async () => {
  const store = {
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 7,
      pendingMons: [
        {
          pendingId: "p_gate",
          name: "Chog",
          rarity: "Common",
          skills: [],
          awaitingProfileClaim: true,
          catchTweetId: "tw_gate",
        },
      ],
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
  const result = await hydrateCloudSaveWithCatchState(kv, "u1", "trainer", 10);
  assert.equal(result.hydrated, true);
  assert.equal(result.added, 0);
  const save = JSON.parse(store["monex:save:u1"]);
  assert.equal(save.party.length + save.box.length, 0);
});

test("recoverMissingMonsFromActivity skips deferred unclaimed catches", async () => {
  const store = {
    "monex:activity": JSON.stringify({
      entries: [
        {
          id: "act_def",
          tweetId: "tw_skip",
          xUsername: "trainer",
          status: "success",
          spend: 1,
          caughtCount: 1,
          mons: [{ name: "Chog", rarity: "Common", skills: [] }],
          at: "2026-07-15T00:00:00.000Z",
        },
      ],
    }),
    "monex:save:u1": JSON.stringify({
      revision: 1,
      monballs: 10,
      party: [],
      box: [],
      xHandle: "trainer",
      updatedAt: new Date().toISOString(),
    }),
  };
  const kv = makeKv(store);
  const receipt = buildCatchReceipt({
    tweet: { id: "tw_skip", authorId: "u1", username: "trainer" },
    activity: {
      id: "act_def",
      spend: 1,
      throws: 1,
      caughtCount: 1,
      monballsBefore: 10,
      monballsLeft: 9,
      at: "2026-07-15T00:00:00.000Z",
    },
    pendingMonsAdded: [{ pendingId: "p_skip", name: "Chog", rarity: "Common", skills: [] }],
    claimModel: "deferred",
  });
  receipt.completionStatus = "pending";
  receipt.spendApplied = true;
  await saveCatchReceipt(kv, receipt);

  const result = await recoverMissingMonsFromActivity(kv, "u1", "trainer", JSON.parse(store["monex:save:u1"]), 10);
  assert.equal(result.recovered, false);
  assert.equal(result.added.length, 0);
});
