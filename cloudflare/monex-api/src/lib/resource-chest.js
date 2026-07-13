import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";
import { LIMITS, GEAR_SLOTS } from "./save-validate.js";
import { generateShopGear } from "./shop-gear.js";

const MAX_CLAIM_RETRIES = 3;
const CHEST_MAX_MS = LIMITS.resourceChestMaxMs;

const RESOURCE_CHEST_RATES = {
  1: { gold: 450, essence: 55, trainerXp: 175, gearChance: 0 },
  2: { gold: 720, essence: 90, trainerXp: 280, gearChance: 0.08 },
  3: { gold: 1050, essence: 125, trainerXp: 400, gearChance: 0.1 },
  4: { gold: 1400, essence: 165, trainerXp: 520, gearChance: 0.12 },
  5: { gold: 1800, essence: 210, trainerXp: 650, gearChance: 0.14 },
};

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function getResourceChestRates(chapter) {
  const ch = Math.max(1, Math.floor(chapter || 1));
  if (RESOURCE_CHEST_RATES[ch]) return RESOURCE_CHEST_RATES[ch];
  const base = RESOURCE_CHEST_RATES[5];
  const extra = ch - 5;
  return {
    gold: base.gold + extra * 280,
    essence: base.essence + extra * 40,
    trainerXp: base.trainerXp + extra * 120,
    gearChance: Math.min(0.25, base.gearChance + extra * 0.02),
  };
}

export function previewResourceChest(save, now = Date.now()) {
  const last = Number(save?.resourceChestLastCollectAt) || 0;
  const elapsedMs = last > 0
    ? Math.min(CHEST_MAX_MS, Math.max(0, now - last))
    : CHEST_MAX_MS;
  const progress = elapsedMs / CHEST_MAX_MS;
  const chapter = Math.max(1, Math.floor(save?.currentChapter || 1));
  const rates = getResourceChestRates(chapter);
  return {
    chapter,
    progress,
    elapsedMs,
    gold: Math.floor(rates.gold * progress),
    essence: Math.floor(rates.essence * progress),
    trainerXp: Math.floor(rates.trainerXp * progress),
    gearChance: rates.gearChance,
    canCollect: progress > 0,
  };
}

function rollResourceChestGear(chapter) {
  if (chapter < 2) return null;
  const rates = getResourceChestRates(chapter);
  if (Math.random() >= rates.gearChance) return null;
  const slot = GEAR_SLOTS[Math.floor(Math.random() * GEAR_SLOTS.length)];
  const tier = Math.random() < 0.2 ? Math.min(5, 2 + Math.floor(Math.random() * 4)) : Math.min(5, 1 + Math.floor(Math.random() * 3));
  return generateShopGear({
    slot,
    tier,
    gearLevelTier: Math.max(1, chapter),
    randomRarity: tier > 3,
  });
}

function bumpResourceCollectQuest(questState) {
  const qs = questState && typeof questState === "object" ? { ...questState } : {};
  const tasks = {
    dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
    weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
    campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
  };
  const idx = tasks.dailies.findIndex((t) => t?.id === "d5");
  if (idx >= 0) {
    const task = tasks.dailies[idx];
    tasks.dailies[idx] = { ...task, progress: Math.min(1, (task.progress || 0) + 1) };
  } else {
    tasks.dailies.push({ id: "d5", progress: 1, claimed: false });
  }
  return { ...qs, tasks };
}

async function persistChestSave(kv, session, save, expectedRevision, startingMonballs, attempt = 0) {
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
      return persistChestSave(kv, session, latest, latest.revision, startingMonballs, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "collect_conflict", save: err.existingSave };
    }
    throw err;
  }
}

export async function collectResourceChest(kv, session, { expectedRevision, now = Date.now() }, startingMonballs = 10) {
  const { save } = await loadCloudSave(kv, session.xUserId);
  const preview = previewResourceChest(save, now);
  if (!preview.canCollect) {
    return { ok: false, error: "chest_empty" };
  }

  const grant = {
    gold: preview.gold,
    essence: preview.essence,
    trainerXp: preview.trainerXp,
  };
  let gear = rollResourceChestGear(preview.chapter);
  const inventory = [...(save.gearInventory || [])];
  if (gear) inventory.push(gear);

  let nextSave = {
    ...save,
    money: (save.money || 0) + grant.gold,
    essence: (save.essence || 0) + grant.essence,
    trainerXp: (save.trainerXp || 0) + grant.trainerXp,
    gearInventory: inventory.slice(0, LIMITS.gearInventoryMax),
    resourceChestLastCollectAt: now,
    questState: bumpResourceCollectQuest(save.questState),
  };

  const result = await persistChestSave(kv, session, nextSave, expectedRevision, startingMonballs);
  if (!result.ok) return result;

  return {
    ok: true,
    grant,
    gear,
    preview,
    save: result.save,
  };
}
