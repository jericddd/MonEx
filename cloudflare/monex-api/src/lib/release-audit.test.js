import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeReleaseLogForSave,
  buildReleasedBlocklist,
  findReleasedMonsInInventory,
} from "./release-audit.js";

test("buildReleasedBlocklist merges recovery ids and release log keys", () => {
  const save = {
    releasedRecoveryIds: ["inst_a"],
    releaseLog: [{
      id: "rel_1",
      at: "2026-07-14T12:00:00.000Z",
      name: "Chog",
      rarity: "Common",
      level: 1,
      gold: 0,
      essence: 5,
      shards: 0,
      source: "box",
      recoveryId: "recovery_act_9_0",
      instanceId: "inst_b",
    }],
  };
  const blocklist = buildReleasedBlocklist(save);
  assert.ok(blocklist.has("inst_a"));
  assert.ok(blocklist.has("inst_b"));
  assert.ok(blocklist.has("recovery_act_9_0"));
  assert.ok(blocklist.has("activity:act_9:0"));
});

test("findReleasedMonsInInventory flags ghosts in party or box", () => {
  const save = {
    releasedRecoveryIds: ["recovery_act_2_0"],
    releaseLog: [],
    party: [{ name: "Shramp", rarity: "Common", level: 1, wildPendingId: "recovery_act_2_0" }],
    box: [{ name: "Mouch", rarity: "Common", level: 1, instanceId: "inst_keep" }],
  };
  const ghosts = findReleasedMonsInInventory(save);
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0].source, "party");
  assert.equal(ghosts[0].name, "Shramp");
});

test("analyzeReleaseLogForSave summarizes releases and consistency", () => {
  const save = {
    releasedRecoveryIds: ["inst_removed"],
    releaseLog: [{
      id: "rel_1",
      at: "2026-07-14T12:00:00.000Z",
      name: "Chog",
      rarity: "Rare",
      level: 5,
      gold: 100,
      essence: 30,
      shards: 2,
      source: "box",
      instanceId: "inst_removed",
    }],
    party: [],
    box: [],
  };
  const report = analyzeReleaseLogForSave(save);
  assert.equal(report.releaseLogCount, 1);
  assert.equal(report.releasedRecoveryIdsCount, 1);
  assert.equal(report.salvageTotalsFromLog.gold, 100);
  assert.equal(report.salvageTotalsFromLog.essence, 30);
  assert.equal(report.salvageTotalsFromLog.shards, 2);
  assert.equal(report.inventoryConsistent, true);
  assert.equal(report.recentReleases.length, 1);
});
