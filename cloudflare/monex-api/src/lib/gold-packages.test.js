import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GOLD_PACKAGES,
  listGoldPackages,
  findGoldPackage,
  purchaseGoldPackage,
} from "./gold-packages.js";

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

test("listGoldPackages returns default 4k/8k/40k packs", () => {
  const packages = listGoldPackages({});
  assert.equal(packages.length, 3);
  assert.deepEqual(
    packages.map((p) => p.gold),
    [4000, 8000, 40_000]
  );
  assert.deepEqual(
    packages.map((p) => p.monexPrice),
    [10_000, 20_000, 100_000]
  );
  assert.equal(packages[2].featured, true);
  assert.equal(packages[0].id, "gp_4k");
});

test("listGoldPackages honors GOLD_PACKAGES_JSON override", () => {
  const packages = listGoldPackages({
    GOLD_PACKAGES_JSON: JSON.stringify([
      { id: "gp_99k", gold: 99_000, monexPrice: 250_000, active: true, displayOrder: 2, featured: true },
      { id: "gp_4k", gold: 4000, monexPrice: 10_000, active: true, displayOrder: 1 },
      { id: "gp_off", gold: 1, monexPrice: 1, active: false, displayOrder: 9 },
    ]),
  });
  assert.equal(packages.length, 2);
  assert.equal(packages[0].id, "gp_4k");
  assert.equal(packages[1].id, "gp_99k");
  assert.equal(packages[1].featured, true);
});

test("findGoldPackage resolves active packages only by default", () => {
  assert.equal(findGoldPackage({}, "gp_8k")?.gold, 8000);
  assert.equal(findGoldPackage({}, "nope"), null);
});

test("purchaseGoldPackage requires MONEX payment when grants disabled", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 5000,
      monballs: 10,
      party: [],
      box: [],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseGoldPackage(
    kv,
    { xUserId: "u1", username: "trainer" },
    { packageId: "gp_4k", expectedRevision: 1 },
    10,
    {}
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "monex_payment_required");
  assert.equal(result.package.gold, 4000);
  assert.equal(result.currency, "MONEX");
  assert.ok(result.payment?.vaultAddress);
});

test("purchaseGoldPackage grants when ENABLE_GOLD_PACKAGE_PURCHASE=1", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 2,
      money: 5000,
      monballs: 10,
      party: [],
      box: [],
      gearInventory: [],
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseGoldPackage(
    kv,
    { xUserId: "u1", username: "trainer" },
    { packageId: "gp_40k", expectedRevision: 2 },
    10,
    { ENABLE_GOLD_PACKAGE_PURCHASE: "1" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.grantedGold, 40_000);
  assert.equal(result.save.money, 45_000);
  assert.equal(result.monexPrice, DEFAULT_GOLD_PACKAGES.find((p) => p.id === "gp_40k").monexPrice);
});

test("purchaseGoldPackage rejects invalid package id", async () => {
  const result = await purchaseGoldPackage(
    makeKv(),
    { xUserId: "u1", username: "trainer" },
    { packageId: "gp_nope" },
    10,
    { ENABLE_GOLD_PACKAGE_PURCHASE: "1" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_package");
});
