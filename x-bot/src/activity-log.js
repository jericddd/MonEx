import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const ACTIVITY_PATH = path.join(DATA_DIR, "activity.json");
const MAX_ENTRIES = 500;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadActivityLog() {
  ensureDataDir();
  if (!fs.existsSync(ACTIVITY_PATH)) {
    const empty = { entries: [] };
    fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(ACTIVITY_PATH, "utf8"));
}

export function saveActivityLog(log) {
  ensureDataDir();
  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(-MAX_ENTRIES);
  }
  fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(log, null, 2));
}

export function appendActivity(entry) {
  const log = loadActivityLog();
  log.entries.unshift(entry);
  saveActivityLog(log);
  return entry;
}

export function listActivities({ limit = 40, page = 1, username = null, successOnly = true } = {}) {
  const log = loadActivityLog();
  let rows = log.entries;
  if (successOnly) rows = rows.filter((e) => e.status === "success");
  if (username) {
    const u = username.toLowerCase().replace("@", "");
    rows = rows.filter((e) => e.xUsername?.toLowerCase() === u);
  }
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * limit;
  return {
    entries: rows.slice(offset, offset + limit),
    total,
    page: safePage,
    limit,
    totalPages,
  };
}

export function makeActivityId() {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
