import test from "node:test";
import assert from "node:assert/strict";
import {
  getTrainerLevelInfo,
  settleTrainerLevelRewards,
  trainerLevelRewardGrant,
} from "./trainer-rewards.js";

test("settleTrainerLevelRewards pays unpaid levels", () => {
  // Level 1 needs 100 XP; level 2 needs 115 → 215 XP reaches level 3.
  const info = getTrainerLevelInfo(215);
  assert.equal(info.level, 3);

  const save = {
    money: 1000,
    essence: 10,
    monShards: 0,
    trainerXp: 215,
    trainerRewardLevel: 1,
  };
  const out = settleTrainerLevelRewards(save);
  const grant2 = trainerLevelRewardGrant(2);
  const grant3 = trainerLevelRewardGrant(3);
  assert.equal(out.trainerRewardLevel, 3);
  assert.equal(out.money, 1000 + grant2.gold + grant3.gold);
  assert.equal(out.essence, 10 + grant2.essence + grant3.essence);
  assert.equal(out.monShards, grant2.monShards + grant3.monShards);
});

test("settleTrainerLevelRewards is a no-op when already paid", () => {
  const save = {
    money: 1000,
    essence: 10,
    monShards: 1,
    trainerXp: 215,
    trainerRewardLevel: 3,
  };
  const out = settleTrainerLevelRewards(save);
  assert.equal(out.money, 1000);
  assert.equal(out.trainerRewardLevel, 3);
});
