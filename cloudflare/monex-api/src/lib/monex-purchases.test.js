import test from "node:test";
import assert from "node:assert/strict";
import {
  tryClaimPurchaseTx,
  finalizePurchaseTx,
  releasePurchaseTxClaim,
  appendUserPurchase,
  listUserPurchases,
  CLAIM_TTL_SEC,
  parseUsedTxValue,
} from "./monex-purchases.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value, options = {}) {
      store[key] = value;
      store[`__meta:${key}`] = options;
    },
    async delete(key) {
      delete store[key];
      delete store[`__meta:${key}`];
    },
  };
}

const TX = "0x" + "11".repeat(32);
const TX2 = "0x" + "22".repeat(32);

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

  // Claim locks use short TTL, not multi-year.
  const meta = store[`__meta:monex:tx-used:${TX}`];
  assert.equal(meta.expirationTtl, CLAIM_TTL_SEC);

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

test("legacy plain claim: locks are treated as stale and reclaimed", async () => {
  const store = {
    [`monex:tx-used:${TX2}`]: "claim:f25be184-ae95-4a1b-9a38-731aeae43ce6",
  };
  const kv = makeKv(store);
  const parsed = parseUsedTxValue(store[`monex:tx-used:${TX2}`]);
  assert.equal(parsed.kind, "claim");
  assert.equal(parsed.stale, true);
  assert.equal(parsed.legacy, true);

  const claim = await tryClaimPurchaseTx(kv, TX2, {
    xUserId: "u1",
    packageId: "mb_50",
    packageKind: "monball",
  });
  assert.equal(claim.claimed, true);
  const raw = store[`monex:tx-used:${TX2}`];
  const body = JSON.parse(raw);
  assert.equal(body.status, "claim");
  assert.equal(body.packageId, "mb_50");
});

test("fresh claim blocks concurrent retry as in_progress", async () => {
  const kv = makeKv();
  const first = await tryClaimPurchaseTx(kv, TX, { xUserId: "u1", packageId: "mb_10", packageKind: "monball" });
  assert.equal(first.claimed, true);
  const second = await tryClaimPurchaseTx(kv, TX, { xUserId: "u1", packageId: "mb_10", packageKind: "monball" });
  assert.equal(second.claimed, false);
  assert.equal(second.reason, "in_progress");
});

test("appendUserPurchase keeps newest first and dedupes txHash", async () => {
  const kv = makeKv();
  const h1 = "0x" + "aa".repeat(32);
  const h2 = "0x" + "bb".repeat(32);
  await appendUserPurchase(kv, "u1", { txHash: h1, grantedAt: "2026-01-01T00:00:00.000Z" });
  await appendUserPurchase(kv, "u1", { txHash: h2, grantedAt: "2026-01-02T00:00:00.000Z" });
  await appendUserPurchase(kv, "u1", { txHash: h1, grantedAt: "2026-01-03T00:00:00.000Z" });
  const list = await listUserPurchases(kv, "u1");
  assert.equal(list[0].txHash, h1);
  assert.equal(list[0].grantedAt, "2026-01-03T00:00:00.000Z");
  assert.equal(list.filter((r) => r.txHash === h1).length, 1);
});
