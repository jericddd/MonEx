import { getDailyDayKey } from "./daily-reset.js";
import { applyDailyQuestReset } from "./quest-reset.js";
import { buildSavePayload, writeCloudSave } from "./save.js";
import { sanitizeQuestOneTimeResetsApplied } from "./save-validate.js";

/** Runs once per account when this fix deploys — forces a fresh daily quest bundle for today. */
export const DAILY_QUEST_FORCE_RESET_ID = "daily_quest_force_reset_2026-07-15";

/** Second pass — UTC+8 midnight rollover fix (Jul 16 2026). */
export const DAILY_QUEST_UTC8_RESET_ID = "daily_quest_utc8_reset_20260716";

export const QUEST_ONE_TIME_DAILY_RESET_IDS = [
  DAILY_QUEST_FORCE_RESET_ID,
  DAILY_QUEST_UTC8_RESET_ID,
];

export { sanitizeQuestOneTimeResetsApplied };

export function hasAppliedQuestOneTimeReset(save, resetId = DAILY_QUEST_FORCE_RESET_ID) {
  return sanitizeQuestOneTimeResetsApplied(save?.questOneTimeResetsApplied).includes(resetId);
}

function nextPendingOneTimeResetId(save) {
  const applied = sanitizeQuestOneTimeResetsApplied(save?.questOneTimeResetsApplied);
  return QUEST_ONE_TIME_DAILY_RESET_IDS.find((id) => !applied.includes(id)) || null;
}

/**
 * Force-reset today's daily quests without touching campaign, weekly, or economy grants.
 * Idempotent once questOneTimeResetsApplied contains DAILY_QUEST_FORCE_RESET_ID.
 */
export function applyOneTimeDailyQuestResetIfNeeded(save, now = new Date()) {
  if (!save || typeof save !== "object") return { save, changed: false };
  const pendingId = nextPendingOneTimeResetId(save);
  if (!pendingId) return { save, changed: false };

  const questState =
    save.questState && typeof save.questState === "object"
      ? JSON.parse(JSON.stringify(save.questState))
      : null;
  if (!questState) return { save, changed: false };

  applyDailyQuestReset(questState, now);
  const applied = sanitizeQuestOneTimeResetsApplied(save.questOneTimeResetsApplied);
  applied.push(pendingId);

  return {
    save: {
      ...save,
      questState,
      questOneTimeResetsApplied: applied,
    },
    changed: true,
  };
}

export async function reconcileOneTimeDailyQuestReset(kv, session, save, now = new Date()) {
  const { save: nextSave, changed } = applyOneTimeDailyQuestResetIfNeeded(save, now);
  if (!changed || !session?.xUserId) return nextSave;

  const payload = buildSavePayload(
    { ...nextSave, updatedAt: new Date(now).toISOString() },
    session,
    { now: now.getTime() }
  );
  return writeCloudSave(kv, session.xUserId, payload, { skipStaleCheck: true });
}

export function overlayMigratedDailyQuestState(existingSave, outgoingSave) {
  const applied = sanitizeQuestOneTimeResetsApplied(existingSave?.questOneTimeResetsApplied);
  if (!QUEST_ONE_TIME_DAILY_RESET_IDS.some((id) => applied.includes(id))) return outgoingSave;
  const exQs = existingSave.questState;
  const outQs = outgoingSave?.questState;
  if (!exQs || !outQs || typeof exQs !== "object" || typeof outQs !== "object") {
    return {
      ...outgoingSave,
      questOneTimeResetsApplied: existingSave.questOneTimeResetsApplied,
    };
  }

  const outKeys = Array.isArray(outQs.grantedKeys) ? outQs.grantedKeys.map(String) : [];
  const migratedKeys = Array.isArray(exQs.grantedKeys) ? exQs.grantedKeys.map(String) : [];
  const strippedOutKeys = outKeys.filter((key) => {
    if (key.startsWith("task:dailies:")) return false;
    if (key.startsWith("chest:dailies:")) return false;
    if (/^chest:\d+$/.test(key)) return false;
    return true;
  });
  const grantedKeys = [...new Set([...migratedKeys, ...strippedOutKeys])];

  return {
    ...outgoingSave,
    questOneTimeResetsApplied: existingSave.questOneTimeResetsApplied,
    questState: {
      ...outQs,
      dailyResetKey: exQs.dailyResetKey || getDailyDayKey(new Date()),
      dailyPoints: exQs.dailyPoints ?? 0,
      dailyClaimedChests: Array.isArray(exQs.dailyClaimedChests) ? [...exQs.dailyClaimedChests] : [],
      grantedKeys,
      tasks: {
        ...(outQs.tasks && typeof outQs.tasks === "object" ? outQs.tasks : {}),
        dailies: (exQs.tasks?.dailies || []).map((task) => ({ ...task })),
      },
    },
  };
}
