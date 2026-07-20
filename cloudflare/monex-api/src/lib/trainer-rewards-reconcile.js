/**
 * Pay unpaid trainer level bonuses on cloud-save read paths (migration + catch-up).
 */
import { buildSavePayload, writeCloudSave } from "./save.js";
import { getTrainerLevelInfo, settleTrainerLevelRewards } from "./trainer-rewards.js";

export async function reconcileTrainerLevelRewards(kv, session, save, startingMonballs = 10) {
  if (!kv || !session?.xUserId || !save || typeof save !== "object") return save;
  const info = getTrainerLevelInfo(save.trainerXp);
  const rewardLevel = Math.max(1, Math.floor(Number(save.trainerRewardLevel) || 1));
  if (rewardLevel >= info.level) return save;

  const settled = settleTrainerLevelRewards(save);
  if (
    settled.money === save.money
    && settled.essence === save.essence
    && settled.monShards === save.monShards
    && settled.trainerRewardLevel === save.trainerRewardLevel
  ) {
    return save;
  }

  const payload = buildSavePayload(settled, session);
  return writeCloudSave(kv, session.xUserId, payload, { skipStaleCheck: true });
}
