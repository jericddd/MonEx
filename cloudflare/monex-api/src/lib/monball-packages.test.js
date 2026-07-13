import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MONBALL_PACKAGES,
  listMonballPackages,
  findMonballPackage,
  purchaseMonballPackage,
} from "./monball-packages.js";

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

test("listMonballPackages returns default 10/50/100 packs", () => {
  const packages = listMonballPackages({});
  assert.equal(packages.length, 3);
  assert.deepEqual(
    packages.map((p) => p.amount),
    [10, 50, 100]
  );
  assert.equal(packages[0].id, "mb_10");
  assert.ok(packages.every((p) => typeof p.monexPrice === "number"));
});

test("listMonballPackages honors MONBALL_PACKAGES_JSON override", () => {
  const packages = listMonballPackages({
    MONBALL_PACKAGES_JSON: JSON.stringify([
      { id: "mb_250", amount: 250, monexPrice: 80, active: true, displayOrder: 2 },
      { id: "mb_10", amount: 10, monexPrice: 4, active: true, displayOrder: 1 },
      { id: "mb_off", amount: 999, monexPrice: 1, active: false, displayOrder: 9 },
    ]),
  });
  assert.equal(packages.length, 2);
  assert.equal(packages[0].id, "mb_10");
  assert.equal(packages[0].monexPrice, 4);
  assert.equal(packages[1].id, "mb_250");
});

test("findMonballPackage resolves active packages only by default", () => {
  assert.equal(findMonballPackage({}, "mb_50")?.amount, 50);
  assert.equal(findMonballPackage({}, "nope"), null);
});

test("purchaseMonballPackage requires MONEX payment when grants disabled", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 0,
      monballs: 10,
      party: [],
      box: [],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseMonballPackage(
    kv,
    { xUserId: "u1", username: "trainer" },
    { packageId: "mb_10", expectedRevision: 1 },
    10,
    {}
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "monex_payment_required");
  assert.equal(result.package.amount, 10);
  assert.equal(result.currency, "MONEX");
});

test("purchaseMonballPackage grants when ENABLE_MONBALL_PACKAGE_PURCHASE=1", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 2,
      money: 0,
      monballs: 10,
      party: [],
      box: [],
      gearInventory: [],
      questState: { tasks: { dailies: [], weeklies: [], campaign: [] } },
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseMonballPackage(
    kv,
    { xUserId: "u1", username: "trainer" },
    { packageId: "mb_50", expectedRevision: 2 },
    10,
    { ENABLE_MONBALL_PACKAGE_PURCHASE: "1" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.grantedMonballs, 50);
  assert.equal(result.save.monballs, 60);
  assert.equal(result.monexPrice, DEFAULT_MONBALL_PACKAGES.find((p) => p.id === "mb_50").monexPrice);
});

test("purchaseMonballPackage rejects invalid package id", async () => {
  const result = await purchaseMonballPackage(
    makeKv(),
    { xUserId: "u1", username: "trainer" },
    { packageId: "mb_nope" },
    10,
    { ENABLE_MONBALL_PACKAGE_PURCHASE: "1" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_package");
});
