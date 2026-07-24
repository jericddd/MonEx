/**
 * Public leaderboard client (campaign + frozen power rating).
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

  function vipRank(rank) {
    const n = Math.floor(Number(rank) || 0);
    return n >= 1 && n <= 3 ? n : 0;
  }

  function rankRowClass(rank) {
    const n = vipRank(rank);
    return n ? `rank-vip rank-vip-row-${n}` : "";
  }

  function formatRankCell(rank) {
    const n = Math.floor(Number(rank) || 0);
    const vip = vipRank(n);
    if (!vip) return String(n || "");
    const labels = { 1: "1st", 2: "2nd", 3: "3rd" };
    return `<span class="rank-vip-badge rank-vip-${vip}" aria-label="Rank ${n}">${labels[vip]}</span>`;
  }

  window.MonExLeaderboard = {
    fetchLeaderboard,
    vipRank,
    rankRowClass,
    formatRankCell,
  };
})();
