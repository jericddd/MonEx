import {
  QUEST_TASK_DEFS,
  DAILY_QUEST_CHEST_REWARDS,
  WEEKLY_QUEST_CHEST_REWARDS,
  DAILY_QUEST_MILESTONES,
  WEEKLY_QUEST_MILESTONES,
  questGrantKey,
  questChestGrantKey,
  buildGrantFromTaskDef,
} from "./quest-rewards.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { applyAuthoritativeMonballGrant } from "./save-reconcile.js";

function normalizePaidMap(save) {
  const raw = save?.questMonballPaidAmounts;
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const n = Math.max(0, Math.floor(Number(val) || 0));
    if (n > 0) out[String(key)] = n;
  }
  return out;
}

/** Keys with monball rewards that were granted but not fully paid out. */
export function findUnpaidMonballQuestGrants(questState, paidMap = {}) {
  if (!questState || typeof questState !== "object") return [];
  const granted = new Set(
    Array.isArray(questState.grantedKeys) ? questState.grantedKeys.map(String) : []
  );
  const owed = [];

  for (const tab of ["dailies", "weeklies", "campaign"]) {
    for (const def of QUEST_TASK_DEFS[tab] || []) {
      if (def.rewardKey !== "monball") continue;
      const key = questGrantKey(tab, def.id);
      if (!granted.has(key)) continue;
      const expected = Math.max(0, Math.floor(Number(def.rewardAmount) || 0));
      const paid = Math.max(0, Math.floor(Number(paidMap[key]) || 0));
      const delta = expected - paid;
      if (delta > 0) owed.push({ key, amount: delta, expected });
    }
  }

  const dailyClaimed = Array.isArray(questState.dailyClaimedChests) ? questState.dailyClaimedChests : [];
  for (const ms of DAILY_QUEST_MILESTONES) {
    if (!dailyClaimed.includes(ms)) continue;
    const key = questChestGrantKey("dailies", ms);
    const legacyKey = `chest:${ms}`;
    if (!granted.has(key) && !granted.has(legacyKey)) continue;
    const grant = DAILY_QUEST_CHEST_REWARDS[ms]?.grant;
    const expected = Math.max(0, Math.floor(Number(grant?.monballs) || 0));
    if (!expected) continue;
    const paid = Math.max(0, Math.floor(Number(paidMap[key]) || 0));
    const delta = expected - paid;
    if (delta > 0) owed.push({ key, amount: delta, expected });
  }

  const weeklyClaimed = Array.isArray(questState.weeklyClaimedChests) ? questState.weeklyClaimedChests : [];
  for (const ms of WEEKLY_QUEST_MILESTONES) {
    if (!weeklyClaimed.includes(ms)) continue;
    const key = questChestGrantKey("weeklies", ms);
    if (!granted.has(key)) continue;
    const grant = WEEKLY_QUEST_CHEST_REWARDS[ms]?.grant;
    const expected = Math.max(0, Math.floor(Number(grant?.monballs) || 0));
    if (!expected) continue;
    const paid = Math.max(0, Math.floor(Number(paidMap[key]) || 0));
    const delta = expected - paid;
    if (delta > 0) owed.push({ key, amount: delta, expected });
  }

  return owed;
}

/**
 * Backfill monball quest payouts for accounts that were marked claimed without a full credit.
 * Uses questMonballPaidAmounts so each grant key is paid at most once per configured amount.
 */
export async function reconcileUnpaidMonballQuestGrants(kv, session, save, startingMonballs = 10) {
  if (!session?.xUserId || !save) return save;
  const paidMap = normalizePaidMap(save);
  const owed = findUnpaidMonballQuestGrants(save.questState, paidMap);
  if (!owed.length) return save;

  let working = save;
  for (const entry of owed) {
    working = await applyAuthoritativeMonballGrant(
      kv,
      session,
      entry.amount,
      startingMonballs,
      "quest_monball_backfill"
    );
    paidMap[entry.key] = entry.expected;
    working = {
      ...working,
      questMonballPaidAmounts: { ...paidMap },
    };
    working = buildSavePayload(
      { ...working, updatedAt: new Date().toISOString() },
      session
    );
    working = await writeCloudSave(kv, session.xUserId, working, { skipStaleCheck: true });
  }
  return working;
}

export function monballGrantFromTaskDef(def) {
  const grant = buildGrantFromTaskDef(def);
  return grant?.monballs ? Math.max(0, Math.floor(Number(grant.monballs) || 0)) : 0;
}

export async function recordMonballQuestGrantPaid(kv, session, save, grantKey, amount, startingMonballs = 10) {
  const paid = Math.max(0, Math.floor(Number(amount) || 0));
  if (!paid || !grantKey) return save;
  const paidMap = normalizePaidMap(save);
  paidMap[String(grantKey)] = paid;
  const nextSave = buildSavePayload(
    {
      ...save,
      questMonballPaidAmounts: paidMap,
      updatedAt: new Date().toISOString(),
    },
    session
  );
  return writeCloudSave(kv, session.xUserId, nextSave, { skipStaleCheck: true });
}
