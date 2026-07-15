/**
 * Profile catch-log claim API (dispatch staged mons to party/box; spend already applied at catch log).
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
    if (window.MonExGameSession?.getGameSessionId) {
      body.gameSessionId = window.MonExGameSession.getGameSessionId();
    }
    return body;
  }

  function resolveClaimConflict(data) {
    if (data?.save && typeof window.handleCloudSaveConflict === "function") {
      window.handleCloudSaveConflict(data.save);
    }
  }

  async function claimCatchFromLog(tweetId, options = {}) {
    const id = String(tweetId || "").trim();
    if (!id) throw new Error("tweet_id_required");
    if (window.MonExGameSession?.isGameplayAllowed && !window.MonExGameSession.isGameplayAllowed()) {
      throw new Error("game_session_inactive");
    }

    const body = claimBody({
      tweetId: id,
      partyCount: options.partyCount,
      boxCount: options.boxCount,
      partyMax: options.partyMax,
      boxMax: options.boxMax,
    });

    const res = await fetch(`${apiBase()}/api/catch/claim`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 403 && (data.error === "game_session_inactive" || data.error === "game_session_required")) {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    if (res.status === 409 && data.error === "claim_conflict" && data.save) {
      resolveClaimConflict(data);
    }

    const result = { ok: res.ok && data.ok !== false, status: res.status, ...data };
    if (result.ok && result.save && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(result.save.revision);
    }
    return result;
  }

  window.MonExCatchClaim = { claimCatchFromLog };
})();
