import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCatchUserKv,
  saveCatchUserRecord,
  loadCatchUserRecord,
  catchUserKey,
  catchUsernameIndexKey,
} from "./catch-user-store.js";

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

test("resolveCatchUserKv prefers per-user KV over state blob", async () => {
  const kv = makeKv({
    "monex:state": JSON.stringify({
      processedTweetIds: [],
      users: {
        u1: { username: "trainer", monballs: 10, pendingMons: [], updatedAt: "2020-01-01T00:00:00.000Z" },
      },
    }),
    [catchUserKey("u1")]: JSON.stringify({
      username: "trainer",
      monballs: 3,
      pendingMons: [{ name: "Chog", rarity: "Common" }],
      updatedAt: "2026-07-13T00:00:00.000Z",
    }),
    [catchUsernameIndexKey("trainer")]: "u1",
  });

  const user = await resolveCatchUserKv(kv, "u1", "trainer", 10);
  assert.equal(user.monballs, 3);
  assert.equal(user.pendingMons.length, 1);
});

test("saveCatchUserRecord writes per-user KV and username index", async () => {
  const kv = makeKv({});
  const user = { username: "trainer", monballs: 7, pendingMons: [], updatedAt: new Date().toISOString() };
  await saveCatchUserRecord(kv, "u1", user);

  const record = await loadCatchUserRecord(kv, "u1");
  assert.equal(record.monballs, 7);
  assert.equal(await kv.get(catchUsernameIndexKey("trainer")), "u1");
});

test("resolveCatchUserKv migrates legacy sim_ row into real xUserId", async () => {
  const kv = makeKv({
    [catchUserKey("sim_trainer")]: JSON.stringify({
      username: "trainer",
      monballs: 4,
      pendingMons: [{ name: "Chog", rarity: "Common", pendingId: "p1" }],
      updatedAt: "2026-07-10T00:00:00.000Z",
    }),
    [catchUsernameIndexKey("trainer")]: "sim_trainer",
  });

  const user = await resolveCatchUserKv(kv, "real123", "trainer", 10);
  assert.equal(user.monballs, 4);
  assert.equal(user.pendingMons.length, 1);
  assert.equal(await kv.get(catchUserKey("sim_trainer")), null);
  assert.equal(await kv.get(catchUsernameIndexKey("trainer")), "real123");
});
