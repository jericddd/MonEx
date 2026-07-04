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

export async function writeCloudSave(kv, xUserId, payload) {
  await kv.put(saveKey(xUserId), JSON.stringify(payload));
  return payload;
}
