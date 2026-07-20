/**
 * Server-authoritative party / equip / armory mutations.
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

  function applyConflict(res, data) {
    if (res.status !== 409 || !data?.save) return false;
    if (typeof window.handleCloudSaveConflict === "function") {
      window.handleCloudSaveConflict(data.save);
      return true;
    }
    if (typeof MonExAuth !== "undefined" && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
    return true;
  }

  async function postMutation(path, payload) {
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
    const conflictHandled = applyConflict(res, data);
    if (!conflictHandled && data.ok && data.save && typeof MonExAuth !== "undefined" && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  window.MonExInventory = {
    addFromBox: (boxInstanceId) => postMutation("/api/party/add-from-box", { boxInstanceId }),
    swapWithBox: (partyInstanceId, boxInstanceId) =>
      postMutation("/api/party/swap-with-box", { partyInstanceId, boxInstanceId }),
    reorderParty: (partyInstanceIds) =>
      postMutation("/api/party/reorder", { partyInstanceIds }),
    equipGear: (instanceId, gearId) =>
      postMutation("/api/gear/equip", { instanceId, gearId }),
    unequipGear: (instanceId, slot) =>
      postMutation("/api/gear/unequip", { instanceId, slot }),
    heroAscend: (mainInstanceId, dupeInstanceIds) =>
      postMutation("/api/armory/hero-ascend", { mainInstanceId, dupeInstanceIds }),
    unlockSkill: (instanceId, skillIndex) =>
      postMutation("/api/armory/unlock-skill", { instanceId, skillIndex }),
    enhanceGear: (gearId) => postMutation("/api/armory/enhance", { gearId }),
    synthGear: (gearIds) => postMutation("/api/armory/synth", { gearIds }),
  };
})();
