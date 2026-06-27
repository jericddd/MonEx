const SAVE_PREFIX = "monex:save:";

export const DEFAULT_SAVE = {
  party: [],
  box: [],
  monballs: 15,
  money: 5000,
  essence: 0,
  monShards: 0,
  trainerXp: 0,
  highestStageCleared: 0,
  adventureGlobalBest: 0,
  currentChapter: 1,
  currentStage: 1,
  gearInventory: [],
  lastResetDate: null,
  xHandle: "",
};

function saveKey(xUserId) {
  return `${SAVE_PREFIX}${xUserId}`;
}

export function buildSavePayload(body, session) {
  const src = body && typeof body === "object" ? body : {};
  return {
    party: Array.isArray(src.party) ? src.party : DEFAULT_SAVE.party,
    box: Array.isArray(src.box) ? src.box : DEFAULT_SAVE.box,
    monballs: Number.isFinite(src.monballs) ? src.monballs : DEFAULT_SAVE.monballs,
    money: Number.isFinite(src.money) ? src.money : DEFAULT_SAVE.money,
    essence: Number.isFinite(src.essence) ? src.essence : DEFAULT_SAVE.essence,
    monShards: Number.isFinite(src.monShards) ? src.monShards : DEFAULT_SAVE.monShards,
    trainerXp: Number.isFinite(src.trainerXp) ? src.trainerXp : DEFAULT_SAVE.trainerXp,
    highestStageCleared: Number.isFinite(src.highestStageCleared)
      ? src.highestStageCleared
      : DEFAULT_SAVE.highestStageCleared,
    adventureGlobalBest: Number.isFinite(src.adventureGlobalBest)
      ? src.adventureGlobalBest
      : (Number.isFinite(src.highestStageCleared) ? src.highestStageCleared : DEFAULT_SAVE.adventureGlobalBest),
    currentChapter: Number.isFinite(src.currentChapter) ? src.currentChapter : DEFAULT_SAVE.currentChapter,
    currentStage: Number.isFinite(src.currentStage) ? src.currentStage : DEFAULT_SAVE.currentStage,
    gearInventory: Array.isArray(src.gearInventory) ? src.gearInventory : DEFAULT_SAVE.gearInventory,
    lastResetDate: src.lastResetDate || null,
    xHandle: session.username || src.xHandle || "",
    updatedAt: new Date().toISOString(),
  };
}

export async function loadCloudSave(kv, xUserId) {
  const raw = await kv.get(saveKey(xUserId));
  if (!raw) return { found: false, save: { ...DEFAULT_SAVE } };
  const save = JSON.parse(raw);
  return { found: true, save: { ...DEFAULT_SAVE, ...save } };
}

export async function writeCloudSave(kv, xUserId, payload) {
  await kv.put(saveKey(xUserId), JSON.stringify(payload));
  return payload;
}
