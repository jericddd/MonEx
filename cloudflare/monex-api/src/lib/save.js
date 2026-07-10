import { validateAndSanitizeSave } from "./save-validate.js";

const SAVE_PREFIX = "monex:save:";

export const DEFAULT_SAVE = validateAndSanitizeSave({});

function saveKey(xUserId) {
  return `${SAVE_PREFIX}${xUserId}`;
}

export function buildSavePayload(body, session, options = {}) {
  return validateAndSanitizeSave(body && typeof body === "object" ? body : {}, session, options);
}

export async function loadCloudSave(kv, xUserId, options = {}) {
  const raw = await kv.get(saveKey(xUserId));
  if (!raw) return { found: false, save: { ...DEFAULT_SAVE } };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { found: false, save: { ...DEFAULT_SAVE } };
  }
  const save = validateAndSanitizeSave(parsed, { username: parsed?.xHandle || "" }, options);
  return { found: true, save };
}

/**
 * Persist a cloud save with server-managed monotonic revision.
 *
 * - Every accepted write sets payload.revision = current stored revision + 1.
 * - When options.expectedRevision is provided (optimistic locking), the write
 *   is rejected with code "revision_conflict" unless it matches the stored
 *   revision exactly. This makes it impossible for a stale client to
 *   overwrite newer progress, regardless of fabricated updatedAt timestamps.
 * - Legacy clients that do not send a revision fall back to the updatedAt
 *   stale check (options.skipStaleCheck bypasses it for server-internal writes).
 */
export async function writeCloudSave(kv, xUserId, payload, options = {}) {
  const raw = await kv.get(saveKey(xUserId));
  let existing = null;
  if (raw) {
    try {
      existing = JSON.parse(raw);
    } catch {
      existing = null;
    }
  }
  const currentRevision = Number.isFinite(Number(existing?.revision))
    ? Math.max(0, Math.floor(Number(existing.revision)))
    : 0;

  if (existing && options.expectedRevision != null) {
    const expected = Number(options.expectedRevision);
    if (!Number.isFinite(expected) || expected !== currentRevision) {
      const err = new Error("revision_conflict");
      err.code = "revision_conflict";
      err.currentRevision = currentRevision;
      err.existingSave = validateAndSanitizeSave(existing, {}, options);
      throw err;
    }
  } else if (!options.skipStaleCheck && existing) {
    let existingUpdatedAt = 0;
    try {
      existingUpdatedAt = Date.parse(existing.updatedAt || "");
    } catch {
      existingUpdatedAt = 0;
    }
    const incomingUpdatedAt = Date.parse(payload.updatedAt || "");
    if (
      Number.isFinite(existingUpdatedAt)
      && Number.isFinite(incomingUpdatedAt)
      && incomingUpdatedAt < existingUpdatedAt
    ) {
      const err = new Error("stale_save");
      err.code = "stale_save";
      err.existingSave = validateAndSanitizeSave(existing, {}, options);
      throw err;
    }
  }

  payload.revision = currentRevision + 1;
  await kv.put(saveKey(xUserId), JSON.stringify(payload));
  return payload;
}
