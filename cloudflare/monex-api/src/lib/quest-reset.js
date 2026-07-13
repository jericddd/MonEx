import {
  getDailyDayKey,
  getDailyWeekKey,
  needsDailyQuestReset,
  needsWeeklyQuestReset,
} from "./daily-reset.js";
import { QUEST_TASK_DEFS, questChestGrantKey, questGrantKey } from "./quest-rewards.js";

function createQuestTasksFromDefs(tab) {
  return (QUEST_TASK_DEFS[tab] || []).map((def) => ({
    id: def.id,
    progress: 0,
    claimed: false,
  }));
}

function filterQuestGrantedKeys(keys, opts = {}) {
  const list = Array.isArray(keys) ? keys : [];
  if (opts.clearAll) return [];
  return list.filter((key) => {
    if (opts.clearDailies && key.startsWith("task:dailies:")) return false;
    if (opts.clearWeeklies && key.startsWith("task:weeklies:")) return false;
    if (opts.clearDailyChests && (key.startsWith("chest:dailies:") || /^chest:\d+$/.test(key))) {
      return false;
    }
    if (opts.clearWeeklyChests && key.startsWith("chest:weeklies:")) return false;
    if (
      opts.clearChests &&
      (key.startsWith("chest:dailies:") || key.startsWith("chest:weeklies:") || /^chest:\d+$/.test(key))
    ) {
      return false;
    }
    return true;
  });
}

function isDailyQuestBundleDesynced(qs, now = new Date()) {
  if (needsDailyQuestReset(qs?.dailyResetKey, now)) return false;
  const tasks = qs?.tasks?.dailies || [];
  const hasClaimedTasks = tasks.some((t) => t.claimed);
  const milestonesReset = (qs.dailyPoints || 0) === 0 && !(qs.dailyClaimedChests || []).length;
  return milestonesReset && hasClaimedTasks;
}

function isWeeklyQuestBundleDesynced(qs, now = new Date()) {
  if (needsWeeklyQuestReset(qs?.weeklyResetKey, now)) return false;
  const tasks = qs?.tasks?.weeklies || [];
  const hasClaimedTasks = tasks.some((t) => t.claimed);
  const milestonesReset = (qs.weeklyPoints || 0) === 0 && !(qs.weeklyClaimedChests || []).length;
  return milestonesReset && hasClaimedTasks;
}

export function applyDailyQuestReset(qs, now = new Date()) {
  qs.dailyResetKey = getDailyDayKey(now);
  qs.dailyPoints = 0;
  qs.dailyClaimedChests = [];
  qs.grantedKeys = filterQuestGrantedKeys(qs.grantedKeys, {
    clearDailies: true,
    clearDailyChests: true,
  });
  qs.tasks = qs.tasks && typeof qs.tasks === "object" ? qs.tasks : {};
  qs.tasks.dailies = createQuestTasksFromDefs("dailies");
}

export function applyWeeklyQuestReset(qs, now = new Date()) {
  qs.weeklyResetKey = getDailyWeekKey(now);
  qs.dailyPoints = 0;
  qs.weeklyPoints = 0;
  qs.dailyClaimedChests = [];
  qs.weeklyClaimedChests = [];
  qs.grantedKeys = filterQuestGrantedKeys(qs.grantedKeys, {
    clearDailies: true,
    clearWeeklies: true,
    clearChests: true,
  });
  qs.tasks = qs.tasks && typeof qs.tasks === "object" ? qs.tasks : {};
  qs.tasks.weeklies = createQuestTasksFromDefs("weeklies");
  qs.tasks.dailies = createQuestTasksFromDefs("dailies");
  qs.dailyResetKey = getDailyDayKey(now);
}

/** Keep daily/weekly tasks and milestone tracks aligned on the UTC+8 schedule. */
export function applyQuestResetsToState(questState, now = new Date(), options = {}) {
  const repairDesync = options.repairDesync !== false;
  if (!questState || typeof questState !== "object") return false;
  if (needsWeeklyQuestReset(questState.weeklyResetKey, now) || (repairDesync && isWeeklyQuestBundleDesynced(questState, now))) {
    applyWeeklyQuestReset(questState, now);
    return true;
  }
  if (needsDailyQuestReset(questState.dailyResetKey, now) || (repairDesync && isDailyQuestBundleDesynced(questState, now))) {
    applyDailyQuestReset(questState, now);
    return true;
  }
  return false;
}

export { questGrantKey, questChestGrantKey };
