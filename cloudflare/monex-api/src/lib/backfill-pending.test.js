import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectPendingUsers,
  pickCanonicalCatchUserId,
  applySyncedMonsToSave,
  backfillPendingForUser,
} from "./backfill-pending.js";

function makeState(users = {}) {
  return { processedTweetIds: [], users };
}

describe("collectPendingUsers", () => {
  it("groups users with pending mons by username", () => {
    const state = makeState({
      "12345": {
        username: "alpha",
        pendingMons: [{ name: "Chog", pendingId: "p1" }],
      },
      sim_alpha: {
        username: "alpha",
        pendingMons: [{ name: "Mouch", pendingId: "p2" }],
      },
      "99": {
        username: "beta",
        pendingMons: [],
      },
    });

    const groups = collectPendingUsers(state);
    assert.equal(groups.size, 1);
    assert.equal(groups.get("alpha").length, 2);
  });
});

describe("pickCanonicalCatchUserId", () => {
  it("prefers real X author id over sim_*", () => {
    const id = pickCanonicalCatchUserId([
      { key: "sim_trainer", user: { pendingMons: [{ pendingId: "p1" }] }, pendingCount: 1 },
      { key: "424242", user: { pendingMons: [{ pendingId: "p2" }] }, pendingCount: 1 },
    ]);
    assert.equal(id, "424242");
  });
});

describe("backfillPendingForUser", () => {
  it("moves pending mons into cloud save and clears catch queue", () => {
    const state = makeState({
      "42": {
        username: "trainer",
        monballs: 6,
        pendingMons: [
          { name: "Chog", rarity: "Rare", level: 1, skills: [], pendingId: "p_a" },
          { name: "Mouch", rarity: "Common", level: 1, skills: [], pendingId: "p_b" },
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const save = {
      party: [],
      box: [],
      monballs: 10,
      money: 5000,
      xHandle: "trainer",
    };

    const result = backfillPendingForUser(state, {
      xUserId: "42",
      username: "trainer",
      save,
    });

    assert.equal(result.ok, true);
    assert.equal(result.added, 2);
    assert.equal(result.save.party.length, 2);
    assert.equal(result.save.monballs, 6);
    assert.equal(state.users["42"].pendingMons.length, 0);
  });

  it("skips mons already present by pending id", () => {
    const state = makeState({
      "42": {
        username: "trainer",
        monballs: 5,
        pendingMons: [{ name: "Chog", rarity: "Rare", level: 1, skills: [], pendingId: "p_a" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const save = {
      party: [{ name: "Chog", rarity: "Rare", level: 1, wildPendingId: "p_a", equipment: {} }],
      box: [],
      monballs: 10,
      xHandle: "trainer",
    };

    const result = backfillPendingForUser(state, {
      xUserId: "42",
      username: "trainer",
      save,
    });

    assert.equal(result.added, 0);
    assert.equal(result.save.party.length, 1);
    assert.equal(state.users["42"].pendingMons.length, 0);
  });
});

describe("applySyncedMonsToSave", () => {
  it("sanitizes pending mon payloads", () => {
    const { save, addedParty } = applySyncedMonsToSave(
      { party: [], box: [] },
      [{ name: "Chog", rarity: "Rare", level: 1, skills: [], pendingId: "p1" }],
      []
    );
    assert.equal(addedParty, 1);
    assert.equal(save.party[0].name, "Chog");
    assert.equal(save.party[0].rarity, "Rare");
  });
});
