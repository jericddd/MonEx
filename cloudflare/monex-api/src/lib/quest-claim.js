import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { QUEST_TASK_DEFS, DAILY_QUEST_MILESTONES, WEEKLY_QUEST_MILESTONES, DAILY_QUEST_MAX_POINTS, WEEKLY_QUEST_MAX_POINTS, questGrantKey, questChestGrantKey, buildGrantFromTaskDef, DAILY_QUEST_CHEST_REWARDS, WEEKLY_QUEST_CHEST_REWARDS } from "./quest-rewards.js";
import { QUEST_TASK_GOALS } from "./save-economy-guard.js";
import { clampMonballs } from "./grant-monballs.js";
import { applyAuthoritativeMonballGrant } from "./save-reconcile.js";
import { applyQuestResetsToState } from "./quest-reset.js";
import { monballGrantFromTaskDef, recordMonballQuestGrantPaid } from "./quest-monball-grants.js";

const MAX_CLAIM_RETRIES = 3;

function applyGrantToSave(save, grant) {
  const out = { ...save };
  if (!grant) return out;
  if (grant.gold) out.money = (out.money || 0) + grant.gold;
  if (grant.essence) out.essence = (out.essence || 0) + grant.essence;
  if (grant.monShards) out.monShards = (out.monShards || 0) + grant.monShards;
  if (grant.trainerXp) out.trainerXp = (out.trainerXp || 0) + grant.trainerXp;
  return out;
}

function normalizeQuestState(save) {
  const qs = save.questState && typeof save.questState === "object" ? save.questState : {};
  return {
    tab: qs.tab || "dailies",
    dailyPoints: qs.dailyPoints || 0,
    weeklyPoints: qs.weeklyPoints || 0,
    dailyClaimedChests: Array.isArray(qs.dailyClaimedChests) ? [...qs.dailyClaimedChests] : [],
    weeklyClaimedChests: Array.isArray(qs.weeklyClaimedChests) ? [...qs.weeklyClaimedChests] : [],
    grantedKeys: Array.isArray(qs.grantedKeys) ? [...qs.grantedKeys] : [],
    dailyResetKey: qs.dailyResetKey ?? null,
    weeklyResetKey: qs.weeklyResetKey ?? null,
    tasks: {
      dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
      weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
      campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
    },
  };
}

function findTask(questState, tab, taskId) {
  return (questState.tasks[tab] || []).find((t) => t?.id === taskId) || null;
}

function upsertTask(questState, tab, taskId, patch) {
  const tasks = questState.tasks[tab] || [];
  const idx = tasks.findIndex((t) => t?.id === taskId);
  if (idx >= 0) {
    tasks[idx] = { ...tasks[idx], ...patch };
  } else {
    tasks.push({ id: taskId, progress: 0, claimed: false, ...patch });
  }
  questState.tasks[tab] = tasks;
}

async function persistQuestSave(kv, session, save, expectedRevision, startingMonballs, attempt = 0) {
  const { reconcileMonballsForCloudSave } = await import("./save-reconcile.js");
  const now = Date.now();
  let payload = buildSavePayload(
    { ...save, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  await reconcileMonballsForCloudSave(kv, session, payload, startingMonballs);
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, { expectedRevision });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      return persistQuestSave(kv, session, latest, latest.revision, startingMonballs, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "claim_conflict", save: err.existingSave };
    }
    throw err;
  }
}

async function finalizeMonballQuestGrant(kv, session, save, grantKey, monballAmount, startingMonballs, auditSource) {
  const amount = clampMonballs(monballAmount);
  if (!amount) return save;
  let nextSave = await applyAuthoritativeMonballGrant(kv, session, amount, startingMonballs, auditSource);
  nextSave = await recordMonballQuestGrantPaid(kv, session, nextSave, grantKey, amount, startingMonballs);
  return nextSave;
}

async function rollbackFailedMonballClaim(kv, session, preClaimSave, persistedSave) {
  const rollback = buildSavePayload(
    {
      ...persistedSave,
      money: preClaimSave.money ?? 0,
      essence: preClaimSave.essence ?? 0,
      monShards: preClaimSave.monShards ?? 0,
      trainerXp: preClaimSave.trainerXp ?? 0,
      monballs: preClaimSave.monballs ?? persistedSave.monballs,
      questState: normalizeQuestState(preClaimSave).questState,
      questMonballPaidAmounts: preClaimSave.questMonballPaidAmounts,
      updatedAt: new Date().toISOString(),
    },
    session
  );
  return writeCloudSave(kv, session.xUserId, rollback, { skipStaleCheck: true });
}

async function ensureQuestStateCurrent(kv, session, save, expectedRevision, startingMonballs) {
  let questState = normalizeQuestState(save);
  let workingSave = save;
  let revision = expectedRevision;
  if (applyQuestResetsToState(questState, new Date())) {
    const resetResult = await persistQuestSave(
      kv,
      session,
      { ...workingSave, questState },
      revision,
      startingMonballs
    );
    if (!resetResult.ok) return { ok: false, ...resetResult };
    workingSave = resetResult.save;
    questState = normalizeQuestState(workingSave);
    revision = workingSave.revision;
  }
  return { ok: true, save: workingSave, questState, expectedRevision: revision };
}

export async function claimQuestTask(kv, session, { tab, taskId, expectedRevision }, startingMonballs = 10) {
  const validTabs = ["dailies", "weeklies", "campaign"];
  if (!validTabs.includes(tab)) return { ok: false, error: "invalid_tab" };
  const id = String(taskId || "").trim();
  if (!id) return { ok: false, error: "task_id_required" };

  const goal = QUEST_TASK_GOALS[tab]?.[id];
  const def = (QUEST_TASK_DEFS[tab] || []).find((d) => d.id === id);
  if (!def || goal == null) return { ok: false, error: "invalid_task" };

  const grantKey = questGrantKey(tab, id);
  const { save: loadedSave } = await loadCloudSave(kv, session.xUserId);
  const ensured = await ensureQuestStateCurrent(kv, session, loadedSave, expectedRevision, startingMonballs);
  if (!ensured.ok) return ensured;
  const save = ensured.save;
  const expectedRev = ensured.expectedRevision;
  const questState = ensured.questState;
  const task = findTask(questState, tab, id);
  if (!task) return { ok: false, error: "task_not_found" };
  if (task.claimed || questState.grantedKeys.includes(grantKey)) {
    return { ok: true, alreadyClaimed: true, save };
  }
  if ((task.progress || 0) < goal) return { ok: false, error: "progress_insufficient" };

  const grant = buildGrantFromTaskDef(def);
  if (!grant) return { ok: false, error: "no_reward" };
  const monballAmount = monballGrantFromTaskDef(def);

  upsertTask(questState, tab, id, { claimed: true });
  questState.grantedKeys.push(grantKey);
  if (tab === "dailies") {
    questState.dailyPoints = Math.min(
      DAILY_QUEST_MAX_POINTS,
      (questState.dailyPoints || 0) + (def.points || 0)
    );
  }
  if (tab === "weeklies") {
    questState.weeklyPoints = Math.min(
      WEEKLY_QUEST_MAX_POINTS,
      (questState.weeklyPoints || 0) + (def.points || 0)
    );
  }

  let nextSave = applyGrantToSave(save, grant);
  nextSave.questState = questState;

  const result = await persistQuestSave(kv, session, nextSave, expectedRev, startingMonballs);
  if (!result.ok) return result;

  let finalSave = result.save;
  if (monballAmount > 0) {
    try {
      finalSave = await finalizeMonballQuestGrant(
        kv,
        session,
        finalSave,
        grantKey,
        monballAmount,
        startingMonballs,
        "quest_task_claim"
      );
    } catch (err) {
      const rolledBack = await rollbackFailedMonballClaim(kv, session, save, result.save);
      return {
        ok: false,
        error: "monball_grant_failed",
        message: err?.message || String(err),
        save: rolledBack,
      };
    }
  }

  return { ok: true, grantKey, grant, save: finalSave, alreadyClaimed: false };
}

export async function claimQuestChest(kv, session, { track, milestone, expectedRevision }, startingMonballs = 10) {
  const ms = Number(milestone);
  if (!Number.isFinite(ms)) return { ok: false, error: "invalid_milestone" };
  const trackKey = track === "weekly" || track === "weeklies" ? "weeklies" : "dailies";
  const milestones = trackKey === "weeklies" ? WEEKLY_QUEST_MILESTONES : DAILY_QUEST_MILESTONES;
  if (!milestones.includes(ms)) return { ok: false, error: "invalid_milestone" };

  const chest = trackKey === "weeklies" ? WEEKLY_QUEST_CHEST_REWARDS[ms] : DAILY_QUEST_CHEST_REWARDS[ms];
  if (!chest?.grant) return { ok: false, error: "no_reward" };

  const grantKey = questChestGrantKey(trackKey, ms);
  const { save: loadedSave } = await loadCloudSave(kv, session.xUserId);
  const ensured = await ensureQuestStateCurrent(kv, session, loadedSave, expectedRevision, startingMonballs);
  if (!ensured.ok) return ensured;
  const save = ensured.save;
  const expectedRev = ensured.expectedRevision;
  const questState = ensured.questState;
  const points = trackKey === "weeklies" ? questState.weeklyPoints : questState.dailyPoints;
  const claimedList = trackKey === "weeklies" ? questState.weeklyClaimedChests : questState.dailyClaimedChests;

  if (questState.grantedKeys.includes(grantKey) || claimedList.includes(ms)) {
    return { ok: true, alreadyClaimed: true, save };
  }
  if ((points || 0) < ms) return { ok: false, error: "points_insufficient" };

  if (trackKey === "weeklies") {
    questState.weeklyClaimedChests = [...claimedList, ms].sort((a, b) => a - b);
  } else {
    questState.dailyClaimedChests = [...claimedList, ms].sort((a, b) => a - b);
  }
  questState.grantedKeys.push(grantKey);

  const monballAmount = clampMonballs(chest.grant.monballs || 0);
  let nextSave = applyGrantToSave(save, chest.grant);
  nextSave.questState = questState;

  const result = await persistQuestSave(kv, session, nextSave, expectedRev, startingMonballs);
  if (!result.ok) return result;

  let finalSave = result.save;
  if (monballAmount > 0) {
    try {
      finalSave = await finalizeMonballQuestGrant(
        kv,
        session,
        finalSave,
        grantKey,
        monballAmount,
        startingMonballs,
        "quest_chest_claim"
      );
    } catch (err) {
      const rolledBack = await rollbackFailedMonballClaim(kv, session, save, result.save);
      return {
        ok: false,
        error: "monball_grant_failed",
        message: err?.message || String(err),
        save: rolledBack,
      };
    }
  }

  return { ok: true, grantKey, grant: chest.grant, save: finalSave, alreadyClaimed: false };
}
