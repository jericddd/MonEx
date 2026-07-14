/**
 * Server-authoritative quest reward claims.
 */
(function () {
  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  function claimBody(extra) {
    const body = { ...extra };
    if (typeof MonExAuth !== "undefined" && MonExAuth.getSaveRevision) {
      const rev = MonExAuth.getSaveRevision();
      if (rev != null) body.baseRevision = rev;
    }
    return body;
  }

  function resolveClaimConflict(data) {
    if (data?.save && typeof window.handleCloudSaveConflict === "function") {
      window.handleCloudSaveConflict(data.save);
    }
  }

  async function claimQuestTask(tab, taskId) {
    const res = await fetch(`${apiBase()}/api/quest/claim-task`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(claimBody({ tab, taskId })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    if (res.status === 409 && data.error === "claim_conflict" && data.save) {
      resolveClaimConflict(data);
    }
    const result = { ok: res.ok && data.ok, status: res.status, ...data };
    if (result.ok && result.save && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(result.save.revision);
    }
    return result;
  }

  async function claimQuestChest(track, milestone) {
    const res = await fetch(`${apiBase()}/api/quest/claim-chest`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(claimBody({ track, milestone })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    if (res.status === 409 && data.error === "claim_conflict" && data.save) {
      resolveClaimConflict(data);
    }
    const result = { ok: res.ok && data.ok, status: res.status, ...data };
    if (result.ok && result.save && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(result.save.revision);
    }
    return result;
  }

  window.MonExQuest = { claimQuestTask, claimQuestChest };
})();
