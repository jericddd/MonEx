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

export async function writeCloudSave(kv, xUserId, payload, options = {}) {
  if (!options.skipStaleCheck) {
    const raw = await kv.get(saveKey(xUserId));
    if (raw) {
      let existingUpdatedAt = 0;
      try {
        existingUpdatedAt = Date.parse(JSON.parse(raw).updatedAt || "");
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
        err.existingSave = validateAndSanitizeSave(JSON.parse(raw), {}, options);
        throw err;
      }
    }
  }
  await kv.put(saveKey(xUserId), JSON.stringify(payload));
  return payload;
}
