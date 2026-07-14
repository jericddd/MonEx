import { loadCloudSave, writeCloudSave, buildSavePayload, preserveServerAuthoritativeFields } from "./save.js";
import { guardSavePayload } from "./save-economy-guard.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";
import { sanitizeGear } from "./save-validate.js";

const MAX_RELEASE_RETRIES = 3;
const GEAR_SLOTS = ["weapon", "armor", "helmet", "boots"];

const RELEASE_SHARD_REWARD = { Common: 0, Uncommon: 1, Rare: 2, Legendary: 4, Mythic: 0 };
const RELEASE_ONION_BASE = { Common: 5, Uncommon: 12, Rare: 25, Legendary: 50, Mythic: 0 };
const RELEASE_LEVEL_REFUND_RATE = 0.8;

function getCumulativeLevelInvestment(level) {
  const lv = Math.max(1, Math.floor(level || 1));
  if (lv <= 1) return { gold: 0, essence: 0 };
  let gold = 0;
  let essence = 0;
  for (let lvl = 1; lvl < lv; lvl++) {
    gold += 50 * lvl;
    essence += 5 + lvl * 3;
  }
  return { gold, essence };
}

export function getReleaseSalvage(mon) {
  if (!mon) return { shards: 0, gold: 0, essence: 0 };
  const invested = getCumulativeLevelInvestment(mon.level);
  const rarity = mon.rarity || "Common";
  return {
    shards: RELEASE_SHARD_REWARD[rarity] ?? 0,
    gold: Math.floor(invested.gold * RELEASE_LEVEL_REFUND_RATE),
    essence: (RELEASE_ONION_BASE[rarity] ?? 0)
      + Math.floor(invested.essence * RELEASE_LEVEL_REFUND_RATE),
  };
}

export function resolveMonInstanceId(mon) {
  if (!mon || typeof mon !== "object") return null;
  if (typeof mon.instanceId === "string" && mon.instanceId.trim()) return mon.instanceId.trim();
  if (typeof mon.wildPendingId === "string" && mon.wildPendingId.trim()) return mon.wildPendingId.trim();
  return null;
}

export function collectReleaseRecoveryKeys(mon) {
  const keys = new Set();
  const instanceId = resolveMonInstanceId(mon);
  if (instanceId) keys.add(instanceId);
  if (mon?.wildPendingId && mon.wildPendingId !== instanceId) keys.add(mon.wildPendingId);
  const match = String(mon?.wildPendingId || "").match(/^recovery_(.+)_(\d+)$/);
  if (match) keys.add(`activity:${match[1]}:${match[2]}`);
  return [...keys];
}

function buildReleaseLogEntry(mon, salvage) {
  const instanceId = resolveMonInstanceId(mon) || `inst_${Date.now()}`;
  const entry = {
    id: `rel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    name: mon.name,
    rarity: mon.rarity || "Common",
    level: Math.max(1, Math.floor(mon.level || 1)),
    gold: Math.max(0, Math.floor(salvage?.gold || 0)),
    essence: Math.max(0, Math.floor(salvage?.essence || 0)),
    shards: Math.max(0, Math.floor(salvage?.shards || 0)),
    source: "box",
    instanceId,
  };
  if (mon.wildPendingId) entry.recoveryId = mon.wildPendingId;
  return entry;
}

function returnGearToInventory(save, mon) {
  const gearInventory = Array.isArray(save.gearInventory) ? [...save.gearInventory] : [];
  for (const slot of GEAR_SLOTS) {
    const gear = mon?.equipment?.[slot];
    if (!gear) continue;
    const normalized = sanitizeGear(gear);
    if (normalized) gearInventory.push(normalized);
  }
  return gearInventory;
}

function findMonLocation(save, instanceId) {
  const id = String(instanceId || "").trim();
  if (!id) return null;
  const box = Array.isArray(save?.box) ? save.box : [];
  const boxIndex = box.findIndex((mon) => resolveMonInstanceId(mon) === id);
  if (boxIndex >= 0) return { source: "box", index: boxIndex, mon: box[boxIndex] };
  return null;
}

export function applyReleaseToSave(save, mon) {
  const salvage = getReleaseSalvage(mon);
  const party = Array.isArray(save.party) ? [...save.party] : [];
  const box = Array.isArray(save.box) ? [...save.box] : [];
  const instanceId = resolveMonInstanceId(mon);
  const loc = findMonLocation({ party, box }, instanceId);
  if (!loc || loc.source !== "box") {
    return { ok: false, error: "mon_not_in_box" };
  }
  box.splice(loc.index, 1);

  const releaseLog = Array.isArray(save.releaseLog) ? [...save.releaseLog] : [];
  const entry = buildReleaseLogEntry(mon, salvage);
  releaseLog.unshift(entry);

  const blocked = collectReleaseRecoveryKeys(mon);
  const releasedRecoveryIds = Array.isArray(save.releasedRecoveryIds)
    ? [...save.releasedRecoveryIds]
    : [];
  const seen = new Set(releasedRecoveryIds);
  for (const key of blocked) {
    if (seen.has(key)) continue;
    seen.add(key);
    releasedRecoveryIds.push(key);
  }

  return {
    ok: true,
    save: {
      ...save,
      party,
      box,
      money: (save.money || 0) + salvage.gold,
      essence: (save.essence || 0) + salvage.essence,
      monShards: (save.monShards || 0) + salvage.shards,
      gearInventory: returnGearToInventory(save, mon),
      releaseLog: releaseLog.slice(0, 200),
      releasedRecoveryIds: releasedRecoveryIds.slice(0, 500),
      updatedAt: new Date().toISOString(),
    },
    salvage,
    instanceId,
    releaseLogEntry: entry,
  };
}

async function persistReleaseSave(kv, session, save, expectedRevision, startingMonballs, instanceId, attempt = 0) {
  const now = Date.now();
  let payload = buildSavePayload(
    { ...save, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  const { save: existingSave } = await loadCloudSave(kv, session.xUserId, { now });
  preserveServerAuthoritativeFields(payload, existingSave);
  Object.assign(payload, guardSavePayload(existingSave, payload));
  await reconcileMonballsForCloudSave(kv, session, payload, startingMonballs);
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, { expectedRevision });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_RELEASE_RETRIES) {
      const { save: latest } = await loadCloudSave(kv, session.xUserId, { now });
      const loc = findMonLocation(latest, instanceId);
      if (!loc) {
        return { ok: true, save: latest, idempotent: true };
      }
      const retry = applyReleaseToSave(latest, loc.mon);
      if (!retry.ok) {
        return { ok: false, error: retry.error || "release_conflict", save: latest };
      }
      return persistReleaseSave(
        kv,
        session,
        retry.save,
        latest.revision,
        startingMonballs,
        instanceId,
        attempt + 1
      );
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "release_conflict", save: err.existingSave };
    }
    throw err;
  }
}

/**
 * Atomic server-side release from Box only (by instanceId / wildPendingId).
 */
export async function releaseMonFromBox(kv, session, { instanceId, expectedRevision, releaseToken }, startingMonballs = 10) {
  const targetId = String(instanceId || "").trim();
  if (!targetId) return { ok: false, error: "instance_id_required" };

  const { save: existingSave } = await loadCloudSave(kv, session.xUserId);
  const loc = findMonLocation(existingSave, targetId);
  if (!loc) {
    const released = new Set([
      ...(existingSave.releasedRecoveryIds || []),
      ...(existingSave.releaseLog || []).flatMap((e) => [e.instanceId, e.recoveryId].filter(Boolean)),
    ]);
    if (released.has(targetId)) {
      return { ok: true, idempotent: true, save: existingSave, instanceId: targetId };
    }
    return { ok: false, error: "mon_not_found", save: existingSave };
  }

  const applied = applyReleaseToSave(existingSave, loc.mon);
  if (!applied.ok) return { ...applied, save: existingSave };

  const persisted = await persistReleaseSave(
    kv,
    session,
    applied.save,
    expectedRevision,
    startingMonballs,
    targetId
  );
  if (!persisted.ok) return persisted;

  try {
    console.log(JSON.stringify({
      evt: "release_mon_ok",
      xUserId: session.xUserId,
      instanceId: targetId,
      releaseToken: releaseToken || null,
      baseRevision: expectedRevision,
      revision: persisted.save?.revision,
      boxCount: persisted.save?.box?.length ?? 0,
    }));
  } catch (_) {}

  return {
    ok: true,
    save: persisted.save,
    instanceId: targetId,
    salvage: applied.salvage,
    releaseLogEntry: applied.releaseLogEntry,
  };
}
