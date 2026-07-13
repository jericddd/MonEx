import test from "node:test";
import assert from "node:assert/strict";
import { purchaseShopItem } from "./shop-purchase.js";

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

test("purchaseShopItem deducts gold and grants essence", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 1,
      money: 5000,
      essence: 0,
      monShards: 0,
      monballs: 10,
      party: [],
      box: [],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseShopItem(
    kv,
    { xUserId: "u1", username: "trainer" },
    { itemId: "essence25", qty: 2, expectedRevision: 1 },
    10
  );

  assert.equal(result.ok, true);
  assert.equal(result.save.money, 5000 - 900 * 2);
  assert.equal(result.save.essence, 50);
});

test("purchaseShopItem rejects insufficient funds", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 0,
      money: 100,
      essence: 0,
      party: [],
      box: [],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseShopItem(
    kv,
    { xUserId: "u1", username: "trainer" },
    { itemId: "essence25", qty: 1 },
    10
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "insufficient_funds");
});

test("purchaseShopItem rejects removed monball qty item", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 0,
      money: 99999,
      essence: 0,
      party: [],
      box: [],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseShopItem(
    kv,
    { xUserId: "u1", username: "trainer" },
    { itemId: "monball5", qty: 1 },
    10
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_item");
});

test("purchaseShopItem grants gear to inventory", async () => {
  const kv = makeKv({
    "monex:save:u1": JSON.stringify({
      revision: 0,
      money: 10000,
      essence: 0,
      party: [],
      box: [],
      gearInventory: [],
      updatedAt: new Date().toISOString(),
    }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await purchaseShopItem(
    kv,
    { xUserId: "u1", username: "trainer" },
    { itemId: "shop_weapon_t1", qty: 1 },
    10
  );

  assert.equal(result.ok, true);
  assert.equal(result.save.money, 6500);
  assert.equal(result.save.gearInventory.length, 1);
  assert.equal(result.save.gearInventory[0].slot, "weapon");
});
