/**
 * Trainer level rewards settled on the server when trainerXp crosses a level.
 * Mirrors play/index.html grantTrainerLevelReward + getTrainerXpForLevel.
 */

export function getTrainerXpForLevel(level) {
  return Math.floor(100 * Math.pow(1.15, level - 1));
}

export function getTrainerLevelInfo(xp) {
  let level = 1;
  let remaining = Math.max(0, Math.floor(Number(xp) || 0));
  let needed = getTrainerXpForLevel(level);
  while (remaining >= needed) {
    remaining -= needed;
    level++;
    needed = getTrainerXpForLevel(level);
  }
  return { level, progress: remaining, needed };
}

export function trainerLevelRewardGrant(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  const gold = 35 + lv * 15;
  let essence = 0;
  let monShards = 0;
  if (lv % 5 === 0) essence = 8 + lv * 2;
  if (lv % 10 === 0) monShards = 1;
  return { gold, essence, monShards };
}

/**
 * Pay any unpaid trainer level bonuses implied by trainerXp vs trainerRewardLevel.
 */
export function settleTrainerLevelRewards(save) {
  if (!save || typeof save !== "object") return save;
  const info = getTrainerLevelInfo(save.trainerXp);
  let rewardLevel = Math.max(1, Math.floor(Number(save.trainerRewardLevel) || 1));
  if (rewardLevel >= info.level) {
    return {
      ...save,
      trainerRewardLevel: Math.max(rewardLevel, 1),
    };
  }

  let money = Math.max(0, Math.floor(Number(save.money) || 0));
  let essence = Math.max(0, Math.floor(Number(save.essence) || 0));
  let monShards = Math.max(0, Math.floor(Number(save.monShards) || 0));

  while (rewardLevel < info.level) {
    rewardLevel += 1;
    const grant = trainerLevelRewardGrant(rewardLevel);
    money += grant.gold;
    essence += grant.essence;
    monShards += grant.monShards;
  }

  return {
    ...save,
    money,
    essence,
    monShards,
    trainerRewardLevel: rewardLevel,
  };
}
