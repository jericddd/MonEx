import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMergedMonballs,
  reconcileMonballsForCloudSave,
} from "./save-reconcile.js";

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

describe("resolveMergedMonballs", () => {
  it("prefers catch monballs when catch state is newer (X spend)", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(2000).toISOString() },
      { monballs: 10, updatedAt: new Date(1000).toISOString() },
      4
    );
    assert.equal(merged, 4);
  });

  it("uses save monballs when save is newer (mailbox grant)", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(1000).toISOString() },
      { monballs: 6, updatedAt: new Date(2000).toISOString() },
      1
    );
    assert.equal(merged, 6);
  });

  it("uses save monballs when save is newer (in-game spend)", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(1000).toISOString() },
      { monballs: 3, updatedAt: new Date(2000).toISOString() },
      10
    );
    assert.equal(merged, 3);
  });

  it("prefers catch when only catch has a timestamp", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(1000).toISOString() },
      { monballs: 10 },
      6
    );
    assert.equal(merged, 6);
  });

  it("falls back to max when timestamps are missing", () => {
    const merged = resolveMergedMonballs({}, { monballs: 4 }, 7);
    assert.equal(merged, 7);
  });
});

describe("reconcileMonballsForCloudSave", () => {
  it("does not resurrect spent monballs from stale client save", async () => {
    const kv = makeKv({
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: {
          u1: {
            username: "trainer",
            monballs: 0,
            pendingMons: [],
            updatedAt: new Date(3000).toISOString(),
          },
        },
      }),
      "monex:save:u1": JSON.stringify({
        monballs: 0,
        updatedAt: new Date(3000).toISOString(),
      }),
    });

    const payload = {
      monballs: 20,
      updatedAt: new Date(5000).toISOString(),
      party: [],
      box: [],
    };

    const reconciled = await reconcileMonballsForCloudSave(kv, { xUserId: "u1", username: "trainer" }, payload, 10);
    assert.equal(reconciled.monballs, 0);
  });

  it("allows client quest grant when server pools are not depleted", async () => {
    const kv = makeKv({
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: {
          u1: {
            username: "trainer",
            monballs: 10,
            pendingMons: [],
            updatedAt: new Date(1000).toISOString(),
          },
        },
      }),
      "monex:save:u1": JSON.stringify({
        monballs: 10,
        updatedAt: new Date(1000).toISOString(),
      }),
    });

    const payload = {
      monballs: 12,
      updatedAt: new Date(2000).toISOString(),
      party: [],
      box: [],
    };

    const reconciled = await reconcileMonballsForCloudSave(kv, { xUserId: "u1", username: "trainer" }, payload, 10);
    assert.equal(reconciled.monballs, 12);
  });

  it("does not resurrect spent monballs when cloud save still shows pre-catch balance", async () => {
    const kv = makeKv({
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: {
          u1: {
            username: "lucci_crypto",
            monballs: 0,
            pendingMons: [],
            updatedAt: new Date(4000).toISOString(),
          },
        },
      }),
      "monex:save:u1": JSON.stringify({
        monballs: 18,
        updatedAt: new Date(2000).toISOString(),
        party: [],
        box: [],
      }),
    });

    const payload = {
      monballs: 18,
      updatedAt: new Date(5000).toISOString(),
      party: [],
      box: [],
    };

    const reconciled = await reconcileMonballsForCloudSave(kv, { xUserId: "u1", username: "lucci_crypto" }, payload, 10);
    assert.equal(reconciled.monballs, 0);
  });
});
