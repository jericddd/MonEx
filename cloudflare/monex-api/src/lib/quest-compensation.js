import { questGrantKey } from "./quest-rewards.js";
import {
  getMonballQuestPaidAmount,
  isMonballQuestFullyPaid,
} from "./quest-monball-grants.js";
import { applyAuthoritativeMonballGrant } from "./save-reconcile.js";
import { buildSavePayload, writeCloudSave } from "./save.js";

export const CAMPAIGN_C1_COMPENSATION_ID = "campaign_c1_monball_compensation_2026-07-15";
export const CAMPAIGN_C1_GRANT_KEY = questGrantKey("campaign", "c1");
export const CAMPAIGN_C1_REWARD_AMOUNT = 15;

export function sanitizeAccountCompensationsApplied(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const id = String(key || "").trim().slice(0, 64);
    if (!id) continue;
    if (!val || typeof val !== "object") continue;
    const amount = Math.max(0, Math.floor(Number(val.amount) || 0));
    const at = typeof val.at === "string" ? val.at.slice(0, 32) : null;
    if (amount > 0) out[id] = { amount, at: at || new Date(0).toISOString() };
  }
  return out;
}

export function hasAppliedAccountCompensation(save, compensationId = CAMPAIGN_C1_COMPENSATION_ID) {
  return Boolean(sanitizeAccountCompensationsApplied(save?.accountCompensationsApplied)[compensationId]);
}

function findCampaignTask(save, taskId) {
  const tasks = save?.questState?.tasks?.campaign;
  if (!Array.isArray(tasks)) return null;
  return tasks.find((task) => task?.id === taskId) || null;
}

export function evaluateCampaignC1Compensation(save) {
  const grantKey = CAMPAIGN_C1_GRANT_KEY;
  const expected = CAMPAIGN_C1_REWARD_AMOUNT;
  const grantedKeys = Array.isArray(save?.questState?.grantedKeys)
    ? save.questState.grantedKeys.map(String)
    : [];
  const task = findCampaignTask(save, "c1");
  const claimed = Boolean(task?.claimed) || grantedKeys.includes(grantKey);
  const paid = getMonballQuestPaidAmount(save, grantKey);
  const alreadyPaid = isMonballQuestFullyPaid(save, grantKey, expected);
  const alreadyCompensated = hasAppliedAccountCompensation(save);

  if (!claimed) {
    return { eligible: false, reason: "achievement_not_claimed", owedAmount: 0, paid, expected };
  }
  if (alreadyPaid || alreadyCompensated) {
    return {
      eligible: false,
      reason: alreadyCompensated ? "compensation_already_applied" : "reward_already_paid",
      owedAmount: 0,
      paid,
      expected,
    };
  }
  const owedAmount = Math.max(0, expected - paid);
  if (!owedAmount) {
    return { eligible: false, reason: "nothing_owed", owedAmount: 0, paid, expected };
  }
  return { eligible: true, reason: "owed", owedAmount, paid, expected, grantKey };
}

export async function compensateCampaignC1Monball(
  kv,
  session,
  save,
  startingMonballs = 10,
  { dryRun = false, now = new Date() } = {}
) {
  const evaluation = evaluateCampaignC1Compensation(save);
  if (!evaluation.eligible) {
    return {
      ok: true,
      applied: false,
      reason: evaluation.reason,
      evaluation,
      save,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      applied: false,
      dryRun: true,
      reason: "preview",
      evaluation,
      save,
    };
  }

  let working = await applyAuthoritativeMonballGrant(
    kv,
    session,
    evaluation.owedAmount,
    startingMonballs,
    "campaign_c1_compensation"
  );

  const paidMap =
    working?.questMonballPaidAmounts && typeof working.questMonballPaidAmounts === "object"
      ? { ...working.questMonballPaidAmounts }
      : {};
  paidMap[evaluation.grantKey] = evaluation.expected;

  const compensations = sanitizeAccountCompensationsApplied(working?.accountCompensationsApplied);
  compensations[CAMPAIGN_C1_COMPENSATION_ID] = {
    amount: evaluation.owedAmount,
    at: now.toISOString(),
  };

  const payload = buildSavePayload(
    {
      ...working,
      questMonballPaidAmounts: paidMap,
      accountCompensationsApplied: compensations,
      updatedAt: now.toISOString(),
    },
    session,
    { now: now.getTime() }
  );
  working = await writeCloudSave(kv, session.xUserId, payload, { skipStaleCheck: true });

  return {
    ok: true,
    applied: true,
    reason: "compensated",
    evaluation,
    save: working,
    monballs: working.monballs,
  };
}
