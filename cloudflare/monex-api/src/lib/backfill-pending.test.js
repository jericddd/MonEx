import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectPendingUsers,
  pickCanonicalCatchUserId,
  applySyncedMonsToSave,
  backfillPendingForUser,
  usernameMatchesFilter,
  listPendingUsernames,
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

  it("preserves username casing as separate groups", () => {
    const state = makeState({
      "1": {
        username: "Lucci_Crypto",
        pendingMons: [{ name: "Shramp", pendingId: "p1" }],
      },
      "2": {
        username: "lucci_crypto",
        pendingMons: [{ name: "Mouch", pendingId: "p2" }],
      },
    });

    const groups = collectPendingUsers(state);
    assert.equal(groups.size, 2);
    assert.equal(groups.get("Lucci_Crypto").length, 1);
    assert.equal(groups.get("lucci_crypto").length, 1);
  });
});

describe("usernameMatchesFilter", () => {
  it("matches exact case only", () => {
    assert.equal(usernameMatchesFilter("Lucci_Crypto", "Lucci_Crypto"), true);
    assert.equal(usernameMatchesFilter("Lucci_Crypto", "lucci_crypto"), false);
    assert.equal(usernameMatchesFilter("Lucci_Crypto", ""), true);
  });
});

describe("listPendingUsernames", () => {
  it("lists exact pending usernames", () => {
    const state = makeState({
      "1": { username: "Lucci_Crypto", pendingMons: [{ pendingId: "p1" }] },
    });
    assert.deepEqual(listPendingUsernames(state), ["Lucci_Crypto"]);
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

  it("persists all pending mons into save party/box in one pass", () => {
    const state = makeState({
      "42": {
        username: "trainer",
        monballs: 10,
        pendingMons: [
          { name: "Chog", rarity: "Rare", level: 1, skills: [{ name: "Slash", type: "active", power: 1 }], pendingId: "p_a" },
          { name: "Mouch", rarity: "Common", level: 1, skills: [{ name: "Slash", type: "active", power: 1 }], pendingId: "p_b" },
          { name: "Anago", rarity: "Uncommon", level: 1, skills: [{ name: "Slash", type: "active", power: 1 }], pendingId: "p_c" },
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const save = {
      party: [{ name: "Chog", rarity: "Legendary", level: 5, skills: [{ name: "Slash", type: "active", power: 1 }], max_hp: 100, current_hp: 100 }],
      box: [],
      monballs: 10,
      xHandle: "trainer",
    };

    const result = backfillPendingForUser(state, {
      xUserId: "42",
      username: "trainer",
      save,
    });

    assert.equal(result.ok, true);
    assert.equal(result.added, 3);
    assert.equal(result.save.party.length, 3);
    assert.equal(result.save.box.length, 1);
    assert.equal(result.remaining, 0);
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
