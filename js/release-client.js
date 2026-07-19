/**
 * Server-authoritative Box Mon release.
 */
(function () {
  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  function releaseBody(instanceId, releaseToken) {
    const body = {
      instanceId: String(instanceId || "").trim(),
      releaseToken: releaseToken || null,
    };
    if (typeof MonExAuth !== "undefined" && MonExAuth.getSaveRevision) {
      const rev = MonExAuth.getSaveRevision();
      if (rev != null) body.baseRevision = rev;
    }
    return body;
  }

  function saveMissingInstance(save, instanceId) {
    if (!save || !instanceId) return false;
    const id = String(instanceId).trim();
    const lists = [...(save.box || []), ...(save.party || [])];
    return !lists.some((mon) => mon?.instanceId === id || mon?.wildPendingId === id);
  }

  async function releaseMon(instanceId, releaseToken) {
    if (typeof MonExAuth !== "undefined" && MonExAuth.awaitCloudSaveIdle) {
      await MonExAuth.awaitCloudSaveIdle();
    }
    const res = await fetch(`${apiBase()}/api/release-mon`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(releaseBody(instanceId, releaseToken)),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }

    // Conflict with a save that already removed this mon is success (idempotent).
    // Do NOT call handleCloudSaveConflict then fail — that restored the mon in UI.
    const releasedOk = Boolean(data.save && saveMissingInstance(data.save, instanceId));
    const ok = Boolean((res.ok && data.ok) || releasedOk);
    if (ok && data.save && typeof MonExAuth !== "undefined" && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
    return { ...data, ok, status: res.status, save: data.save };
  }

  window.MonExRelease = { releaseMon };
})();
