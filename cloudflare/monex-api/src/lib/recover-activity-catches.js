import { generateSkills } from "./catch-engine.js";
import { sanitizeMon, validateAndSanitizeSave } from "./save-validate.js";
import {
  cleanUsername,
  getWildPendingIds,
  GAME_PARTY_MAX,
  GAME_BOX_MAX,
} from "./backfill-pending.js";

export function usernameMatchesActivity(stored, filter, { caseSensitive = true } = {}) {
  const a = cleanUsername(stored);
  const b = cleanUsername(filter);
  if (!b) return true;
  if (caseSensitive) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

export function filterActivityEntries(entries, username, options = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  const spendFilter = options.spend != null ? Number(options.spend) : null;
  const activityId = options.activityId ? String(options.activityId).trim() : "";
  return rows
    .filter((entry) => entry?.status === "success")
    .filter((entry) => usernameMatchesActivity(entry.xUsername, username, options))
    .filter((entry) => {
      if (activityId) {
        return entry.id === activityId || entry.tweetId === activityId;
      }
      if (Number.isFinite(spendFilter) && spendFilter > 0) {
        return Number(entry.spend) === spendFilter;
      }
      return true;
    })
    .sort((a, b) => Date.parse(a.at || "") - Date.parse(b.at || ""));
}

export function extractRecoverableMons(activityEntries) {
  const recovered = [];
  for (const entry of activityEntries || []) {
    const mons = Array.isArray(entry.mons) ? entry.mons : [];
    mons.forEach((mon, index) => {
      if (!mon?.name) return;
      recovered.push({
        recoveryId: `recovery_${entry.id || entry.tweetId || "act"}_${index}`,
        activityId: entry.id || null,
        tweetId: entry.tweetId || null,
        caughtAt: entry.at || null,
        name: mon.name,
        rarity: mon.rarity || "Common",
        skillsShort: mon.skills || null,
      });
    });
  }
  return recovered;
}

export function latestMonballsFromActivity(activityEntries) {
  if (!activityEntries?.length) return null;
  const sorted = [...activityEntries].sort(
    (a, b) => Date.parse(b.at || "") - Date.parse(a.at || "")
  );
  const latest = sorted[0];
  const left = latest?.monballsLeft;
  return Number.isFinite(left) ? Math.max(0, Math.floor(left)) : null;
}

export function latestActivityUserId(activityEntries) {
  if (!activityEntries?.length) return null;
  const sorted = [...activityEntries].sort(
    (a, b) => Date.parse(b.at || "") - Date.parse(a.at || "")
  );
  return sorted[0]?.xUserId || null;
}

function partyHasSpecies(party, name) {
  return party.some((mon) => mon?.name === name);
}

export function activityMonToSaveMon(recovered) {
  if (!recovered?.name) return null;
  const rarity = recovered.rarity || "Common";
  const mon = {
    name: recovered.name,
    rarity,
    level: 1,
    skills: generateSkills(recovered.name, rarity),
    equipment: { weapon: null, armor: null, helmet: null, boots: null },
    wildPendingId: recovered.recoveryId,
  };
  return sanitizeMon(mon);
}

export function applyRecoveredMonsToSave(
  save,
  recoveredMons,
  { partyMax = GAME_PARTY_MAX, boxMax = GAME_BOX_MAX } = {}
) {
  const party = [...(save?.party || [])];
  const box = [...(save?.box || [])];
  const seen = getWildPendingIds({ party, box });
  const added = [];
  const skipped = [];

  for (const raw of recoveredMons || []) {
    if (raw.recoveryId && seen.has(raw.recoveryId)) {
      skipped.push({ ...raw, reason: "already_recovered" });
      continue;
    }

    const mon = activityMonToSaveMon(raw);
    if (!mon) {
      skipped.push({ ...raw, reason: "invalid_mon" });
      continue;
    }

    if (raw.recoveryId) seen.add(raw.recoveryId);

    if (party.length < partyMax && !partyHasSpecies(party, mon.name)) {
      party.push(mon);
    } else if (box.length < boxMax) {
      box.push(mon);
    } else {
      skipped.push({ ...raw, reason: "party_box_full" });
      continue;
    }

    added.push({
      recoveryId: raw.recoveryId,
      name: mon.name,
      rarity: mon.rarity,
      activityId: raw.activityId,
      caughtAt: raw.caughtAt,
    });
  }

  return {
    save: {
      ...save,
      party: party.slice(0, partyMax),
      box: box.slice(0, boxMax),
    },
    added,
    skipped,
  };
}

export function recoverActivityCatchesForUser({
  username,
  activityEntries,
  save,
  catchMonballs = null,
  caseSensitive = true,
  spend = null,
  activityId = null,
}) {
  const matched = filterActivityEntries(activityEntries, username, {
    caseSensitive,
    spend,
    activityId,
  });
  const recoverable = extractRecoverableMons(matched);
  const applied = applyRecoveredMonsToSave(save, recoverable);
  const activityMonballs = latestMonballsFromActivity(matched);
  const monballs =
    activityMonballs ??
    (Number.isFinite(catchMonballs) ? catchMonballs : save?.monballs);

  const nextSave = validateAndSanitizeSave(
    {
      ...applied.save,
      monballs,
      xHandle: save?.xHandle || cleanUsername(username),
      updatedAt: new Date().toISOString(),
    },
    { username: cleanUsername(username) }
  );

  return {
    ok: true,
    username: cleanUsername(username),
    activityMatches: matched.length,
    recoverableCount: recoverable.length,
    added: applied.added,
    skipped: applied.skipped,
    monballs,
    save: nextSave,
    xUserId: latestActivityUserId(matched),
    activities: matched.map((entry) => ({
      id: entry.id,
      at: entry.at,
      spend: entry.spend,
      caughtCount: entry.caughtCount,
      monballsLeft: entry.monballsLeft,
      mons: entry.mons,
    })),
  };
}
