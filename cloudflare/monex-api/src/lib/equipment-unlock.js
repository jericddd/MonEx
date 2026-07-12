/** Armory / equipment unlock — Chapter 2, Stage 9 (global progress 49). */

const STAGES_PER_CHAPTER = 40;

export const EQUIPMENT_UNLOCK_CHAPTER = 2;
export const EQUIPMENT_UNLOCK_STAGE = 9;

export function getGlobalAdventureProgress(chapter, stage) {
  const ch = Math.max(1, chapter || 1);
  const st = Math.max(1, stage || 1);
  return (ch - 1) * STAGES_PER_CHAPTER + st;
}

export function globalProgressToChapterStage(globalProgress) {
  const g = Math.max(1, globalProgress || 1);
  return {
    chapter: Math.floor((g - 1) / STAGES_PER_CHAPTER) + 1,
    stage: ((g - 1) % STAGES_PER_CHAPTER) + 1,
  };
}

export const EQUIPMENT_UNLOCK_GLOBAL_PROGRESS = getGlobalAdventureProgress(
  EQUIPMENT_UNLOCK_CHAPTER,
  EQUIPMENT_UNLOCK_STAGE,
);

/** Armory Shop gate only — Party/Box equip UI is not gated by this. */
export function isEquipmentUnlocked(adventureGlobalBest) {
  const best = Math.max(0, Math.floor(Number(adventureGlobalBest) || 0));
  return best >= EQUIPMENT_UNLOCK_GLOBAL_PROGRESS;
}

export function getEquipmentUnlockLabel() {
  return `Chapter ${EQUIPMENT_UNLOCK_CHAPTER}, Stage ${EQUIPMENT_UNLOCK_STAGE}`;
}
