import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCatchUser,
  lookupCatchUser,
  getPendingForSession,
  syncPendingForSession,
} from "./kv-store.js";

function makeState(users = {}) {
  return { processedTweetIds: [], users };
}

describe("resolveCatchUser", () => {
  it("returns pending mons for OAuth xUserId even when duplicate username keys exist", () => {
    const state = makeState({
      "12345": {
        username: "jericddd",
        monballs: 7,
        pendingMons: [{ name: "Chog", rarity: "Rare", pendingId: "p_1" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      sim_jericddd: {
        username: "jericddd",
        monballs: 10,
        pendingMons: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const user = resolveCatchUser(state, "12345", "jericddd", 10);
    assert.equal(user.monballs, 10);
    assert.equal(user.pendingMons.length, 1);
    assert.equal(user.pendingMons[0].name, "Chog");
    assert.equal(state.users["12345"], user);
    assert.equal(state.users.sim_jericddd, undefined);
  });

  it("migrates legacy username row onto session xUserId", () => {
    const state = makeState({
      sim_jericddd: {
        username: "jericddd",
        monballs: 4,
        pendingMons: [{ name: "Mouch", rarity: "Common", pendingId: "p_2" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const user = resolveCatchUser(state, "99999", "jericddd", 10);
    assert.equal(user.monballs, 4);
    assert.equal(user.pendingMons.length, 1);
    assert.equal(state.users["99999"], user);
    assert.equal(state.users.sim_jericddd, undefined);
  });

  it("merges legacy monballs when coexisting username rows are collapsed", () => {
    const state = makeState({
      "12345": {
        username: "jericddd",
        monballs: 7,
        pendingMons: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      sim_jericddd: {
        username: "jericddd",
        monballs: 12,
        pendingMons: [{ name: "Chog", rarity: "Rare", pendingId: "p_1" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const user = resolveCatchUser(state, "12345", "jericddd", 10);
    assert.equal(user.monballs, 12);
    assert.equal(user.pendingMons.length, 1);
    assert.equal(state.users.sim_jericddd, undefined);
  });

  it("lookupCatchUser is read-only and still exposes merged pending view", () => {
    const state = makeState({
      "12345": {
        username: "jericddd",
        monballs: 7,
        pendingMons: [{ name: "Chog", rarity: "Rare", pendingId: "p_1" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      sim_jericddd: {
        username: "jericddd",
        monballs: 10,
        pendingMons: [{ name: "Mouch", rarity: "Common", pendingId: "p_2" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const pending = getPendingForSession(state, "12345", "jericddd", 10);
    assert.equal(pending.found, true);
    assert.equal(pending.monballs, 10);
    assert.equal(pending.pendingMons.length, 2);
    assert.ok(state.users.sim_jericddd, "read path must not delete legacy rows");
  });
});

describe("syncPendingForSession", () => {
  it("syncs party/box slots and returns catch-state monballs", () => {
    const state = makeState({
      "42": {
        username: "trainer",
        monballs: 3,
        pendingMons: [
          { name: "A", pendingId: "p_a" },
          { name: "B", pendingId: "p_b" },
          { name: "C", pendingId: "p_c" },
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const result = syncPendingForSession(state, "42", "trainer", 1, 0, 3, 500, 10);
    assert.equal(result.monballs, 3);
    assert.equal(result.party.length, 2);
    assert.equal(result.box.length, 1);
    assert.equal(result.remaining, 0);
    assert.equal(state.users["42"].pendingMons.length, 0);
  });

  it("exposes pending count via getPendingForSession", () => {
    const state = makeState({
      "77": {
        username: "alpha",
        monballs: 8,
        pendingMons: [{ name: "Z", pendingId: "p_z" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const pending = getPendingForSession(state, "77", "alpha", 10);
    assert.equal(pending.found, true);
    assert.equal(pending.monballs, 8);
    assert.equal(pending.pendingMons.length, 1);
  });
});
