import test from "node:test";
import assert from "node:assert/strict";
import {
  applyReleaseToSave,
  collectReleaseRecoveryKeys,
  getReleaseSalvage,
  releaseMonFromBox,
  resolveMonInstanceId,
} from "./release-mon.js";
import { stripReleasedMonsFromInventory, guardSavePayload } from "./save-economy-guard.js";

test("resolveMonInstanceId prefers instanceId then wildPendingId", () => {
  assert.equal(resolveMonInstanceId({ instanceId: "inst_a", wildPendingId: "p1" }), "inst_a");
  assert.equal(resolveMonInstanceId({ wildPendingId: "recovery_act_1_0" }), "recovery_act_1_0");
});

test("applyReleaseToSave returns equipped gear to inventory", () => {
  const mon = {
    name: "Chog",
    rarity: "Common",
    level: 3,
    instanceId: "inst_gear_chog",
    equipment: {
      weapon: {
        id: "gear_w1",
        slot: "weapon",
        house: "chog",
        tier: 1,
        rarity: "Common",
        bonuses: { atk: 5 },
      },
    },
  };
  const save = {
    party: [],
    box: [mon],
    money: 0,
    essence: 0,
    monShards: 0,
    gearInventory: [],
    releaseLog: [],
    releasedRecoveryIds: [],
  };
  const result = applyReleaseToSave(save, mon);
  assert.equal(result.ok, true);
  assert.equal(result.save.box.length, 0);
  assert.equal(result.save.gearInventory.length, 1);
  assert.equal(result.save.gearInventory[0].id, "gear_w1");
});

test("applyReleaseToSave removes mon from box and records recovery ids", () => {
  const mon = {
    name: "Chog",
    rarity: "Common",
    level: 3,
    instanceId: "inst_chog_1",
    wildPendingId: "recovery_act_9_0",
    equipment: {},
  };
  const save = {
    party: [],
    box: [mon],
    money: 1000,
    essence: 0,
    monShards: 0,
    gearInventory: [],
    releaseLog: [],
    releasedRecoveryIds: [],
  };
  const result = applyReleaseToSave(save, mon);
  assert.equal(result.ok, true);
  assert.equal(result.save.box.length, 0);
  assert.ok(result.save.releasedRecoveryIds.includes("inst_chog_1"));
  assert.ok(result.save.releasedRecoveryIds.includes("recovery_act_9_0"));
  assert.equal(result.save.releaseLog.length, 1);
  assert.equal(result.save.releaseLog[0].releaseLogNumber, 1);
  assert.equal(result.save.releaseLogSeq, 1);
});

test("stripReleasedMonsFromInventory removes blocked mons from stale full save", () => {
  const existing = {
    releasedRecoveryIds: ["recovery_act_2_0"],
    releaseLog: [],
    party: [],
    box: [],
  };
  const incoming = {
    releasedRecoveryIds: [],
    releaseLog: [],
    party: [],
    box: [
      { name: "Shramp", rarity: "Common", level: 1, wildPendingId: "recovery_act_2_0", equipment: {} },
      { name: "Mouch", rarity: "Common", level: 1, instanceId: "inst_keep", equipment: {} },
    ],
  };
  const out = stripReleasedMonsFromInventory(existing, incoming);
  assert.equal(out.box.length, 1);
  assert.equal(out.box[0].name, "Mouch");
});

test("guardSavePayload strips released mons before persist", () => {
  const existing = {
    releasedRecoveryIds: ["inst_removed"],
    releaseLog: [],
    party: [],
    box: [],
    money: 0,
    essence: 0,
    monballs: 10,
  };
  const incoming = {
    releasedRecoveryIds: [],
    releaseLog: [],
    party: [],
    box: [{ name: "Chog", rarity: "Common", level: 1, instanceId: "inst_removed", equipment: {} }],
    money: 0,
    essence: 0,
    monballs: 10,
  };
  const out = guardSavePayload(existing, incoming);
  assert.equal(out.box.length, 0);
});

test("releaseMonFromBox is idempotent when mon already released", async () => {
  const store = {};
  const kv = {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
  };
  const session = { xUserId: "u1", username: "trainer" };
  store["monex:save:u1"] = JSON.stringify({
    party: [],
    box: [],
    money: 1000,
    essence: 0,
    monShards: 0,
    gearInventory: [],
    releaseLog: [{ id: "rel_1", at: new Date().toISOString(), name: "Chog", rarity: "Common", level: 1, instanceId: "inst_gone", source: "box" }],
    releasedRecoveryIds: ["inst_gone"],
    monballs: 10,
    revision: 3,
    updatedAt: new Date().toISOString(),
  });

  const result = await releaseMonFromBox(kv, session, { instanceId: "inst_gone", expectedRevision: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.idempotent, true);
});

test("getReleaseSalvage refunds level investment partially", () => {
  const salvage = getReleaseSalvage({ name: "Chog", rarity: "Common", level: 3 });
  assert.ok(salvage.gold > 0);
  assert.ok(salvage.essence >= 5);
});

test("collectReleaseRecoveryKeys includes activity signature", () => {
  const keys = collectReleaseRecoveryKeys({
    instanceId: "recovery_act_3_1",
    wildPendingId: "recovery_act_3_1",
    name: "Mouch",
  });
  assert.ok(keys.includes("activity:act_3:1"));
});
