/** Shared X activity feed client for home + game profile */

/** Live activity API — Cloudflare Workers (free). Set js/monex-config.js after deploy. */
const MONEX_API_PRODUCTION = "https://monex-api.0xjericd.workers.dev";

function getMonexApiBase() {
    if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
        if (location.port === "3001") return "";
        return `http://${host}:3001`;
    }
    return MONEX_API_PRODUCTION;
}

/** Hidden from home X Wild Log (global feed only). */
const HIDDEN_WILD_LOG_USERS = new Set(["yesdraken_"]);

function isHiddenWildLogUser(username) {
    return HIDDEN_WILD_LOG_USERS.has(String(username || "").toLowerCase().replace(/^@/, ""));
}

function filterHiddenWildLogEntries(data) {
    if (!data || !Array.isArray(data.entries)) return data;
    const entries = data.entries.filter((e) => !isHiddenWildLogUser(e.xUsername));
    const removed = data.entries.length - entries.length;
    return {
        ...data,
        entries,
        total: Math.max(0, (data.total || 0) - removed),
    };
}

function injectActivityUiStyles() {
    if (document.getElementById("monex-activity-ui-styles")) return;
    const style = document.createElement("style");
    style.id = "monex-activity-ui-styles";
    style.textContent = `
.hub-scrollbar-panel {
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: #c46a28 rgba(0, 0, 0, 0.2);
    -webkit-overflow-scrolling: touch;
}
.hub-scrollbar-panel::-webkit-scrollbar { width: 10px; }
.hub-scrollbar-panel::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.22);
    border-radius: 5px;
    margin-top: 8px;
    margin-bottom: 8px;
}
.hub-scrollbar-panel::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #d07020, #8b4a22);
    border: 1px solid #c46a28;
    border-radius: 5px;
}
#modal-box .hub-content-wrap.hub-scrollbar-panel::-webkit-scrollbar-track,
#modal-inventory .hub-content-wrap.hub-scrollbar-panel::-webkit-scrollbar-track {
    margin-top: 4px;
    margin-bottom: 8px;
}
.activity-item-clickable,
.activity-row-clickable {
    cursor: pointer;
    transition: background 0.12s ease, filter 0.12s ease;
}
.activity-item-clickable:hover {
    background: rgba(240, 160, 80, 0.12);
    margin: 0 -8px;
    padding-left: 8px;
    padding-right: 8px;
    border-radius: 6px;
}
.activity-row-clickable:hover td {
    background: rgba(250, 245, 255, 0.95) !important;
}
.activity-detail-overlay {
    position: fixed;
    inset: 0;
    z-index: 12000;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 48px 20px 32px;
    box-sizing: border-box;
    overflow-y: auto;
}
.activity-detail-overlay[hidden] { display: none; }
.activity-detail-panel {
    width: min(480px, 96vw);
    background: linear-gradient(180deg, #f8ecd8 0%, #edd9b8 100%);
    border: 3px solid #d4a04a;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 4px 0 #3d2010;
    border-radius: 10px;
    padding: 16px 18px 18px;
    font-family: 'Lato', sans-serif;
    color: #3d1a08;
    position: relative;
}
.activity-detail-panel--home {
    background: #fff;
    border: 4px solid #6B21A8;
    box-shadow: 4px 4px 0 #6B21A8;
    border-radius: 4px;
    color: #1f1235;
}
.activity-detail-close {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    border: 2px solid #991b1b;
    border-radius: 6px;
    background: linear-gradient(180deg, #ef4444, #b91c1c);
    color: #fff;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 2px 0 #7f1d1d;
}
.activity-detail-title {
    font-family: 'Press Start 2P', monospace;
    font-size: 9px;
    color: #8b4513;
    margin: 0 0 10px;
    padding-right: 36px;
    line-height: 1.5;
}
.activity-detail-panel--home .activity-detail-title { color: #6B21A8; }
.activity-detail-summary {
    font-size: 13px;
    line-height: 1.45;
    margin: 0 0 8px;
}
.activity-detail-meta {
    font-size: 11px;
    color: rgba(61, 26, 8, 0.65);
    margin: 0 0 14px;
}
.activity-detail-panel--home .activity-detail-meta { color: #666; }
.activity-detail-list-title {
    font-family: 'Press Start 2P', monospace;
    font-size: 8px;
    color: #8b4513;
    margin: 0 0 8px;
}
.activity-detail-panel--home .activity-detail-list-title { color: #6B21A8; }
.activity-detail-mon {
    border: 2px solid #d4a04a;
    background: rgba(255, 255, 255, 0.35);
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 6px;
    font-size: 12px;
    line-height: 1.4;
}
.activity-detail-panel--home .activity-detail-mon {
    border-color: #e9d5ff;
    background: #faf5ff;
}
.activity-detail-mon-name {
    font-weight: 700;
    margin-bottom: 2px;
}
.activity-detail-mon-skills {
    font-size: 11px;
    color: rgba(61, 26, 8, 0.75);
}
.activity-detail-panel--home .activity-detail-mon-skills { color: #555; }
.activity-detail-note {
    font-size: 11px;
    color: rgba(61, 26, 8, 0.6);
    font-style: italic;
    margin: 0 0 10px;
}
.activity-detail-escaped {
    font-size: 11px;
    color: rgba(61, 26, 8, 0.7);
    margin-top: 8px;
}
`;
    document.head.appendChild(style);
}

function getActivityMons(entry) {
    const list = entry.mons?.length
        ? entry.mons
        : entry.highlights?.length
            ? entry.highlights
            : [];
    const cap = Number.isFinite(entry.caughtCount) ? entry.caughtCount : list.length;
    return list.slice(0, Math.max(0, cap));
}

function escapeActivityHtml(value) {
    if (typeof window !== "undefined" && typeof window.escapeHtml === "function") {
        return window.escapeHtml(value);
    }
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatActivityEntryHtml(entry, opts = {}) {
    const showUser = opts.showUser !== false;
    const time = escapeActivityHtml(new Date(entry.at).toLocaleString());
    const mons = getActivityMons(entry);
    const caught = mons.length
        ? mons.slice(0, 3).map((h) => `<span class="activity-rare">${escapeActivityHtml(h.rarity)}</span> ${escapeActivityHtml(h.name)}`).join(", ")
        : "no catches";
    const more = entry.caughtCount > 3 ? ` +${entry.caughtCount - 3} more` : "";
    const userPart = showUser ? `<span class="activity-user">@${escapeActivityHtml(entry.xUsername)}</span> ` : "";
    return `<div class="activity-item activity-item-clickable" role="button" tabindex="0" data-activity-idx="__IDX__">
        ${userPart}spent <b>${escapeActivityHtml(entry.spend)}</b> Monballs → <b>${escapeActivityHtml(entry.caughtCount)}/${escapeActivityHtml(entry.throws)}</b> caught
        <div>${caught}${more}</div>
        <div class="activity-meta">${time} · ${escapeActivityHtml(entry.monballsLeft)} Monballs left on X · tap for full log</div>
    </div>`;
}

function ensureActivityDetailModal() {
    injectActivityUiStyles();
    let modal = document.getElementById("activity-detail-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "activity-detail-modal";
        modal.className = "activity-detail-overlay";
        modal.hidden = true;
        modal.innerHTML = `<div class="activity-detail-panel" role="dialog" aria-modal="true" aria-labelledby="activity-detail-title">
            <button type="button" class="activity-detail-close" aria-label="Close">×</button>
            <div id="activity-detail-body"></div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", (e) => {
            if (e.target === modal) closeActivityDetailModal();
        });
        modal.querySelector(".activity-detail-close")?.addEventListener("click", closeActivityDetailModal);
    }
    return modal;
}

function buildActivityDetailHtml(entry, opts = {}) {
    const showUser = opts.showUser !== false;
    const time = escapeActivityHtml(new Date(entry.at).toLocaleString());
    const mons = getActivityMons(entry);
    const displayCount = mons.length;
    const hasFullList = !!(entry.mons && entry.mons.length);
    const userLine = showUser ? `<span class="activity-user">@${escapeActivityHtml(entry.xUsername)}</span> ` : "";
    const monRows = mons.length
        ? mons.map((m, i) => `<div class="activity-detail-mon">
            <div class="activity-detail-mon-name">${i + 1}. <span class="activity-rare">${escapeActivityHtml(m.rarity)}</span> ${escapeActivityHtml(m.name)}</div>
            ${m.skills ? `<div class="activity-detail-mon-skills">Skills: ${escapeActivityHtml(m.skills)}</div>` : ""}
        </div>`).join("")
        : `<p class="activity-detail-note">No catches recorded for this session.</p>`;
    const legacyNote = !hasFullList && entry.caughtCount > displayCount
        ? `<p class="activity-detail-note">Older log — showing preview only (${displayCount} of ${entry.caughtCount} shown).</p>`
        : "";
    const escapedLine = entry.escapedCount > 0
        ? `<div class="activity-detail-escaped">${entry.escapedCount} Monanimal${entry.escapedCount === 1 ? "" : "s"} escaped.</div>`
        : "";
    return `
        <h3 class="activity-detail-title" id="activity-detail-title">CATCH SESSION</h3>
        <p class="activity-detail-summary">${userLine}spent <b>${escapeActivityHtml(entry.spend)}</b> Monballs → <b>${escapeActivityHtml(entry.caughtCount)}/${escapeActivityHtml(entry.throws)}</b> caught</p>
        <p class="activity-detail-meta">${time} · ${escapeActivityHtml(entry.monballsLeft)} Monballs left on X</p>
        ${legacyNote}
        <h4 class="activity-detail-list-title">CAUGHT MONANIMALS (${displayCount})</h4>
        ${monRows}
        ${escapedLine}`;
}

function openActivityDetail(entry, opts = {}) {
    if (!entry) return;
    const modal = ensureActivityDetailModal();
    const panel = modal.querySelector(".activity-detail-panel");
    const body = document.getElementById("activity-detail-body");
    if (panel) {
        panel.classList.toggle("activity-detail-panel--home", !!opts.homeTheme);
    }
    if (body) body.innerHTML = buildActivityDetailHtml(entry, opts);
    modal.hidden = false;
}

function closeActivityDetailModal() {
    const modal = document.getElementById("activity-detail-modal");
    if (modal) modal.hidden = true;
}

function bindActivityFeedClicks(el, entries, opts = {}) {
    if (!el || !entries) return;
    el._activityEntries = entries;
    el.querySelectorAll(".activity-item-clickable").forEach((item) => {
        const idx = parseInt(item.getAttribute("data-activity-idx"), 10);
        const open = () => {
            const entry = el._activityEntries[idx];
            if (entry) openActivityDetail(entry, opts);
        };
        item.addEventListener("click", open);
        item.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
    });
}

function bindActivityTableClicks(el, entries, opts = {}) {
    if (!el || !entries) return;
    el._activityEntries = entries;
    el.querySelectorAll(".activity-row-clickable").forEach((row) => {
        const idx = parseInt(row.getAttribute("data-activity-idx"), 10);
        const open = () => {
            const entry = el._activityEntries[idx];
            if (entry) openActivityDetail(entry, { ...opts, homeTheme: true });
        };
        row.addEventListener("click", open);
        row.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
            }
        });
    });
}

async function fetchGlobalActivity(limit, page) {
    const base = getMonexApiBase();
    const url = `${base}/api/activity?limit=${limit || 50}&page=${page || 1}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("activity fetch failed");
    return filterHiddenWildLogEntries(await res.json());
}

async function fetchPersonalActivity(username, limit, page) {
    const base = getMonexApiBase();
    const headers = getAuthHeaders();
    const params = new URLSearchParams({
        limit: String(limit || 25),
        page: String(page || 1),
    });
    if (!headers.Authorization && username) {
        params.set("username", username.replace("@", ""));
    }
    const url = `${base}/api/activity/mine?${params}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("personal activity fetch failed");
    return res.json();
}

async function fetchPendingMons(username) {
    const base = getMonexApiBase();
    const headers = getAuthHeaders();
    const url = headers.Authorization
        ? `${base}/api/pending`
        : `${base}/api/pending?username=${encodeURIComponent((username || "").replace("@", ""))}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("pending fetch failed");
    return res.json();
}

function getAuthHeaders() {
  if (window.MonExAuth?.authHeaders) return MonExAuth.authHeaders();
  const token = localStorage.getItem("monex_session_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function syncWildMons(username, partyCount, boxCount, partyMax = 3, boxMax = 500) {
    const base = getMonexApiBase();
    const body = {
        partyCount: partyCount || 0,
        boxCount: boxCount || 0,
        partyMax: partyMax || 3,
        boxMax: boxMax || 500,
    };
    if (username) body.username = username.replace("@", "");
    const res = await fetch(`${base}/api/sync`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("sync failed");
    return res.json();
}

function formatActivityTableRow(entry, rowNum, idx) {
    const time = escapeActivityHtml(new Date(entry.at).toLocaleString());
    const mons = getActivityMons(entry);
    const caught = mons.length
        ? mons.slice(0, 2).map((h) => `<span class="activity-rare">${escapeActivityHtml(h.rarity)}</span> ${escapeActivityHtml(h.name)}`).join(", ")
        : "—";
    const more = entry.caughtCount > 2 ? ` +${entry.caughtCount - 2}` : "";
    return `<tr class="activity-row activity-row-clickable" role="button" tabindex="0" data-activity-idx="${idx}">
        <td class="col-num">${rowNum}</td>
        <td class="col-time">${time}</td>
        <td class="col-user"><span class="activity-user">@${escapeActivityHtml(entry.xUsername)}</span></td>
        <td class="col-spend"><b>${escapeActivityHtml(entry.spend)}</b></td>
        <td class="col-throws">${escapeActivityHtml(entry.caughtCount)} / ${escapeActivityHtml(entry.throws)}</td>
        <td class="col-mons">${caught}${more}</td>
        <td class="col-left">${escapeActivityHtml(entry.monballsLeft)}</td>
    </tr>`;
}

function renderActivityTable(el, data, emptyMsg, opts = {}) {
    if (!el) return;
    const entries = data.entries || [];
    const page = data.page || 1;
    const limit = data.limit || 50;
    if (!entries.length) {
        el.innerHTML = `<p class="wild-log-empty">${emptyMsg}</p>`;
        return;
    }
    const startNum = (page - 1) * limit + 1;
    const rows = entries.map((e, i) => formatActivityTableRow(e, startNum + i, i)).join("");
    el.innerHTML = `<table class="wild-log-table">
        <thead>
            <tr>
                <th>#</th>
                <th>Time</th>
                <th>Trainer</th>
                <th>Monballs</th>
                <th>Caught</th>
                <th>Mons</th>
                <th>Left on X</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
    bindActivityTableClicks(el, entries, opts);
}

function buildPaginationPages(current, total) {
    if (total <= 9) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = [1, 2, 3, "..."];
    if (total >= 5) pages.push(5);
    if (total > 5) {
        if (current > 5 && current < total) {
            if (!pages.includes(current) && current !== 5) {
                pages.push(current);
            }
        }
        pages.push("...", total);
    }
    const out = [];
    pages.forEach((p) => {
        if (p === "..." && out[out.length - 1] === "...") return;
        if (typeof p === "number" && out.includes(p)) return;
        out.push(p);
    });
    return out;
}

function renderPagination(container, data, onPage) {
    if (!container) return;
    const current = data.page || 1;
    const total = data.totalPages || 1;
    const totalEntries = data.total || 0;
    if (totalEntries === 0) {
        container.innerHTML = "";
        return;
    }
    const pages = buildPaginationPages(current, total);
    const pageBtns = pages.map((p) => {
        if (p === "...") return `<span class="page-ellipsis">…</span>`;
        const active = p === current ? " active" : "";
        return `<button type="button" class="page-btn${active}" data-page="${p}">${p}</button>`;
    }).join("");
    container.innerHTML = `
        <button type="button" class="page-nav" data-page="1" ${current === 1 ? "disabled" : ""}>First</button>
        <button type="button" class="page-nav" data-page="${current - 1}" ${current === 1 ? "disabled" : ""}>Prev</button>
        ${pageBtns}
        <button type="button" class="page-nav page-last" data-page="${total}" ${current === total ? "disabled" : ""}>Last</button>
        <button type="button" class="page-nav" data-page="${current + 1}" ${current === total ? "disabled" : ""}>Next</button>
        <span class="page-info">${totalEntries} catches · page ${current} of ${total}</span>
    `;
    container.querySelectorAll("[data-page]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const next = parseInt(btn.getAttribute("data-page"), 10);
            if (!Number.isNaN(next) && next >= 1 && next <= total) onPage(next);
        });
    });
}

function renderActivityFeedElement(el, entries, emptyMsg, opts = {}) {
    if (!el) return;
    injectActivityUiStyles();
    if (!entries || entries.length === 0) {
        el.innerHTML = `<p class="activity-empty">${emptyMsg}</p>`;
        return;
    }
    el.innerHTML = entries.map((e, i) =>
        formatActivityEntryHtml(e, opts).replace('data-activity-idx="__IDX__"', `data-activity-idx="${i}"`)
    ).join("");
    bindActivityFeedClicks(el, entries, opts);
}

window.MonExActivity = {
    fetchMine: async (username, limit, page) => {
        const data = await fetchPersonalActivity(username, limit, page);
        return data.entries || [];
    },
    fetchGlobal: async (limit, page) => {
        const data = await fetchGlobalActivity(limit, page);
        return data;
    },
    renderFeed(el, entries, opts = {}) {
        renderActivityFeedElement(
            el,
            entries,
            opts.emptyText || "No activity yet.",
            opts
        );
    },
    renderTable: renderActivityTable,
    renderPagination,
    fetchPending: fetchPendingMons,
    syncWild: syncWildMons,
    openDetail: openActivityDetail,
    closeDetail: closeActivityDetailModal,
    PAGE_SIZE: 50,
};
