import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./equipment-unlock.js";

const unlock = globalThis.MonExEquipmentUnlock;

describe("equipment unlock Chapter 2 Stage 9", () => {
  it("requires global progress 49 (Ch2 S9)", () => {
    assert.equal(unlock.UNLOCK_GLOBAL_PROGRESS, 49);
    assert.equal(unlock.UNLOCK_CHAPTER, 2);
    assert.equal(unlock.UNLOCK_STAGE, 9);
  });

  it("blocks below Chapter 2 Stage 9", () => {
    assert.equal(unlock.isEquipmentUnlocked(0), false);
    assert.equal(unlock.isEquipmentUnlocked(9), false);
    assert.equal(unlock.isEquipmentUnlocked(48), false);
  });

  it("unlocks at Chapter 2 Stage 9 and beyond", () => {
    assert.equal(unlock.isEquipmentUnlocked(49), true);
    assert.equal(unlock.isEquipmentUnlocked(80), true);
  });

  it("does not unlock from current chapter alone", () => {
    const ch2s1 = unlock.getGlobalAdventureProgress(2, 1);
    assert.equal(ch2s1, 41);
    assert.equal(unlock.isEquipmentUnlocked(ch2s1), false);
  });

  it("maps global 49 to Chapter 2 Stage 9", () => {
    assert.deepEqual(unlock.globalProgressToChapterStage(49), { chapter: 2, stage: 9 });
  });
});
