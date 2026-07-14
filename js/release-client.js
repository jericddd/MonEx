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

  async function releaseMon(instanceId, releaseToken) {
    const res = await fetch(`${apiBase()}/api/release-mon`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(releaseBody(instanceId, releaseToken)),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    if (res.status === 409 && data.error === "release_conflict" && data.save && typeof window.handleCloudSaveConflict === "function") {
      window.handleCloudSaveConflict(data.save);
    }
    const result = { ok: res.ok && data.ok, status: res.status, ...data };
    if (result.ok && result.save && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(result.save.revision);
    }
    return result;
  }

  window.MonExRelease = { releaseMon };
})();
