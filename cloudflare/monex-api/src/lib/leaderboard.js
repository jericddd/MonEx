/**
 * Public leaderboards built from cloud saves (server-authoritative).
 *
 * Boards:
 * - campaign: adventureGlobalBest
 * - power: sum of frozen per-Mon power rating (power-rating standard-norm)
 */

import { getPartyPower } from "./power-rating.js";
import { isPublicHiddenUsername } from "./public-account-exclusions.js";

const SAVE_PREFIX = "monex:save:";
const CACHE_PREFIX = "monex:leaderboard:v3:";
const CACHE_TTL_SEC = 60 * 30; // 30 minutes
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const STAGES_PER_CHAPTER = 40;

export const LEADERBOARD_BOARDS = Object.freeze(["campaign", "power"]);

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function cleanUsername(raw) {
  const s = String(raw || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase()
    .slice(0, 32);
  if (!s || s === "trainer" || s === "unknown") return null;
  return s;
}

export function formatCampaignLabel(adventureGlobalBest) {
  const g = Math.max(0, Math.floor(Number(adventureGlobalBest) || 0));
  if (g <= 0) return "Ch.1 Stage 0";
  const chapter = Math.floor((g - 1) / STAGES_PER_CHAPTER) + 1;
  const stage = ((g - 1) % STAGES_PER_CHAPTER) + 1;
  return `Ch.${chapter} Stage ${stage}`;
}

function cacheKey(board) {
  return `${CACHE_PREFIX}${board}`;
}

async function listSaveKeys(kv) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: SAVE_PREFIX, cursor, limit: 1000 });
    for (const entry of page.keys || []) {
      if (entry?.name) keys.push(entry.name);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

function scoreSave(board, save) {
  if (board === "campaign") {
    const score = clampInt(save?.adventureGlobalBest ?? 0, 0, 99_999);
    return {
      score,
      label: formatCampaignLabel(score),
    };
  }
  const score = getPartyPower(save?.party);
  return {
    score,
    label: `${score.toLocaleString()} PWR`,
  };
}

function compareEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aAt = Date.parse(a.updatedAt || "") || 0;
  const bAt = Date.parse(b.updatedAt || "") || 0;
  if (aAt !== bAt) return aAt - bAt; // earlier updatedAt wins ties
  return String(a.username).localeCompare(String(b.username));
}

export async function buildLeaderboard(kv, board, { limit = DEFAULT_LIMIT } = {}) {
  const boardId = LEADERBOARD_BOARDS.includes(board) ? board : null;
  if (!boardId) return { ok: false, error: "invalid_board" };
  const lim = clampInt(limit, 1, MAX_LIMIT);

  const keys = await listSaveKeys(kv);
  const rows = [];
  for (const key of keys) {
    const raw = await kv.get(key);
    if (!raw) continue;
    let save;
    try {
      save = JSON.parse(raw);
    } catch {
      continue;
    }
    const username = cleanUsername(save?.xHandle);
    if (!username) continue;
    if (isPublicHiddenUsername(username)) continue;
    const scored = scoreSave(boardId, save);
    if (!scored.score || scored.score <= 0) continue;
    rows.push({
      username,
      score: scored.score,
      label: scored.label,
      updatedAt: save?.updatedAt || null,
    });
  }

  rows.sort(compareEntries);
  const entries = rows.slice(0, lim).map((row, idx) => ({
    rank: idx + 1,
    username: row.username,
    score: row.score,
    label: row.label,
  }));

  return {
    ok: true,
    board: boardId,
    generatedAt: new Date().toISOString(),
    preview: false,
    entries,
  };
}

export async function getLeaderboard(kv, board, { limit = DEFAULT_LIMIT, bypassCache = false } = {}) {
  const boardId = LEADERBOARD_BOARDS.includes(board) ? board : null;
  if (!boardId) return { ok: false, error: "invalid_board" };
  const lim = clampInt(limit, 1, MAX_LIMIT);
  const key = cacheKey(boardId);

  if (!bypassCache) {
    const cachedRaw = await kv.get(key);
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw);
        if (cached?.ok && Array.isArray(cached.entries)) {
          return {
            ...cached,
            entries: cached.entries.slice(0, lim),
            cached: true,
          };
        }
      } catch {
        /* rebuild */
      }
    }
  }

  const built = await buildLeaderboard(kv, boardId, { limit: MAX_LIMIT });
  if (!built.ok) return built;
  await kv.put(key, JSON.stringify(built), { expirationTtl: CACHE_TTL_SEC });
  return {
    ...built,
    entries: built.entries.slice(0, lim),
    cached: false,
  };
}
