import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { creditCatchMonballs, clampMonballs } from "./grant-monballs.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";
import {
  findShopItem,
  multiplyShopCost,
  canAffordShopCost,
  spendShopCost,
} from "./shop-items.js";
import { generateShopGear } from "./shop-gear.js";
import { LIMITS } from "./save-validate.js";
import { QUEST_TASK_GOALS } from "./save-economy-guard.js";

const MAX_CLAIM_RETRIES = 3;
const MAX_SHOP_QTY = 20;

/** Shop-buy quest task ids mirrored from play/index.html track "shop_buy". */
const SHOP_BUY_TASKS = Object.freeze([
  { tab: "dailies", id: "d3" },
  { tab: "dailies", id: "d10" },
  { tab: "weeklies", id: "w9" },
]);

function bumpShopBuyQuestProgress(questState, qty) {
  const qs = questState && typeof questState === "object" ? { ...questState } : {};
  const tasks = {
    dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
    weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
    campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
  };
  const add = Math.max(1, Math.floor(Number(qty) || 1));
  for (const { tab, id } of SHOP_BUY_TASKS) {
    const goal = QUEST_TASK_GOALS[tab]?.[id] ?? 1;
    const list = tasks[tab];
    const idx = list.findIndex((t) => t?.id === id);
    if (idx >= 0) {
      const task = list[idx];
      list[idx] = {
        ...task,
        progress: Math.min(goal, (task.progress || 0) + add),
      };
    } else {
      list.push({ id, progress: Math.min(goal, add), claimed: false });
    }
  }
  return { ...qs, tasks };
}

function applyMatsGrant(save, grant, qty) {
  const out = { ...save };
  const mult = Math.max(1, qty);
  if (grant.essence) out.essence = (out.essence || 0) + grant.essence * mult;
  if (grant.monShards) out.monShards = (out.monShards || 0) + grant.monShards * mult;
  if (grant.monballs) out.monballs = clampMonballs((out.monballs || 0) + grant.monballs * mult);
  return out;
}

function grantShopGearItems(save, gearGrant, qty) {
  const inventory = [...(save.gearInventory || [])];
  const granted = [];
  for (let i = 0; i < qty; i++) {
    const gear = generateShopGear(gearGrant);
    if (!gear) continue;
    inventory.push(gear);
    granted.push(gear);
  }
  return {
    save: {
      ...save,
      gearInventory: inventory.slice(0, LIMITS.gearInventoryMax),
    },
    grantedGear: granted,
  };
}

async function persistShopSave(kv, session, save, expectedRevision, startingMonballs, attempt = 0) {
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
      return persistShopSave(kv, session, latest, latest.revision, startingMonballs, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "purchase_conflict", save: err.existingSave };
    }
    throw err;
  }
}

export async function purchaseShopItem(kv, session, { itemId, qty = 1, expectedRevision }, startingMonballs = 10) {
  const id = String(itemId || "").trim();
  if (!id) return { ok: false, error: "item_id_required" };

  const item = findShopItem(id);
  if (!item) return { ok: false, error: "invalid_item" };
  if (item.blocked) return { ok: false, error: "item_unavailable" };

  const quantity = Math.max(1, Math.min(MAX_SHOP_QTY, Math.floor(Number(qty) || 1)));
  const totalCost = multiplyShopCost(item.cost, quantity);

  const { save } = await loadCloudSave(kv, session.xUserId);
  if (!canAffordShopCost(save, totalCost)) {
    return { ok: false, error: "insufficient_funds" };
  }

  let nextSave = spendShopCost(save, totalCost);
  let grantedGear = [];

  if (item.grant) {
    nextSave = applyMatsGrant(nextSave, item.grant, quantity);
  } else if (item.gearGrant) {
    const gearResult = grantShopGearItems(nextSave, item.gearGrant, quantity);
    nextSave = gearResult.save;
    grantedGear = gearResult.grantedGear;
    if (!grantedGear.length) return { ok: false, error: "gear_grant_failed" };
  } else {
    return { ok: false, error: "no_grant" };
  }

  nextSave.questState = bumpShopBuyQuestProgress(nextSave.questState, quantity);

  const result = await persistShopSave(kv, session, nextSave, expectedRevision, startingMonballs);
  if (!result.ok) return result;

  if (item.grant?.monballs) {
    await creditCatchMonballs(kv, session, item.grant.monballs * quantity, startingMonballs, "shop_purchase");
  }

  return {
    ok: true,
    itemId: id,
    qty: quantity,
    cost: totalCost,
    grantedGear,
    save: result.save,
  };
}
