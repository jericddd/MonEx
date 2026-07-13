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

test("recoverMissingMonsFromActivity skips when inventory already populated", async () => {
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

  const existing = {
    party: [{ name: "Mouch", rarity: "Common", level: 1 }],
    box: [],
    monballs: 10,
  };
  const result = await recoverMissingMonsFromActivity(kv, "u1", "trainer", existing, 10);
  assert.equal(result.recovered, false);
  assert.equal(result.added.length, 0);
  assert.equal(result.skippedReason, "inventory_populated");
  assert.equal(result.save.party.length, 1);
  assert.equal(store["monex:save:u1"], undefined);
});

test("hydrate does not re-import activity on every call once inventory exists", async () => {
  const store = {};
  const kv = makeKv(store);
  store["monex:activity"] = JSON.stringify({
    entries: [
      {
        id: "act_1",
        xUsername: "trainer",
        status: "success",
        at: "2026-07-10T12:00:00.000Z",
        mons: [
          { name: "Chog", rarity: "Common", skills: "★Slash" },
          { name: "Mouch", rarity: "Common", skills: "★Zap" },
        ],
      },
    ],
  });
  store["monex:state"] = JSON.stringify({ processedTweetIds: [], users: {} });
  store["monex:catch-user:u1"] = JSON.stringify({
    username: "trainer",
    monballs: 10,
    pendingMons: [],
    updatedAt: new Date().toISOString(),
  });

  const first = await hydrateUserCloudSave(kv, "u1", "trainer", 10);
  assert.equal(first.ok, true);
  const firstCount = (first.save?.party?.length || 0) + (first.save?.box?.length || 0);
  assert.ok(firstCount >= 1);

  const second = await hydrateUserCloudSave(kv, "u1", "trainer", 10);
  const secondCount = (second.save?.party?.length || 0) + (second.save?.box?.length || 0);
  assert.equal(secondCount, firstCount);
  assert.equal(second.fromActivity, false);
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
