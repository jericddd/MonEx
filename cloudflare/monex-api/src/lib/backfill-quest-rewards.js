import { buildSavePayload } from "./save.js";
import { findUngrantedQuestRewards } from "./quest-rewards.js";

function makeMailId() {
  return `mail_quest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function describeRecoveryMail(grants) {
  const parts = [];
  if (grants.gold) parts.push(`${grants.gold} Gold`);
  if (grants.essence) parts.push(`${grants.essence} KB's Onion`);
  if (grants.monballs) parts.push(`${grants.monballs} Monball${grants.monballs > 1 ? "s" : ""}`);
  if (grants.monShards) parts.push(`${grants.monShards} Shard${grants.monShards > 1 ? "s" : ""}`);
  if (grants.trainerXp) parts.push(`${grants.trainerXp} Trainer XP`);
  return parts.join(", ");
}

/**
 * Deliver missing quest rewards via mailbox and mark grantedKeys so they are not duplicated.
 */
export function backfillQuestRewardsForSave(save, options = {}) {
  const now = options.now ?? Date.now();
  const { grants, keys } = findUngrantedQuestRewards(save?.questState);
  if (!grants || !keys.length) {
    return { changed: false, save, keys: [], grants: null };
  }

  const questState = {
    ...(save.questState || {}),
    grantedKeys: [
      ...new Set([
        ...(Array.isArray(save.questState?.grantedKeys) ? save.questState.grantedKeys : []),
        ...keys,
      ]),
    ],
  };

  const item = {
    id: makeMailId(),
    type: "resources",
    grant: grants,
    title: "Quest Reward Recovery",
    body: `Missing rewards from quest claims: ${describeRecoveryMail(grants)}. Open Mailbox to claim.`,
    createdAt: new Date(now).toISOString(),
  };

  const nextSave = buildSavePayload(
    {
      ...save,
      questState,
      mailbox: [item, ...(save.mailbox || [])],
      updatedAt: new Date(now).toISOString(),
    },
    { username: save?.xHandle || "" },
    { now }
  );

  return {
    changed: true,
    save: nextSave,
    keys,
    grants,
    mailId: item.id,
  };
}
