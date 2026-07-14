import test from "node:test";
import assert from "node:assert/strict";
import { preserveBattleCompletionState } from "./save-economy-guard.js";

test("preserveBattleCompletionState blocks adventureGlobalBest regression", () => {
  const existing = {
    adventureGlobalBest: 26,
    accountBattleCompletions: {
      "campaign:chapter-1:stage-26:first-clear": {
        at: "2026-07-14T00:00:00.000Z",
        mode: "adventure",
        reward: { gold: 392, essence: 114, monShards: 0, trainerXp: 700, gear: null },
      },
    },
  };
  const incoming = {
    adventureGlobalBest: 25,
    accountBattleCompletions: {},
    money: 5000,
  };
  const out = preserveBattleCompletionState(existing, incoming);
  assert.equal(out.adventureGlobalBest, 26);
  assert.ok(out.accountBattleCompletions["campaign:chapter-1:stage-26:first-clear"]);
});
