/**
 * Server-authoritative mon level-up + rarity ascend.
 */
(function () {
  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  function mutationBody(extra) {
    const body = { ...extra };
    if (typeof MonExAuth !== "undefined" && MonExAuth.getSaveRevision) {
      const rev = MonExAuth.getSaveRevision();
      if (rev != null) body.baseRevision = rev;
    }
    return body;
  }

  function applyUpgradeConflict(res, data) {
    if (res.status !== 409 || !data?.save) return false;
    if (data.error !== "upgrade_conflict") return false;
    if (typeof window.handleCloudSaveConflict === "function") {
      window.handleCloudSaveConflict(data.save);
      return true;
    }
    if (typeof MonExAuth !== "undefined" && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
    return true;
  }

  function syncMutationRevision(res, data, conflictHandled) {
    if (conflictHandled) return;
    if (data.ok && data.save && typeof MonExAuth !== "undefined" && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
  }

  async function postMonMutation(path, payload) {
    if (typeof MonExAuth !== "undefined" && MonExAuth.awaitCloudSaveIdle) {
      await MonExAuth.awaitCloudSaveIdle();
    }
    const res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(mutationBody(payload)),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    const conflictHandled = applyUpgradeConflict(res, data);
    syncMutationRevision(res, data, conflictHandled);
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  function targetFromMon(mon, partyIndex) {
    const payload = {};
    if (typeof mon?.instanceId === "string" && mon.instanceId.trim()) {
      payload.instanceId = mon.instanceId.trim();
    }
    if (typeof mon?.wildPendingId === "string" && mon.wildPendingId.trim()) {
      payload.wildPendingId = mon.wildPendingId.trim();
    }
    if (payload.instanceId || payload.wildPendingId) return payload;
    if (partyIndex != null && Number.isFinite(Number(partyIndex))) {
      payload.partyIndex = Math.floor(Number(partyIndex));
    }
    return payload;
  }

  async function levelUpMon(mon, partyIndex) {
    return postMonMutation("/api/mon/level-up", targetFromMon(mon, partyIndex));
  }

  async function ascendMonRarity(mon, partyIndex) {
    return postMonMutation("/api/mon/ascend-rarity", targetFromMon(mon, partyIndex));
  }

  window.MonExMonUpgrade = {
    levelUpMon,
    ascendMonRarity,
  };
})();
