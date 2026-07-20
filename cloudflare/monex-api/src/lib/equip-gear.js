/**
 * Server-authoritative equip / unequip.
 */
import { runSaveMutation, findMonInSave } from "./save-mutation.js";
import { GEAR_SLOTS, sanitizeGear } from "./save-validate.js";
import { bumpQuestTrackProgress } from "./quest-rewards.js";

function canMonEquipGear(mon, gear) {
  if (!mon || !gear) return false;
  const req = Math.max(1, Math.floor(Number(gear.requiredLevel) || 1));
  const level = Math.max(1, Math.floor(Number(mon.level) || 1));
  if (level < req) return false;
  // House restriction is enforced loosely server-side (client already checks).
  return GEAR_SLOTS.includes(gear.slot);
}

export function applyEquipGearToSave(save, { instanceId, gearId } = {}) {
  const found = findMonInSave(save, { instanceId });
  if (!found) return { ok: false, error: "mon_not_found" };

  const inventory = [...(save.gearInventory || [])];
  const gi = inventory.findIndex((g) => g?.id === gearId);
  if (gi < 0) return { ok: false, error: "gear_not_found" };
  const gear = sanitizeGear(inventory[gi]);
  if (!gear) return { ok: false, error: "invalid_gear" };
  if (!canMonEquipGear(found.mon, gear)) return { ok: false, error: "cannot_equip" };

  inventory.splice(gi, 1);
  const mon = {
    ...found.mon,
    equipment: { ...(found.mon.equipment || {}) },
  };
  const old = mon.equipment[gear.slot];
  if (old) {
    const normalizedOld = sanitizeGear(old);
    if (normalizedOld) inventory.push(normalizedOld);
  }
  mon.equipment[gear.slot] = gear;

  const party = [...(save.party || [])];
  const box = [...(save.box || [])];
  if (found.list === "party") party[found.index] = mon;
  else box[found.index] = mon;

  let nextSave = { ...save, party, box, gearInventory: inventory };
  // Mirror client: only party equips count toward gear_equip quests.
  if (found.list === "party") {
    nextSave = {
      ...nextSave,
      questState: bumpQuestTrackProgress(nextSave.questState, "gear_equip", 1),
    };
  }

  return {
    ok: true,
    save: nextSave,
  };
}

export function applyUnequipGearToSave(save, { instanceId, slot } = {}) {
  if (!GEAR_SLOTS.includes(slot)) return { ok: false, error: "invalid_slot" };
  const found = findMonInSave(save, { instanceId });
  if (!found) return { ok: false, error: "mon_not_found" };

  const mon = {
    ...found.mon,
    equipment: { ...(found.mon.equipment || {}) },
  };
  const gear = mon.equipment[slot];
  if (!gear) return { ok: false, error: "slot_empty" };

  const normalized = sanitizeGear(gear);
  mon.equipment[slot] = null;
  const inventory = [...(save.gearInventory || [])];
  if (normalized) inventory.push(normalized);

  const party = [...(save.party || [])];
  const box = [...(save.box || [])];
  if (found.list === "party") party[found.index] = mon;
  else box[found.index] = mon;

  return {
    ok: true,
    save: { ...save, party, box, gearInventory: inventory },
  };
}

export async function equipGear(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "equip_conflict",
    apply: (save) => applyEquipGearToSave(save, body || {}),
  });
}

export async function unequipGear(kv, session, body, options = {}) {
  return runSaveMutation(kv, session, {
    expectedRevision: options.expectedRevision,
    startingMonballs: options.startingMonballs ?? 10,
    conflictError: "equip_conflict",
    apply: (save) => applyUnequipGearToSave(save, body || {}),
  });
}
