import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_SAVE,
  buildSavePayload,
} from "../../cloudflare/monex-api/src/lib/save.js";

export { DEFAULT_SAVE, buildSavePayload };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SAVES_PATH = path.join(DATA_DIR, "saves.json");

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

export function loadCloudSave(xUserId) {
  const saves = loadSaves();
  if (!saves[xUserId]) return { found: false, save: { ...DEFAULT_SAVE } };
  const save = buildSavePayload(saves[xUserId], { username: saves[xUserId]?.xHandle || "" });
  return { found: true, save };
}

export function writeCloudSave(xUserId, payload) {
  const saves = loadSaves();
  saves[xUserId] = payload;
  writeSaves(saves);
  return payload;
}
