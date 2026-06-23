import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");

const DEFAULT_STATE = {
  processedTweetIds: [],
  users: {},
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(DEFAULT_STATE, null, 2));
    return structuredClone(DEFAULT_STATE);
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

export function saveState(state) {
  ensureDataDir();
  // Keep processed list bounded
  if (state.processedTweetIds.length > 5000) {
    state.processedTweetIds = state.processedTweetIds.slice(-3000);
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function wasProcessed(state, tweetId) {
  return state.processedTweetIds.includes(tweetId);
}

export function markProcessed(state, tweetId) {
  if (!wasProcessed(state, tweetId)) {
    state.processedTweetIds.push(tweetId);
  }
}

export function getUser(state, xUserId, username, startingMonballs) {
  if (!state.users[xUserId]) {
    state.users[xUserId] = {
      username,
      monballs: startingMonballs,
      pendingMons: [],
      updatedAt: new Date().toISOString(),
    };
  } else if (username && state.users[xUserId].username !== username) {
    state.users[xUserId].username = username;
  }
  return state.users[xUserId];
}

export function addPendingMons(user, mons) {
  user.pendingMons.push(...mons.map((m) => ({ ...m, caughtAt: new Date().toISOString() })));
  user.updatedAt = new Date().toISOString();
}

export function findUserByUsername(state, username) {
  const u = (username || "").toLowerCase().replace("@", "");
  if (!u) return null;
  for (const user of Object.values(state.users)) {
    if (user.username?.toLowerCase() === u) return user;
  }
  return null;
}

export function getPendingForUsername(state, username) {
  const user = findUserByUsername(state, username);
  if (!user) {
    return { found: false, monballs: null, pendingMons: [] };
  }
  return {
    found: true,
    monballs: user.monballs,
    pendingMons: user.pendingMons || [],
  };
}

export function claimPendingForUsername(state, username) {
  const user = findUserByUsername(state, username);
  if (!user || !user.pendingMons?.length) {
    return { claimed: [], count: 0 };
  }
  const claimed = [...user.pendingMons];
  user.pendingMons = [];
  user.updatedAt = new Date().toISOString();
  return { claimed, count: claimed.length };
}

/** Auto-sync: fill party slots first, then box; leave overflow on server */
export function syncPendingToSlots(state, username, partyCount, boxCount, partyMax = 3, boxMax = 100) {
  const user = findUserByUsername(state, username);
  if (!user || !user.pendingMons?.length) {
    return { party: [], box: [], remaining: 0 };
  }
  const partySlots = Math.max(0, partyMax - partyCount);
  const boxSlots = Math.max(0, boxMax - boxCount);
  const pending = [...user.pendingMons];
  const party = pending.splice(0, partySlots);
  const box = pending.splice(0, boxSlots);
  user.pendingMons = pending;
  user.updatedAt = new Date().toISOString();
  return { party, box, remaining: pending.length };
}
