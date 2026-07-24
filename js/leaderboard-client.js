/**
 * Public leaderboard client (campaign + power preview).
 */
(function () {
  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  async function fetchLeaderboard(board, { limit = 25 } = {}) {
    const params = new URLSearchParams({
      board: String(board || "campaign"),
      limit: String(Math.max(1, Math.min(50, Math.floor(Number(limit) || 25)))),
    });
    const res = await fetch(`${apiBase()}/api/leaderboard?${params}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && data.ok,
      status: res.status,
      board: data.board || board,
      preview: !!data.preview,
      generatedAt: data.generatedAt || null,
      entries: Array.isArray(data.entries) ? data.entries : [],
      error: data.error || null,
      ...data,
    };
  }

  window.MonExLeaderboard = { fetchLeaderboard };
})();
