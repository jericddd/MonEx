import { loadState, saveState, resolveCatchUser } from "../kv-store.js";
import { clampMonballs, mergeMonballBalances } from "./grant-monballs.js";

/**
 * When the game client saves, align catch-state monballs to the cloud save so
 * X-catch and in-game balances stay in sync after mailbox grants and spends.
 */
export async function alignCatchMonballsToSave(kv, session, saveMonballs, startingMonballs = 10) {
  if (!session?.xUserId) return null;
  const state = await loadState(kv);
  const user = resolveCatchUser(state, session.xUserId, session.username, startingMonballs);
  if (!user) return null;
  const aligned = clampMonballs(saveMonballs ?? 0);
  user.monballs = aligned;
  user.updatedAt = new Date().toISOString();
  await saveState(kv, state);
  return aligned;
}

/**
 * Pick authoritative monballs when reconciling catch state vs cloud save.
 * Prefer catch when catch state was updated more recently (X wild activity).
 */
export function resolveMergedMonballs(catchUser, save, catchMonballs) {
  const catchTs = Date.parse(catchUser?.updatedAt || "");
  const saveTs = Date.parse(save?.updatedAt || "");
  const catchVal = clampMonballs(catchMonballs ?? 0);
  const saveVal = clampMonballs(save?.monballs ?? 0);
  const catchTsValid = Number.isFinite(catchTs);
  const saveTsValid = Number.isFinite(saveTs);

  if (catchTsValid && !saveTsValid) return catchVal;
  if (saveTsValid && !catchTsValid) return saveVal;
  if (catchTsValid && saveTsValid) {
    if (catchTs > saveTs) return catchVal;
    if (saveTs > catchTs) return saveVal;
  }
  return mergeMonballBalances(catchVal, saveVal);
}
