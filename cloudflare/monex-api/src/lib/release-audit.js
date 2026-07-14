import { sanitizeReleaseLog, sanitizeReleasedRecoveryIds } from "./save-validate.js";

function monPersistenceKeys(mon) {
  const keys = [];
  if (typeof mon?.instanceId === "string" && mon.instanceId.trim()) keys.push(mon.instanceId.trim());
  if (typeof mon?.wildPendingId === "string" && mon.wildPendingId.trim()) keys.push(mon.wildPendingId.trim());
  return keys;
}

export function buildReleasedBlocklist(save) {
  const released = new Set(sanitizeReleasedRecoveryIds(save?.releasedRecoveryIds));
  for (const entry of sanitizeReleaseLog(save?.releaseLog)) {
    if (entry.recoveryId) released.add(entry.recoveryId);
    if (entry.instanceId) released.add(entry.instanceId);
    const match = String(entry.recoveryId || "").match(/^recovery_(.+)_(\d+)$/);
    if (match) released.add(`activity:${match[1]}:${match[2]}`);
  }
  return released;
}

export function findReleasedMonsInInventory(save) {
  const released = buildReleasedBlocklist(save);
  if (!released.size) return [];
  const ghosts = [];
  for (const [source, mons] of [["party", save?.party || []], ["box", save?.box || []]]) {
    for (const mon of mons) {
      const keys = monPersistenceKeys(mon);
      const blocked = keys.filter((key) => released.has(key));
      if (blocked.length) {
        ghosts.push({
          source,
          name: mon?.name || "(unknown)",
          rarity: mon?.rarity || null,
          level: mon?.level ?? null,
          instanceId: mon?.instanceId || null,
          wildPendingId: mon?.wildPendingId || null,
          blockedKeys: blocked,
        });
      }
    }
  }
  return ghosts;
}

export function analyzeReleaseLogForSave(save, { recentLimit = 15 } = {}) {
  const releaseLog = sanitizeReleaseLog(save?.releaseLog);
  const releasedRecoveryIds = sanitizeReleasedRecoveryIds(save?.releasedRecoveryIds);
  const inventoryGhosts = findReleasedMonsInInventory(save);
  const salvageTotals = releaseLog.reduce(
    (acc, entry) => ({
      gold: acc.gold + (entry.gold || 0),
      essence: acc.essence + (entry.essence || 0),
      shards: acc.shards + (entry.shards || 0),
    }),
    { gold: 0, essence: 0, shards: 0 },
  );

  return {
    releaseLogCount: releaseLog.length,
    releasedRecoveryIdsCount: releasedRecoveryIds.length,
    releasedRecoveryIds,
    recentReleases: releaseLog.slice(0, recentLimit),
    salvageTotalsFromLog: salvageTotals,
    inventoryGhosts,
    inventoryConsistent: inventoryGhosts.length === 0,
  };
}
