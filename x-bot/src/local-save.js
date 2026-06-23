import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SAVES_PATH = path.join(DATA_DIR, "saves.json");

export const DEFAULT_SAVE = {
  party: [],
  box: [],
  monballs: 15,
  money: 5000,
  essence: 0,
  monShards: 0,
  trainerXp: 0,
  highestStageCleared: 0,
  currentStage: 1,
  gearInventory: [],
  lastResetDate: null,
  xHandle: "",
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSaves() {
  ensureDataDir();
  if (!fs.existsSync(SAVES_PATH)) return {};
  return JSON.parse(fs.readFileSync(SAVES_PATH, "utf8"));
}

function writeSaves(saves) {
  ensureDataDir();
  fs.writeFileSync(SAVES_PATH, JSON.stringify(saves, null, 2));
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
    currentStage: Number.isFinite(src.currentStage) ? src.currentStage : DEFAULT_SAVE.currentStage,
    gearInventory: Array.isArray(src.gearInventory) ? src.gearInventory : DEFAULT_SAVE.gearInventory,
    lastResetDate: src.lastResetDate || null,
    xHandle: session.username || src.xHandle || "",
    updatedAt: new Date().toISOString(),
  };
}

export function loadCloudSave(xUserId) {
  const saves = loadSaves();
  if (!saves[xUserId]) return { found: false, save: { ...DEFAULT_SAVE } };
  return { found: true, save: { ...DEFAULT_SAVE, ...saves[xUserId] } };
}

export function writeCloudSave(xUserId, payload) {
  const saves = loadSaves();
  saves[xUserId] = payload;
  writeSaves(saves);
  return payload;
}
