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

  function buildCampaignCompletionId(chapter, stage) {
    const ch = Math.max(1, Math.floor(Number(chapter) || 1));
    const st = Math.max(1, Math.floor(Number(stage) || 1));
    return `campaign:chapter-${ch}:stage-${st}:first-clear`;
  }

  function buildPatrolCompletionId(patrolScansDay, patrolScansUsed, encounterId) {
    const day = String(patrolScansDay || "unknown").trim().slice(0, 32) || "unknown";
    const scan = Math.max(1, Math.floor(Number(patrolScansUsed) || 1));
    const enc = String(encounterId || "common").trim().slice(0, 24) || "common";
    return `patrol:day-${day}:scan-${scan}:${enc}`;
  }

  function buildPatrolCompletionTokenId(token) {
    const value = String(token || "").trim().slice(0, 64);
    if (!value) return null;
    return `patrol:token:${value}`.slice(0, 96);
  }

  async function claimBattleReward({ mode, win, encounterId, claimId, chapter, stage, patrolScansDay, patrolScansUsed }) {
    if (typeof MonExAuth !== "undefined" && MonExAuth.awaitCloudSaveIdle) {
      await MonExAuth.awaitCloudSaveIdle();
    }
    const res = await fetch(`${apiBase()}/api/battle/claim-reward`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(claimBody({
        mode,
        win: win !== false,
        encounterId,
        claimId,
        chapter,
        stage,
        patrolScansDay,
        patrolScansUsed,
      })),
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
      if (last.status === 403) return last;
      // 409: conflict handler refreshed save — retry with updated revision.
    }
    return last;
  }

  window.MonExBattle = {
    claimBattleReward,
    claimBattleRewardWithRetry,
    buildCampaignCompletionId,
    buildPatrolCompletionId,
    buildPatrolCompletionTokenId,
  };
})();
