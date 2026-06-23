/** Shared X activity feed client for home + game profile */

/** Live activity API (Railway). Override with window.MONEX_API if needed. */
const MONEX_API_PRODUCTION = "https://monex-production-fe34.up.railway.app";

function getMonexApiBase() {
    if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
        if (location.port === "3001") return "";
        return `http://${host}:3001`;
    }
    // Game served from same Railway deploy — API is same origin
    if (host.endsWith(".up.railway.app")) return "";
    return MONEX_API_PRODUCTION;
}

function formatActivityEntryHtml(entry, opts = {}) {
    const showUser = opts.showUser !== false;
    const time = new Date(entry.at).toLocaleString();
    const caught = entry.highlights && entry.highlights.length
        ? entry.highlights.map((h) => `<span class="activity-rare">${h.rarity}</span> ${h.name}`).join(", ")
        : "no catches";
    const userPart = showUser ? `<span class="activity-user">@${entry.xUsername}</span> ` : "";
    return `<div class="activity-item">
        ${userPart}spent <b>${entry.spend}</b> Monballs → <b>${entry.caughtCount}/${entry.throws}</b> caught
        <div>${caught}</div>
        <div class="activity-meta">${time} · ${entry.monballsLeft} Monballs left on X</div>
    </div>`;
}

async function fetchGlobalActivity(limit, page) {
    const base = getMonexApiBase();
    const url = `${base}/api/activity?limit=${limit || 50}&page=${page || 1}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("activity fetch failed");
    return res.json();
}

async function fetchPersonalActivity(username, limit, page) {
    const base = getMonexApiBase();
    const u = encodeURIComponent(username.replace("@", ""));
    const url = `${base}/api/activity/mine?username=${u}&limit=${limit || 25}&page=${page || 1}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("personal activity fetch failed");
    return res.json();
}

async function fetchPendingMons(username) {
    const base = getMonexApiBase();
    const u = encodeURIComponent(username.replace("@", ""));
    const res = await fetch(`${base}/api/pending?username=${u}`);
    if (!res.ok) throw new Error("pending fetch failed");
    return res.json();
}

async function claimPendingMons(username) {
    const base = getMonexApiBase();
    const res = await fetch(`${base}/api/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.replace("@", "") }),
    });
    if (!res.ok) throw new Error("claim failed");
    return res.json();
}

function formatActivityTableRow(entry, rowNum) {
    const time = new Date(entry.at).toLocaleString();
    const caught = entry.highlights && entry.highlights.length
        ? entry.highlights.map((h) => `<span class="activity-rare">${h.rarity}</span> ${h.name}`).join(", ")
        : "—";
    return `<tr class="activity-row">
        <td class="col-num">${rowNum}</td>
        <td class="col-time">${time}</td>
        <td class="col-user"><span class="activity-user">@${entry.xUsername}</span></td>
        <td class="col-spend"><b>${entry.spend}</b></td>
        <td class="col-throws">${entry.caughtCount} / ${entry.throws}</td>
        <td class="col-mons">${caught}</td>
        <td class="col-left">${entry.monballsLeft}</td>
    </tr>`;
}

function renderActivityTable(el, data, emptyMsg) {
    if (!el) return;
    const entries = data.entries || [];
    const page = data.page || 1;
    const limit = data.limit || 50;
    if (!entries.length) {
        el.innerHTML = `<p class="wild-log-empty">${emptyMsg}</p>`;
        return;
    }
    const startNum = (page - 1) * limit + 1;
    const rows = entries.map((e, i) => formatActivityTableRow(e, startNum + i)).join("");
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
    if (!entries || entries.length === 0) {
        el.innerHTML = `<p style="color:#888;font-size:11px;">${emptyMsg}</p>`;
        return;
    }
    el.innerHTML = entries.map((e) => formatActivityEntryHtml(e, opts)).join("");
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
    claimPending: claimPendingMons,
    PAGE_SIZE: 50,
};
