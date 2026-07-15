import { generateSkills } from "./catch-engine.js";
import { sanitizeMon, validateAndSanitizeSave, sanitizeReleaseLog, sanitizeReleasedRecoveryIds, canonicalMonanimalName } from "./save-validate.js";
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
  const matched = rows
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
  if (options.latestOnly && matched.length > 0) {
    return [matched[matched.length - 1]];
  }
  return matched;
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
        index,
        caughtAt: entry.at || null,
        name: canonicalMonanimalName(mon.name),
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
  const canonical = canonicalMonanimalName(name);
  return party.some((mon) => canonicalMonanimalName(mon?.name) === canonical);
}

/** Signatures for mons already recovered from activity (by recovery id / slot). */
export function getExistingRecoverySignatures(save) {
  const sigs = new Set();
  for (const mon of [...(save?.party || []), ...(save?.box || [])]) {
    const id = mon?.wildPendingId || mon?.pendingId;
    if (!id || !mon?.name) continue;
    sigs.add(id);
    // recovery_<activityOrTweet>_<index> — keep slot-level identity so duplicate
    // species in the same catch session are not dropped.
    const match = String(id).match(/^recovery_(.+)_(\d+)$/);
    if (!match) continue;
    const activityKey = match[1];
    const index = match[2];
    sigs.add(`activity:${activityKey}:${index}`);
    if (activityKey.startsWith("tw_") || activityKey.startsWith("tweet_")) {
      sigs.add(`tweet:${activityKey}:${index}`);
    }
  }
  return sigs;
}

export function recoverySignatureForMon(raw) {
  if (!raw?.name) return null;
  // Prefer the stable per-slot recovery id (includes index).
  if (raw.recoveryId) return raw.recoveryId;
  const activityKey = raw.tweetId || raw.activityId;
  if (activityKey != null && raw.index != null) {
    return `activity:${activityKey}:${raw.index}`;
  }
  if (activityKey) return `activity:${activityKey}:${raw.name}`;
  return null;
}

/** Recovery keys blocked because the player intentionally released the mon. */
export function getReleasedRecoveryIdSet(save) {
  const released = new Set(sanitizeReleasedRecoveryIds(save?.releasedRecoveryIds));
  for (const entry of sanitizeReleaseLog(save?.releaseLog)) {
    if (entry.recoveryId) released.add(entry.recoveryId);
    if (entry.instanceId) released.add(entry.instanceId);
    const match = String(entry.recoveryId || "").match(/^recovery_(.+)_(\d+)$/);
    if (match) {
      released.add(`activity:${match[1]}:${match[2]}`);
    }
  }
  return released;
}

export function isRecoveryIdReleased(save, raw) {
  const released = getReleasedRecoveryIdSet(save);
  if (raw.recoveryId && released.has(raw.recoveryId)) return true;
  const sig = recoverySignatureForMon(raw);
  if (sig && released.has(sig)) return true;
  return false;
}

export function isMonAlreadyRecovered(save, raw, seenRecoveryIds) {
  if (raw.recoveryId && seenRecoveryIds.has(raw.recoveryId)) {
    return "already_recovered";
  }
  const sig = recoverySignatureForMon(raw);
  if (sig && getExistingRecoverySignatures(save).has(sig)) {
    return "already_from_activity";
  }
  return null;
}

export function activityMonToSaveMon(recovered) {
  if (!recovered?.name) return null;
  const name = canonicalMonanimalName(recovered.name);
  const rarity = recovered.rarity || "Common";
  const mon = {
    name,
    rarity,
    level: 1,
    skills: generateSkills(name, rarity),
    equipment: { weapon: null, armor: null, helmet: null, boots: null },
    wildPendingId: recovered.recoveryId,
  };
  return sanitizeMon(mon);
}

export function applyRecoveredMonsToSave(
  save,
  recoveredMons,
  {
    partyMax = GAME_PARTY_MAX,
    boxMax = GAME_BOX_MAX,
    replaceInventory = false,
    skipExistingSpecies = false,
  } = {}
) {
  const party = replaceInventory ? [] : [...(save?.party || [])];
  const box = replaceInventory ? [] : [...(save?.box || [])];
  const seen = getWildPendingIds({ party, box });
  const added = [];
  const skipped = [];

  const activitySigs = getExistingRecoverySignatures({ party, box });
  const hasSpecies = (name) => {
    const canonical = canonicalMonanimalName(name);
    return party.some((m) => canonicalMonanimalName(m?.name) === canonical)
      || box.some((m) => canonicalMonanimalName(m?.name) === canonical);
  };

  for (const raw of recoveredMons || []) {
    if (isRecoveryIdReleased(save, raw)) {
      skipped.push({ ...raw, reason: "released_by_user" });
      continue;
    }
    const dupReason = isMonAlreadyRecovered({ party, box }, raw, seen) ||
      (activitySigs.has(recoverySignatureForMon(raw)) ? "already_from_activity" : null);
    if (dupReason) {
      skipped.push({ ...raw, reason: dupReason });
      continue;
    }
    if (skipExistingSpecies && raw?.name && hasSpecies(raw.name)) {
      skipped.push({ ...raw, reason: "species_already_present" });
      continue;
    }

    const mon = activityMonToSaveMon(raw);
    if (!mon) {
      skipped.push({ ...raw, reason: "invalid_mon" });
      continue;
    }

    if (raw.recoveryId) seen.add(raw.recoveryId);
    const sig = recoverySignatureForMon(raw);
    if (sig) activitySigs.add(sig);

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
  latestOnly = false,
  replaceInventory = false,
  skipExistingSpecies = false,
}) {
  const matched = filterActivityEntries(activityEntries, username, {
    caseSensitive,
    spend,
    activityId,
    latestOnly,
  });
  const recoverable = extractRecoverableMons(matched);
  const applied = applyRecoveredMonsToSave(save, recoverable, {
    replaceInventory,
    skipExistingSpecies,
  });
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
    replaceInventory: !!replaceInventory,
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
