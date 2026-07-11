import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hydrateCloudSaveWithCatchState } from "./save-reconcile.js";
import { MONANIMAL_NAMES } from "./save-validate.js";

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

describe("hydrateCloudSaveWithCatchState", () => {
  it("commits catch 18: deducts monballs and adds all mons to box in one pass", async () => {
    const roster = [...MONANIMAL_NAMES];
    const pendingMons = Array.from({ length: 18 }, (_, i) => ({
      name: roster[i % roster.length],
      rarity: "Common",
      level: 1,
      skills: [],
      pendingId: `p_${i}`,
    }));

    const store = {
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: {
          lucci: {
            username: "lucci_crypto",
            monballs: 0,
            pendingMons,
            updatedAt: "2026-07-10T12:00:00.000Z",
          },
        },
      }),
      "monex:save:lucci": JSON.stringify({
        monballs: 18,
        party: [],
        box: [],
        xHandle: "lucci_crypto",
        updatedAt: "2026-07-10T11:00:00.000Z",
      }),
    };
    const kv = makeKv(store);

    const result = await hydrateCloudSaveWithCatchState(kv, "lucci", "lucci_crypto", 10);
    assert.equal(result.hydrated, true);
    assert.equal(result.monballs, 0);
    assert.equal(result.added, 18);
    assert.equal(result.remaining, 0);
    assert.equal(result.save.monballs, 0);
    assert.equal(result.save.party.length, 3);
    assert.equal(result.save.box.length, 15);

    const state = JSON.parse(store["monex:state"]);
    assert.equal(state.users.lucci.pendingMons.length, 0);

    const saved = JSON.parse(store["monex:save:lucci"]);
    assert.equal(saved.monballs, 0);
    assert.equal(saved.party.length + saved.box.length, 18);
  });

  it("returns no_cloud_save when player has not logged in yet", async () => {
    const kv = makeKv({
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: {
          lucci: {
            username: "lucci_crypto",
            monballs: 0,
            pendingMons: [{ name: "Chog", pendingId: "p1" }],
            updatedAt: "2026-07-10T12:00:00.000Z",
          },
        },
      }),
    });

    const result = await hydrateCloudSaveWithCatchState(kv, "lucci", "lucci_crypto", 10);
    assert.equal(result.hydrated, false);
    assert.equal(result.reason, "no_cloud_save");
  });
});
