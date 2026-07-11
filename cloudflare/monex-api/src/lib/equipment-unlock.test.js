import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EQUIPMENT_UNLOCK_GLOBAL_PROGRESS,
  EQUIPMENT_UNLOCK_CHAPTER,
  EQUIPMENT_UNLOCK_STAGE,
  getGlobalAdventureProgress,
  globalProgressToChapterStage,
  isEquipmentUnlocked,
} from "./equipment-unlock.js";

describe("equipment-unlock server mirror", () => {
  it("requires Chapter 2 Stage 9", () => {
    assert.equal(EQUIPMENT_UNLOCK_GLOBAL_PROGRESS, 49);
    assert.equal(EQUIPMENT_UNLOCK_CHAPTER, 2);
    assert.equal(EQUIPMENT_UNLOCK_STAGE, 9);
    assert.equal(getGlobalAdventureProgress(2, 9), 49);
  });

  it("blocks premature global progress values", () => {
    assert.equal(isEquipmentUnlocked(9), false);
    assert.equal(isEquipmentUnlocked(48), false);
  });

  it("allows eligible progression", () => {
    assert.equal(isEquipmentUnlocked(49), true);
    assert.deepEqual(globalProgressToChapterStage(49), { chapter: 2, stage: 9 });
  });
});
