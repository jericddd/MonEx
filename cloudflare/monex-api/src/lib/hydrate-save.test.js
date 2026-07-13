import test from "node:test";
import assert from "node:assert/strict";
import { hydrateUserCloudSave, recoverMissingMonsFromActivity } from "./hydrate-save.js";

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

test("recoverMissingMonsFromActivity adds mons from activity log", async () => {
  const store = {};
  const kv = makeKv(store);

  store["monex:activity"] = JSON.stringify({
    entries: [
      {
        id: "act_legacy",
        xUsername: "trainer",
        status: "success",
        at: "2026-07-10T12:00:00.000Z",
        mons: [{ name: "Chog", rarity: "Common", skills: "★Slash" }],
      },
    ],
  });
  store["monex:state"] = JSON.stringify({ processedTweetIds: [], users: {} });

  const result = await recoverMissingMonsFromActivity(
    kv,
    "u1",
    "trainer",
    { party: [], box: [], monballs: 10 },
    10
  );

  assert.equal(result.recovered, true);
  assert.equal(result.added.length, 1);
  assert.equal(result.save.party[0].name, "Chog");
  assert.ok(store["monex:save:u1"]);
});

test("hydrateUserCloudSave seeds pending then returns save", async () => {
  const kv = makeKv({
    "monex:catch-user:u1": JSON.stringify({
      username: "trainer",
      monballs: 9,
      pendingMons: [{ name: "Mouch", rarity: "Common", pendingId: "p1" }],
      updatedAt: new Date().toISOString(),
    }),
    "monex:activity": JSON.stringify({ entries: [] }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await hydrateUserCloudSave(kv, "u1", "trainer", 10);
  assert.equal(result.ok, true);
  assert.equal(result.hydrated, true);
  assert.ok(result.save.party.some((m) => m.name === "Mouch"));
});
