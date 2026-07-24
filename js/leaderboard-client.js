/**
 * Public leaderboard client (campaign + frozen power rating).
 */
(function () {
  const PAGE_SIZE = 25;
  const MAX_ENTRIES = 50;

  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  async function fetchLeaderboard(board, { limit = MAX_ENTRIES } = {}) {
    const params = new URLSearchParams({
      board: String(board || "campaign"),
      limit: String(Math.max(1, Math.min(MAX_ENTRIES, Math.floor(Number(limit) || MAX_ENTRIES)))),
    });
    const res = await fetch(`${apiBase()}/api/leaderboard?${params}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    const entries = Array.isArray(data.entries) ? data.entries.slice(0, MAX_ENTRIES) : [];
    return {
      ok: res.ok && data.ok,
      status: res.status,
      board: data.board || board,
      preview: !!data.preview,
      generatedAt: data.generatedAt || null,
      entries,
      error: data.error || null,
      ...data,
      entries,
    };
  }

  function paginateEntries(entries, page) {
    const list = Array.isArray(entries) ? entries.slice(0, MAX_ENTRIES) : [];
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
    const pageNum = Math.min(Math.max(1, Math.floor(Number(page) || 1)), totalPages);
    const start = (pageNum - 1) * PAGE_SIZE;
    return {
      page: pageNum,
      totalPages,
      pageSize: PAGE_SIZE,
      maxEntries: MAX_ENTRIES,
      total,
      entries: list.slice(start, start + PAGE_SIZE),
      rangeLabel: total
        ? `${start + 1}–${Math.min(start + PAGE_SIZE, total)}`
        : "0",
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
    PAGE_SIZE,
    MAX_ENTRIES,
    fetchLeaderboard,
    paginateEntries,
    vipRank,
    rankRowClass,
    formatRankCell,
  };
})();
