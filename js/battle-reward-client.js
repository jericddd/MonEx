/**
 * Server-authoritative battle and patrol rewards.
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

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function resolveClaimConflict(data) {
    if (data?.save && typeof window.handleCloudSaveConflict === "function") {
      window.handleCloudSaveConflict(data.save);
    }
  }

  async function claimBattleReward({ mode, win, encounterId, claimId, chapter, stage }) {
    const res = await fetch(`${apiBase()}/api/battle/claim-reward`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(claimBody({ mode, win, encounterId, claimId, chapter, stage })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    if (res.status === 409 && data.error === "reward_conflict" && data.save) {
      resolveClaimConflict(data);
    }
    const result = { ok: res.ok && data.ok, status: res.status, ...data };
    if (result.ok && result.save && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(result.save.revision);
    }
    return result;
  }

  async function claimBattleRewardWithRetry(params, options = {}) {
    const waits = options.waits || [0, 800, 2000];
    let last = null;
    for (let i = 0; i < waits.length; i++) {
      if (waits[i]) await delay(waits[i]);
      last = await claimBattleReward(params);
      if (last.ok && last.save) return last;
      if (last.status === 403 || last.status === 409) return last;
    }
    return last;
  }

  window.MonExBattle = { claimBattleReward, claimBattleRewardWithRetry };
})();
