import { validateAndSanitizeSave, sanitizeQuestOneTimeResetsApplied } from "./save-validate.js";
import { mergeAccountBattleCompletions } from "./battle-completion.js";
import {
  mergeReleaseLog,
  mergeReleasedRecoveryIds,
  stripReleasedMonsFromInventory,
} from "./save-economy-guard.js";

const SAVE_PREFIX = "monex:save:";
const saveWriteLocks = globalThis.__monexSaveWriteLocks || (globalThis.__monexSaveWriteLocks = new Map());

async function acquireKeyedLock(lockMap, key) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  while (true) {
    if (!lockMap.has(key)) {
      lockMap.set(key, gate);
      break;
    }
    await lockMap.get(key);
  }
  return () => {
    if (lockMap.get(key) === gate) lockMap.delete(key);
    release();
  };
}

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
    // A key EXISTS but is unreadable. This is corruption, NOT a new account.
    // Signal it distinctly so callers (e.g. GET /api/save) can refuse to serve
    // "new player" defaults, which would let the client overwrite real progress.
    return { found: false, corrupt: true, save: { ...DEFAULT_SAVE } };
  }
  const save = validateAndSanitizeSave(parsed, { username: parsed?.xHandle || "" }, options);
  return { found: true, save };
}

/**
 * Server-authoritative fields must never be taken from a client save PUT.
 * These are only ever mutated by trusted server endpoints (mailbox claim,
 * daily-login claim). Copying them from the stored save blocks exploits where
 * a client injects mailbox rewards or resets the daily-login cooldown by
 * crafting a save payload.
 */
export function preserveServerAuthoritativeFields(payload, existingSave) {
  const src = existingSave && typeof existingSave === "object" ? existingSave : {};
  payload.mailbox = Array.isArray(src.mailbox) ? src.mailbox : [];
  payload.dailyLoginLastClaimAt = src.dailyLoginLastClaimAt ?? null;
  payload.questOneTimeResetsApplied = sanitizeQuestOneTimeResetsApplied(src.questOneTimeResetsApplied);
  payload.questMonballPaidAmounts =
    src.questMonballPaidAmounts && typeof src.questMonballPaidAmounts === "object"
      ? src.questMonballPaidAmounts
      : payload.questMonballPaidAmounts;
  payload.accountCompensationsApplied =
    src.accountCompensationsApplied && typeof src.accountCompensationsApplied === "object"
      ? src.accountCompensationsApplied
      : payload.accountCompensationsApplied;
  payload.accountBattleCompletions = mergeAccountBattleCompletions(
    src.accountBattleCompletions,
    payload.accountBattleCompletions
  );
  return payload;
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
  const useRevisionLock = options.expectedRevision != null;
  const release = useRevisionLock ? await acquireKeyedLock(saveWriteLocks, String(xUserId || "")) : null;
  try {
    return await writeCloudSaveUnlocked(kv, xUserId, payload, options);
  } finally {
    if (release) release();
  }
}

async function writeCloudSaveUnlocked(kv, xUserId, payload, options = {}) {
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

  if (existing) {
    const exSan = validateAndSanitizeSave(existing, {}, options);
    payload.releaseLog = mergeReleaseLog(exSan, payload);
    payload.releasedRecoveryIds = mergeReleasedRecoveryIds(exSan, payload);
    payload = stripReleasedMonsFromInventory(exSan, payload);
  }

  payload.revision = currentRevision + 1;
  await kv.put(saveKey(xUserId), JSON.stringify(payload));
  return payload;
}
