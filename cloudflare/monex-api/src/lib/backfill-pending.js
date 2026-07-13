import {
  resolveCatchUser,
  syncPendingForSession,
} from "../kv-store.js";
import { syncPendingForCatchUser } from "./catch-user-store.js";
import { resolveMergedMonballs } from "./save-reconcile.js";
import { sanitizeMon, validateAndSanitizeSave } from "./save-validate.js";

export const GAME_PARTY_MAX = 3;
export const GAME_BOX_MAX = 500;

/** Strip @ only — preserve X handle casing (e.g. Lucci_Crypto). */
export function cleanUsername(username) {
  return String(username || "").replace(/^@/, "").trim();
}

export function collectPendingUsers(state) {
  const groups = new Map();
  for (const [key, user] of Object.entries(state?.users || {})) {
    const pending = user?.pendingMons || [];
    if (!pending.length) continue;
    const username = cleanUsername(user?.username);
    if (!username) continue;
    const groupKey = username.toLowerCase();
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ key, user, pendingCount: pending.length });
  }
  return groups;
}

export function listPendingUsernames(state) {
  return [...collectPendingUsers(state).keys()].sort();
}

export function usernameMatchesFilter(stored, filter) {
  if (!filter) return true;
  return cleanUsername(stored).toLowerCase() === cleanUsername(filter).toLowerCase();
}

/** Prefer real X author id over sim_* dev keys when the same @handle has duplicates. */
export function pickCanonicalCatchUserId(entries) {
  if (!entries?.length) return null;
  const score = (entry) => {
    const key = String(entry.key || "");
    const pending = entry.pendingCount || entry.user?.pendingMons?.length || 0;
    const realIdBonus = key.startsWith("sim_") ? 0 : 1_000_000;
    const numericBonus = /^\d+$/.test(key) ? 100_000 : 0;
    return realIdBonus + numericBonus + pending;
  };
  return [...entries].sort((a, b) => score(b) - score(a))[0].key;
}

export function getWildPendingIds(save) {
  const ids = new Set();
  for (const mon of [...(save?.party || []), ...(save?.box || [])]) {
    const id = mon?.wildPendingId || mon?.pendingId;
    if (id) ids.add(id);
  }
  return ids;
}

export function pendingMonToSaveMon(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mon = {
    name: raw.name,
    rarity: raw.rarity,
    level: raw.level || 1,
    skills: Array.isArray(raw.skills) ? structuredClone(raw.skills) : [],
    equipment: { weapon: null, armor: null, helmet: null, boots: null },
  };
  if (raw.pendingId) mon.wildPendingId = raw.pendingId;
  return sanitizeMon(mon);
}

export function applySyncedMonsToSave(save, partyMons, boxMons) {
  const party = [...(save.party || [])];
  const box = [...(save.box || [])];
  const seen = getWildPendingIds({ party, box });
  let addedParty = 0;
  let addedBox = 0;

  for (const raw of partyMons || []) {
    const pendingId = raw?.pendingId;
    if (pendingId && seen.has(pendingId)) continue;
    const mon = pendingMonToSaveMon(raw);
    if (!mon) continue;
    if (pendingId) seen.add(pendingId);
    party.push(mon);
    addedParty++;
  }

  for (const raw of boxMons || []) {
    const pendingId = raw?.pendingId;
    if (pendingId && seen.has(pendingId)) continue;
    const mon = pendingMonToSaveMon(raw);
    if (!mon) continue;
    if (pendingId) seen.add(pendingId);
    box.push(mon);
    addedBox++;
  }

  return {
    save: {
      ...save,
      party,
      box,
    },
    addedParty,
    addedBox,
  };
}

/**
 * Move catch-state pending mons into a cloud save and align Monballs.
 * Mutates catchUser.pendingMons and returns the next save payload.
 */
export function backfillPendingForCatchUser(
  catchUser,
  {
    username,
    save,
    partyMax = GAME_PARTY_MAX,
    boxMax = GAME_BOX_MAX,
    startingMonballs = 10,
    partyCount = null,
    boxCount = null,
  } = {}
) {
  const uname = cleanUsername(username);
  if (!catchUser) {
    return {
      ok: false,
      reason: "catch_user_not_found",
      save,
      addedParty: 0,
      addedBox: 0,
      added: 0,
      remaining: 0,
      monballs: null,
      syncedParty: [],
      syncedBox: [],
    };
  }

  const pendingBefore = catchUser.pendingMons?.length || 0;
  const effectivePartyCount = partyCount ?? save?.party?.length ?? 0;
  const effectiveBoxCount = boxCount ?? save?.box?.length ?? 0;
  const slots = syncPendingForCatchUser(
    catchUser,
    effectivePartyCount,
    effectiveBoxCount,
    partyMax,
    boxMax
  );

  const applied = applySyncedMonsToSave(save, slots.party, slots.box);
  const mergedMonballs = resolveMergedMonballs(catchUser, save, slots.monballs);
  const nextSave = validateAndSanitizeSave(
    {
      ...applied.save,
      monballs: mergedMonballs,
      xHandle: save?.xHandle || uname,
      updatedAt: new Date().toISOString(),
    },
    { username: uname }
  );

  return {
    ok: true,
    save: nextSave,
    addedParty: applied.addedParty,
    addedBox: applied.addedBox,
    added: applied.addedParty + applied.addedBox,
    remaining: slots.remaining,
    pendingBefore,
    monballs: mergedMonballs,
    syncedParty: slots.party,
    syncedBox: slots.box,
  };
}

/**
 * Move catch-state pending mons into a cloud save and align Monballs.
 * Mutates catch state (pending queue + legacy merges) and returns the next save payload.
 */
export function backfillPendingForUser(
  state,
  {
    xUserId,
    username,
    save,
    partyMax = GAME_PARTY_MAX,
    boxMax = GAME_BOX_MAX,
    startingMonballs = 10,
    partyCount = null,
    boxCount = null,
  } = {}
) {
  const uname = cleanUsername(username);
  const catchUser = resolveCatchUser(state, xUserId, uname, startingMonballs);
  return backfillPendingForCatchUser(catchUser, {
    username: uname,
    save,
    partyMax,
    boxMax,
    startingMonballs,
    partyCount,
    boxCount,
  });
}
