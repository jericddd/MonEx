/**
 * Server-authoritative party layout mutations.
 * Fixes "swap then upgrade then snap-back" by making seats cloud-truth.
 */
import { runSaveMutation, monIdentityKey, findMonInSave } from "./save-mutation.js";

export const PARTY_MAX = 3;

function partyHasSpecies(party, name, excludeIndex = -1) {
  const want = String(name || "");
  return (party || []).some((mon, i) => i !== excludeIndex && mon?.name === want);
}

export function applyAddFromBoxToSave(save, { boxInstanceId } = {}) {
  const party = [...(save?.party || [])];
  const box = [...(save?.box || [])];
  if (party.length >= PARTY_MAX) return { ok: false, error: "party_full" };

  const found = findMonInSave({ party, box }, { instanceId: boxInstanceId });
  if (!found || found.list !== "box") return { ok: false, error: "mon_not_in_box" };
  if (partyHasSpecies(party, found.mon.name)) return { ok: false, error: "species_in_party" };

  const mon = box.splice(found.index, 1)[0];
  party.push(mon);
  return { ok: true, save: { ...save, party, box } };
}

export function applySwapPartyWithBoxToSave(save, { partyInstanceId, boxInstanceId } = {}) {
  const party = [...(save?.party || [])];
  const box = [...(save?.box || [])];
  const partyLoc = findMonInSave({ party, box }, { instanceId: partyInstanceId });
  const boxLoc = findMonInSave({ party, box }, { instanceId: boxInstanceId });
  if (!partyLoc || partyLoc.list !== "party") return { ok: false, error: "mon_not_in_party" };
  if (!boxLoc || boxLoc.list !== "box") return { ok: false, error: "mon_not_in_box" };

  const incoming = boxLoc.mon;
  if (partyHasSpecies(party, incoming.name, partyLoc.index)) {
    return { ok: false, error: "species_in_party" };
  }

  const temp = party[partyLoc.index];
  party[partyLoc.index] = incoming;
  box[boxLoc.index] = temp;
  return { ok: true, save: { ...save, party, box } };
}

export function applyReorderPartyToSave(save, { partyInstanceIds } = {}) {
  const party = [...(save?.party || [])];
  const ids = Array.isArray(partyInstanceIds) ? partyInstanceIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (ids.length !== party.length) return { ok: false, error: "invalid_party_order" };

  const byKey = new Map();
  for (const mon of party) {
    const key = monIdentityKey(mon);
    if (!key || byKey.has(key)) return { ok: false, error: "invalid_party_order" };
    byKey.set(key, mon);
  }
  if (ids.length !== byKey.size) return { ok: false, error: "invalid_party_order" };

  const next = [];
  for (const id of ids) {
    const mon = byKey.get(id);
    if (!mon) return { ok: false, error: "invalid_party_order" };
    next.push(mon);
    byKey.delete(id);
  }
  if (byKey.size) return { ok: false, error: "invalid_party_order" };
  return { ok: true, save: { ...save, party: next } };
}

export async function addFromBox(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "party_conflict",
    apply: (save) => applyAddFromBoxToSave(save, body || {}),
  });
}

export async function swapPartyWithBox(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "party_conflict",
    apply: (save) => applySwapPartyWithBoxToSave(save, body || {}),
  });
}

export async function reorderParty(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "party_conflict",
    apply: (save) => applyReorderPartyToSave(save, body || {}),
  });
}
