/** Shared X activity feed client for home + game profile */

function getMonexApiBase() {
    if (window.MONEX_API) return window.MONEX_API.replace(/\/$/, "");
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
        if (location.port === "3001") return "";
        return `http://${host}:3001`;
    }
    return "";
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

async function fetchGlobalActivity(limit) {
    const base = getMonexApiBase();
    const url = `${base}/api/activity?limit=${limit || 25}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("activity fetch failed");
    return res.json();
}

async function fetchPersonalActivity(username, limit) {
    const base = getMonexApiBase();
    const u = encodeURIComponent(username.replace("@", ""));
    const url = `${base}/api/activity/mine?username=${u}&limit=${limit || 25}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("personal activity fetch failed");
    return res.json();
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
    fetchMine: async (username, limit) => {
        const data = await fetchPersonalActivity(username, limit);
        return data.entries || [];
    },
    fetchGlobal: async (limit) => {
        const data = await fetchGlobalActivity(limit);
        return data.entries || [];
    },
    renderFeed(el, entries, opts = {}) {
        renderActivityFeedElement(
            el,
            entries,
            opts.emptyText || "No activity yet.",
            opts
        );
    },
};
