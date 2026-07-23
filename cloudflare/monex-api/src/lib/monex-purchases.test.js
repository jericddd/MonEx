import test from "node:test";
import assert from "node:assert/strict";
import {
  tryClaimPurchaseTx,
  finalizePurchaseTx,
  releasePurchaseTxClaim,
  appendUserPurchase,
  listUserPurchases,
} from "./monex-purchases.js";

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

const TX = "0x" + "11".repeat(32);

test("tryClaimPurchaseTx grants one winner and blocks replay after finalize", async () => {
  const store = {};
  const kv = makeKv(store);
  const [a, b] = await Promise.all([
    tryClaimPurchaseTx(kv, TX),
    tryClaimPurchaseTx(kv, TX),
  ]);
  const winners = [a, b].filter((r) => r.claimed);
  const losers = [a, b].filter((r) => !r.claimed);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);

  await finalizePurchaseTx(kv, TX, {
    txHash: TX,
    xUserId: "u1",
    packageId: "mb_10",
    packageKind: "monball",
    grantedAt: new Date().toISOString(),
  });

  const again = await tryClaimPurchaseTx(kv, TX);
  assert.equal(again.claimed, false);
  assert.equal(again.reason, "already_used");
});

test("releasePurchaseTxClaim frees in-progress claim", async () => {
  const kv = makeKv();
  const claim = await tryClaimPurchaseTx(kv, TX);
  assert.equal(claim.claimed, true);
  await releasePurchaseTxClaim(kv, TX);
  const retry = await tryClaimPurchaseTx(kv, TX);
  assert.equal(retry.claimed, true);
});

test("appendUserPurchase keeps newest first", async () => {
  const kv = makeKv();
  await appendUserPurchase(kv, "u1", { txHash: "0x1", grantedAt: "2026-01-01T00:00:00.000Z" });
  await appendUserPurchase(kv, "u1", { txHash: "0x2", grantedAt: "2026-01-02T00:00:00.000Z" });
  const list = await listUserPurchases(kv, "u1");
  assert.equal(list[0].txHash, "0x2");
  assert.equal(list[1].txHash, "0x1");
});
