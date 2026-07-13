import test from "node:test";
import assert from "node:assert/strict";
import {
  hydrateCatchUserIntoState,
  persistCatchUserFromState,
  loadCatchUserRecord,
  catchUserKey,
} from "./catch-user-store.js";
import { loadState, resolveCatchUser } from "../kv-store.js";

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

test("hydrateCatchUserIntoState prefers per-user KV over state blob", async () => {
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
  });

  const state = await loadState(kv);
  const user = await hydrateCatchUserIntoState(kv, state, "u1", "trainer", 10);
  assert.equal(user.monballs, 3);
  assert.equal(user.pendingMons.length, 1);
});

test("persistCatchUserFromState writes per-user KV", async () => {
  const kv = makeKv({
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });
  const state = await loadState(kv);
  const user = resolveCatchUser(state, "u1", "trainer", 10);
  user.monballs = 7;
  await persistCatchUserFromState(kv, state, "u1");

  const record = await loadCatchUserRecord(kv, "u1");
  assert.equal(record.monballs, 7);
});
