import test from "node:test";
import assert from "node:assert/strict";
import { hydrateUserCloudSave, recoverMissingMonsFromActivity } from "./hydrate-save.js";
import { userActivityIndexKey } from "../kv-store.js";

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

function seedUserActivity(store, xUserId, entries) {
  store[userActivityIndexKey(xUserId)] = JSON.stringify({ entries });
}

test("recoverMissingMonsFromActivity adds mons from user activity index", async () => {
  const store = {};
  const kv = makeKv(store);

  seedUserActivity(store, "u1", [
    {
      id: "act_legacy",
      xUserId: "u1",
      xUsername: "trainer",
      status: "success",
      at: "2026-07-10T12:00:00.000Z",
      mons: [{ name: "Chog", rarity: "Common", skills: "★Slash" }],
    },
  ]);
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
  seedUserActivity(store, "u1", [
    {
      id: "act_legacy",
      xUserId: "u1",
      xUsername: "trainer",
      status: "success",
      at: "2026-07-10T12:00:00.000Z",
      mons: [{ name: "Chog", rarity: "Common", skills: "★Slash" }],
    },
  ]);

  const existing = {
    party: [
      {
        name: "Chog",
        rarity: "Common",
        level: 1,
        wildPendingId: "recovery_act_legacy_0",
        equipment: {},
      },
    ],
    box: [],
    monballs: 10,
  };
  const result = await recoverMissingMonsFromActivity(kv, "u1", "trainer", existing, 10);
  assert.equal(result.recovered, false);
  assert.equal(result.added.length, 0);
  assert.equal(result.save.party.length, 1);
  assert.equal(store["monex:save:u1"], undefined);
});

test("recoverMissingMonsFromActivity backfills undelivered mons when inventory is partial", async () => {
  const store = {};
  const kv = makeKv(store);
  seedUserActivity(store, "u1", [
    {
      id: "act_bulk",
      xUserId: "u1",
      xUsername: "Noajolouis",
      status: "success",
      at: "2026-07-13T23:52:55.829Z",
      mons: [
        { name: "Monhorse", rarity: "Common", skills: "★Slash" },
        { name: "Moyaki", rarity: "Rare", skills: "★Flame" },
        { name: "Chog", rarity: "Common", skills: "★Slash" },
      ],
    },
    {
      id: "act_single",
      xUserId: "u1",
      xUsername: "Noajolouis",
      status: "success",
      at: "2026-07-14T00:00:58.064Z",
      mons: [{ name: "Mouch", rarity: "Uncommon", skills: "★Zap" }],
    },
  ]);
  store["monex:state"] = JSON.stringify({ processedTweetIds: [], users: {} });

  const partial = {
    party: [{ name: "Monhorse", rarity: "Common", level: 1, equipment: {} }],
    box: [{ name: "Moyaki", rarity: "Rare", level: 1, equipment: {} }],
    monballs: 10,
    xHandle: "noajolouis",
  };

  const result = await recoverMissingMonsFromActivity(kv, "u1", "Noajolouis", partial, 10);
  assert.equal(result.recovered, true);
  assert.equal(result.added.length, 2);
  const names = [...result.save.party, ...result.save.box].map((m) => m.name).sort();
  assert.ok(names.includes("Chog"));
  assert.ok(names.includes("Mouch"));
});

test("hydrate does not re-import activity on every call once inventory exists", async () => {
  const store = {};
  const kv = makeKv(store);
  seedUserActivity(store, "u1", [
    {
      id: "act_1",
      xUserId: "u1",
      xUsername: "trainer",
      status: "success",
      at: "2026-07-10T12:00:00.000Z",
      mons: [
        { name: "Chog", rarity: "Common", skills: "★Slash" },
        { name: "Mouch", rarity: "Common", skills: "★Zap" },
      ],
    },
  ]);
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
    "monex:activity-user:u1": JSON.stringify({ entries: [] }),
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
  });

  const result = await hydrateUserCloudSave(kv, "u1", "trainer", 10);
  assert.equal(result.ok, true);
  assert.equal(result.hydrated, true);
  assert.ok(result.save.party.some((m) => m.name === "Mouch"));
});
