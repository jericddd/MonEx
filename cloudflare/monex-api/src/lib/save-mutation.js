/**
 * Shared CAS persist helper for server-authoritative save mutations.
 */
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";

const MAX_MUTATION_RETRIES = 3;

export function monIdentityKey(mon) {
  if (typeof mon?.instanceId === "string" && mon.instanceId.trim()) return mon.instanceId.trim();
  if (typeof mon?.wildPendingId === "string" && mon.wildPendingId.trim()) return mon.wildPendingId.trim();
  return null;
}

export function findMonInSave(save, { instanceId, wildPendingId, partyIndex } = {}) {
  const party = Array.isArray(save?.party) ? save.party : [];
  const box = Array.isArray(save?.box) ? save.box : [];
  const wantInstance = typeof instanceId === "string" ? instanceId.trim() : "";
  const wantPending = typeof wildPendingId === "string" ? wildPendingId.trim() : "";

  const match = (mon) => {
    if (!mon) return false;
    if (wantInstance && monIdentityKey(mon) === wantInstance) return true;
    if (wantPending && typeof mon.wildPendingId === "string" && mon.wildPendingId.trim() === wantPending) {
      return true;
    }
    return false;
  };

  if (wantInstance || wantPending) {
    for (let i = 0; i < party.length; i++) {
      if (match(party[i])) return { list: "party", index: i, mon: party[i] };
    }
    for (let i = 0; i < box.length; i++) {
      if (match(box[i])) return { list: "box", index: i, mon: box[i] };
    }
    return null;
  }

  const idx = Math.floor(Number(partyIndex));
  if (Number.isFinite(idx) && idx >= 0 && idx < party.length && party[idx]) {
    return { list: "party", index: idx, mon: party[idx] };
  }
  return null;
}

export async function persistMutationSave(kv, session, save, expectedRevision, startingMonballs) {
  const now = Date.now();
  let payload = buildSavePayload(
    { ...save, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  await reconcileMonballsForCloudSave(kv, session, payload, startingMonballs);
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, { expectedRevision });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict") {
      return {
        ok: false,
        error: "revision_conflict",
        existingSave: err.existingSave,
        currentRevision: err.currentRevision,
      };
    }
    throw err;
  }
}

/**
 * Run a pure apply(save) → nextSave under revision CAS with conflict retry.
 * apply must be re-runnable on the latest save after conflicts.
 */
export async function runSaveMutation(kv, session, { expectedRevision, startingMonballs = 10, apply, conflictError = "mutation_conflict" }) {
  let expectedRev =
    expectedRevision != null && Number.isFinite(Number(expectedRevision))
      ? Number(expectedRevision)
      : null;

  for (let attempt = 0; attempt <= MAX_MUTATION_RETRIES; attempt++) {
    const { save } = await loadCloudSave(kv, session.xUserId);
    if (expectedRev == null) {
      expectedRev = Number.isFinite(Number(save?.revision)) ? Number(save.revision) : 0;
    }

    const applied = apply(save);
    if (!applied?.ok) return applied;

    const persisted = await persistMutationSave(
      kv,
      session,
      applied.save,
      expectedRev,
      startingMonballs
    );

    if (persisted.ok) {
      return { ...applied, ok: true, save: persisted.save };
    }

    if (persisted.error !== "revision_conflict" || attempt >= MAX_MUTATION_RETRIES) {
      return {
        ok: false,
        error: conflictError,
        save: persisted.existingSave,
      };
    }

    expectedRev = persisted.currentRevision ?? persisted.existingSave?.revision ?? expectedRev;
  }

  return { ok: false, error: conflictError };
}
