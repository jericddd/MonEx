/**
 * Public leaderboards built from cloud saves (server-authoritative).
 *
 * Boards:
 * - campaign: adventureGlobalBest
 * - power: approximate party combat score (preview until full power is product-frozen)
 */

const SAVE_PREFIX = "monex:save:";
const CACHE_PREFIX = "monex:leaderboard:v1:";
const CACHE_TTL_SEC = 60;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const STAGES_PER_CHAPTER = 40;
const HERO_ASCENSION_STAT_BONUS_PCT = 0.05;

const RARITY_ATK_BONUS = Object.freeze({
  Common: 0,
  Uncommon: 8,
  Rare: 15,
  Legendary: 28,
  Mythic: 28,
});

const RARITY_HP_BONUS = Object.freeze({
  Common: 0,
  Uncommon: 22,
  Rare: 52,
  Legendary: 105,
  Mythic: 165,
});

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

function getBaseAtk(level, rarity) {
  let atk = Math.floor(level * 4.2) + 14;
  atk += RARITY_ATK_BONUS[rarity] || 0;
  return atk;
}

function getMaxHP(level, rarity) {
  return Math.floor(120 + level * 46 + (RARITY_HP_BONUS[rarity] || 0));
}

function gearBonusSum(mon, key) {
  const eq = mon?.equipment;
  if (!eq || typeof eq !== "object") return 0;
  let total = 0;
  for (const slot of Object.keys(eq)) {
    const gear = eq[slot];
    const val = gear?.bonuses?.[key];
    if (Number.isFinite(Number(val))) total += Math.floor(Number(val));
  }
  return total;
}

/**
 * Preview party power — mirrors play getMonPower shape with a simplified
 * ATK+HP core (spd/crit/… omitted until a frozen server power formula lands).
 */
export function estimateMonPowerPreview(mon) {
  if (!mon || typeof mon !== "object") return 0;
  const level = Math.max(1, Math.floor(Number(mon.level) || 1));
  const rarity = String(mon.rarity || "Common");
  const ascStars = Math.max(0, Math.floor(Number(mon.ascensionStars) || 0));
  const ascMult = 1 + ascStars * HERO_ASCENSION_STAT_BONUS_PCT;
  const atk = Math.round((getBaseAtk(level, rarity) + gearBonusSum(mon, "atk")) * ascMult);
  const hp = Math.round((getMaxHP(level, rarity) + gearBonusSum(mon, "hp")) * ascMult);
  return Math.max(0, atk + hp);
}

export function estimatePartyPowerPreview(party) {
  if (!Array.isArray(party)) return 0;
  return party.reduce((sum, mon) => sum + estimateMonPowerPreview(mon), 0);
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
  const score = estimatePartyPowerPreview(save?.party);
  return {
    score,
    label: `${score.toLocaleString()} PWR`,
    preview: true,
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
    const scored = scoreSave(boardId, save);
    if (!scored.score || scored.score <= 0) continue;
    rows.push({
      username,
      score: scored.score,
      label: scored.label,
      preview: scored.preview === true,
      updatedAt: save?.updatedAt || null,
    });
  }

  rows.sort(compareEntries);
  const entries = rows.slice(0, lim).map((row, idx) => ({
    rank: idx + 1,
    username: row.username,
    score: row.score,
    label: row.label,
    ...(row.preview ? { preview: true } : {}),
  }));

  return {
    ok: true,
    board: boardId,
    generatedAt: new Date().toISOString(),
    preview: boardId === "power",
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
