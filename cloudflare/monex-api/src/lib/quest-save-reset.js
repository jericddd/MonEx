import { applyQuestResetsToState } from "./quest-reset.js";
import { buildSavePayload, writeCloudSave } from "./save.js";

/**
 * Apply UTC+8 daily/weekly quest + milestone rollover on cloud save read paths.
 * Persists when stale so clients cannot keep yesterday's tasks after midnight UTC+8.
 */
export async function ensureCloudSaveQuestResets(kv, session, save, startingMonballs = 10) {
  if (!kv || !session?.xUserId || !save || typeof save !== "object") return save;
  const questState =
    save.questState && typeof save.questState === "object"
      ? JSON.parse(JSON.stringify(save.questState))
      : null;
  if (!questState) return save;

  const paidMap =
    save.questMonballPaidAmounts && typeof save.questMonballPaidAmounts === "object"
      ? { ...save.questMonballPaidAmounts }
      : {};
  const changed = applyQuestResetsToState(questState, new Date(), {
    repairDesync: true,
    paidMap,
  });
  if (!changed) return save;

  const payload = buildSavePayload(
    { ...save, questState, questMonballPaidAmounts: paidMap },
    session
  );
  return writeCloudSave(kv, session.xUserId, payload, { skipStaleCheck: true });
}
