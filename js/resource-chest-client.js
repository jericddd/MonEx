/**
 * Server-authoritative resource chest collection.
 */
(function () {
  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  function body(extra) {
    const payload = { ...extra };
    if (typeof MonExAuth !== "undefined" && MonExAuth.getSaveRevision) {
      const rev = MonExAuth.getSaveRevision();
      if (rev != null) payload.baseRevision = rev;
    }
    return payload;
  }

  async function collectResourceChest() {
    const res = await fetch(`${apiBase()}/api/resource-chest/collect`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body({})),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    if (res.status === 409 && data.error === "collect_conflict" && data.save && MonExAuth.handleCloudSaveConflict) {
      await MonExAuth.handleCloudSaveConflict(data.save);
    }
    if (data.save && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  window.MonExResourceChest = { collectResourceChest };
})();
