/**
 * Armory / equipment unlock — Chapter 2, Stage 9 (global progress 49).
 * Mirrors cloudflare/monex-api/src/lib/equipment-unlock.js.
 */
(() => {
  "use strict";

  const STAGES_PER_CHAPTER = 40;
  const UNLOCK_CHAPTER = 2;
  const UNLOCK_STAGE = 9;

  function getGlobalAdventureProgress(chapter, stage) {
    const ch = Math.max(1, chapter || 1);
    const st = Math.max(1, stage || 1);
    return (ch - 1) * STAGES_PER_CHAPTER + st;
  }

  function globalProgressToChapterStage(globalProgress) {
    const g = Math.max(1, globalProgress || 1);
    return {
      chapter: Math.floor((g - 1) / STAGES_PER_CHAPTER) + 1,
      stage: ((g - 1) % STAGES_PER_CHAPTER) + 1,
    };
  }

  const UNLOCK_GLOBAL_PROGRESS = getGlobalAdventureProgress(UNLOCK_CHAPTER, UNLOCK_STAGE);

  /**
   * Armory Shop unlock only (synthesize / enhance / ascension).
   * Party and Box equip UI is always available regardless of this gate.
   */
  function isEquipmentUnlocked(adventureGlobalBest) {
    const best = Math.max(0, Math.floor(Number(adventureGlobalBest) || 0));
    return best >= UNLOCK_GLOBAL_PROGRESS;
  }

  function getEquipmentUnlockLabel() {
    return `Chapter ${UNLOCK_CHAPTER}, Stage ${UNLOCK_STAGE}`;
  }

  const api = {
    STAGES_PER_CHAPTER,
    UNLOCK_CHAPTER,
    UNLOCK_STAGE,
    UNLOCK_GLOBAL_PROGRESS,
    getGlobalAdventureProgress,
    globalProgressToChapterStage,
    isEquipmentUnlocked,
    getEquipmentUnlockLabel,
  };

  if (typeof window !== "undefined") window.MonExEquipmentUnlock = api;
  if (typeof globalThis !== "undefined") globalThis.MonExEquipmentUnlock = api;
})();
