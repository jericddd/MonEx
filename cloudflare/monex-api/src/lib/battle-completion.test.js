import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCampaignCompletionId,
  buildPatrolCompletionId,
  maxAdventureGlobalFromCompletions,
  normalizeBattleCompletionId,
  sanitizeAccountBattleCompletions,
} from "./battle-completion.js";

test("buildCampaignCompletionId matches required format", () => {
  assert.equal(buildCampaignCompletionId(1, 26), "campaign:chapter-1:stage-26:first-clear");
});

test("normalizeBattleCompletionId maps legacy adv claim ids", () => {
  assert.equal(
    normalizeBattleCompletionId({ mode: "adventure", claimId: "adv-1-26-abc" }),
    "campaign:chapter-1:stage-26:first-clear"
  );
});

test("normalizeBattleCompletionId builds patrol id from scan metadata", () => {
  assert.equal(
    normalizeBattleCompletionId({
      mode: "patrol",
      claimId: "patrol-common-old",
      patrolScansDay: "2026-07-14",
      patrolScansUsed: 3,
      encounterId: "common",
    }),
    "patrol:day-2026-07-14:scan-3:common"
  );
});

test("maxAdventureGlobalFromCompletions reads campaign ledger", () => {
  const max = maxAdventureGlobalFromCompletions({
    "campaign:chapter-1:stage-26:first-clear": { reward: { gold: 1 } },
    "patrol:day-2026-07-14:scan-1:common": { reward: { gold: 1 } },
  });
  assert.equal(max, 26);
});

test("sanitizeAccountBattleCompletions caps size and normalizes reward", () => {
  const out = sanitizeAccountBattleCompletions({
    "campaign:chapter-1:stage-1:first-clear": {
      at: "2026-07-14T00:00:00.000Z",
      mode: "adventure",
      reward: { gold: 100, essence: 10, monShards: 1, trainerXp: 50, gear: null },
    },
  });
  assert.equal(out["campaign:chapter-1:stage-1:first-clear"].reward.gold, 100);
});
