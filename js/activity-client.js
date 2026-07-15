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
.activity-detail-panel--home.activity-detail-panel--wide {
    width: min(960px, 96vw);
}
.activity-detail-panel--game.activity-detail-panel--wide {
    width: min(920px, 96vw);
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
.wild-log-table .col-mons {
    min-width: 220px;
    vertical-align: middle;
}
.wild-log-table td {
    vertical-align: middle;
}
.wild-log-table .col-num,
.wild-log-table .col-time,
.wild-log-table .col-user,
.wild-log-table .col-catch,
.wild-log-table .col-left {
    vertical-align: middle;
}
.wild-log-catch-ok { font-weight: 700; color: #166534; }
.wild-log-catch-miss { font-weight: 700; color: #991b1b; }
.wild-log-catch-partial { font-weight: 700; color: #1e3a8a; }
.wild-log-catch-spend { color: rgba(61, 26, 8, 0.75); font-weight: 600; }
.wild-log-catch-escaped { color: rgba(61, 26, 8, 0.65); font-size: 11px; font-weight: 600; }
.wild-log-balance { font-weight: 700; color: #6B21A8; white-space: nowrap; }
.wild-log-mini-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
}
.wild-log-table .col-mons .activity-mon-card--mini {
    flex-shrink: 0;
}
.wild-log-table .col-mons .activity-mon-card--mini img {
    max-width: 34px;
    max-height: 34px;
    width: 34px;
    height: 34px;
}
.wild-log-mini-more {
    display: inline-flex;
    align-items: center;
    font-size: 9px;
    color: #6B21A8;
    font-weight: 700;
    padding: 4px 6px;
    white-space: nowrap;
}
.activity-mon-card {
    background: #fff;
    border: 3px solid #111;
    box-shadow: 3px 3px 0 #111;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
}
.activity-mon-card.rarity-common { border-color: #111; box-shadow: 3px 3px 0 #111; }
.activity-mon-card.rarity-uncommon { border-color: #16a34a; box-shadow: 3px 3px 0 #16a34a; }
.activity-mon-card.rarity-rare { border-color: #2563eb; box-shadow: 3px 3px 0 #2563eb; }
.activity-mon-card.rarity-legendary { border-color: #ca8a04; box-shadow: 3px 3px 0 #ca8a04; }
.activity-mon-card.rarity-mythic { border-color: #9f1239; box-shadow: 3px 3px 0 #9f1239; }
.activity-mon-card--mini {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 108px;
    min-width: 108px;
    padding: 5px 6px;
}
.activity-mon-card--mini .activity-mon-sprite {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}
.activity-mon-card--mini .activity-mon-sprite img {
    width: 34px;
    height: 34px;
    object-fit: contain;
    object-position: center bottom;
    image-rendering: pixelated;
    display: block;
}
.activity-mon-card--mini .activity-mon-identity {
    min-width: 0;
    flex: 1;
}
.activity-mon-card--mini .activity-mon-name {
    font-family: "Press Start 2P", monospace;
    font-size: 6px;
    line-height: 1.35;
    margin: 0 0 3px;
    word-break: break-word;
}
.activity-mon-card--mini .activity-mon-rarity {
    display: inline-block;
    font-size: 6px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 10px;
    color: #fff;
    text-transform: uppercase;
    line-height: 1.2;
}
.activity-mon-card--box {
    padding: 8px;
    min-width: 0;
    overflow: visible;
}
.activity-mon-card-chrome {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 4px;
    min-height: 18px;
}
.activity-mon-card-chrome .activity-house-icon {
    width: 16px;
    height: 16px;
    object-fit: contain;
    image-rendering: pixelated;
}
.activity-mon-card-top {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.activity-mon-card--box .activity-mon-sprite {
    width: 100%;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 6px;
}
.activity-mon-card--box .activity-mon-sprite img {
    width: 64px;
    height: 64px;
    max-width: 64px;
    max-height: 64px;
    object-fit: contain;
    object-position: center bottom;
    image-rendering: pixelated;
    display: block;
}
.activity-mon-sprite.mon-sprite--legendary-static {
    position: relative;
}
.activity-mon-sprite.mon-sprite--legendary-static::after {
    content: "";
    position: absolute;
    inset: 2px;
    border-radius: 4px;
    pointer-events: none;
    box-shadow: inset 0 0 10px rgba(202, 138, 4, 0.4);
    animation: activity-legendary-static-shimmer 2.4s ease-in-out infinite;
}
.activity-mon-sprite.mon-sprite--legendary-static.mon-sprite--mythic::after {
    box-shadow: inset 0 0 10px rgba(159, 18, 57, 0.45);
}
@keyframes activity-legendary-static-shimmer {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
}
.activity-mon-card--box .activity-mon-name {
    font-family: "Press Start 2P", monospace;
    font-size: 7px;
    line-height: 1.4;
    text-align: center;
    margin: 0 0 6px;
    text-transform: uppercase;
}
.activity-mon-card--box .activity-mon-rarity-row {
    display: flex;
    justify-content: center;
    margin-bottom: 6px;
}
.activity-mon-card--box .activity-mon-rarity {
    display: inline-block;
    font-size: 7px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;
    color: #fff;
    text-transform: uppercase;
}
.activity-mon-rarity.rarity-common,
.activity-mon-card--mini .activity-mon-rarity.rarity-common { background: #111; }
.activity-mon-rarity.rarity-uncommon,
.activity-mon-card--mini .activity-mon-rarity.rarity-uncommon { background: #16a34a; }
.activity-mon-rarity.rarity-rare,
.activity-mon-card--mini .activity-mon-rarity.rarity-rare { background: #2563eb; }
.activity-mon-rarity.rarity-legendary,
.activity-mon-card--mini .activity-mon-rarity.rarity-legendary { background: #ca8a04; }
.activity-mon-rarity.rarity-mythic,
.activity-mon-card--mini .activity-mon-rarity.rarity-mythic { background: #9f1239; }
.activity-skills-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: center;
    align-items: center;
    width: 100%;
    margin-top: 4px;
}
.activity-skills-grid .activity-skill-square {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    border: 2px solid #8b4513;
    background: linear-gradient(145deg, #a85a2a, #6b3518);
    box-shadow: 1px 1px 0 #3d2010;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    cursor: help;
    overflow: visible;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
    box-sizing: border-box;
}
.activity-skills-grid .activity-skill-square.skill-ult {
    background: linear-gradient(145deg, #fde68a, #f59e0b);
    border-color: #b45309;
    color: #7c2d12;
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.55), 1px 1px 0 #92400e;
}
.activity-skills-grid .activity-skill-square.skill-passive {
    background: linear-gradient(145deg, #94a3b8, #64748b);
    border-color: #475569;
    border-style: dashed;
    color: #f8fafc;
    box-shadow: 1px 1px 0 #334155;
}
.activity-skills-grid .activity-skill-square.skill-active {
    background: linear-gradient(145deg, #c084fc, #7c3aed);
    border-color: #6b21a8;
    box-shadow: 1px 1px 0 #4c1d95;
}
.activity-skills-grid .activity-skill-square:hover {
    transform: scale(1.15);
    z-index: 20;
    box-shadow: 2px 2px 0 #4c1d95;
}
.activity-skills-grid .activity-skill-square.skill-ult:hover {
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.65), 2px 2px 0 #92400e;
}
.activity-skills-grid .activity-skill-square .skill-icon-img {
    width: 16px;
    height: 16px;
    max-width: 88%;
    max-height: 88%;
    object-fit: contain;
    image-rendering: pixelated;
    display: block;
    pointer-events: none;
}
.activity-skills-grid .activity-skill-square .skill-icon-fallback {
    font-family: "Press Start 2P", monospace;
    font-size: 7px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    pointer-events: none;
}
.activity-skills-grid .activity-skill-square .skill-tip {
    display: none;
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    color: #e0e0ff;
    padding: 7px 10px;
    font-family: "Lato", system-ui, sans-serif;
    white-space: normal;
    width: max-content;
    max-width: 200px;
    text-align: left;
    line-height: 1.35;
    box-shadow: 3px 3px 0 #6b21a8;
    border: 2px solid #6b21a8;
    z-index: 999;
    pointer-events: none;
}
.activity-skills-grid .activity-skill-square:hover .skill-tip {
    display: block;
}
.activity-skills-grid .skill-tip-name {
    font-family: "Press Start 2P", monospace;
    font-size: 7px;
    color: #f5f3ff;
    line-height: 1.4;
}
.activity-wild-log-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
}
@media (max-width: 900px) {
    .activity-wild-log-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
@media (max-width: 560px) {
    .activity-wild-log-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .wild-log-mini-cards { max-width: 230px; }
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

const ACTIVITY_SPECIES_HOUSE = {
    Chog: "chog",
    Mouch: "chog",
    Anago: "chog",
    Shramp: "chog",
    Spidermon: "chog",
    Molandak: "molandak",
    Lyraffe: "molandak",
    Pampam: "molandak",
    Montiger: "molandak",
    Mokadal: "molandak",
    Monavara: "molandak",
    Moyaki: "moyaki",
    Salmonad: "moyaki",
    Moncock: "moyaki",
    Monhorse: "moyaki",
    Moxy: "moyaki",
    Larvanad: "moyaki",
    Mosferatu: "moyaki",
};

const ACTIVITY_HOUSE_ICONS = {
    chog: "game_icons/house/chogicon.png",
    molandak: "game_icons/house/molandakicon.png",
    moyaki: "game_icons/house/moyakiicon.png",
};

const ACTIVITY_MON_DISPLAY_NAMES = { Moxy: "Monhorse", Mondigrade: "Pampam" };

function getActivityMonDisplayName(name) {
    return ACTIVITY_MON_DISPLAY_NAMES[name] || name;
}

function getActivityRarityClass(rarity) {
    return "rarity-" + String(rarity || "Common").toLowerCase();
}

function getActivityMonSprite(mon) {
    const m = mon && typeof mon === "object" ? mon : { name: mon };
    const api = typeof window !== "undefined" ? window.MonExMonSprites : null;
    if (api?.getMonDisplaySpritePath) return api.getMonDisplaySpritePath(m);
    const display = getActivityMonDisplayName(m.name);
    return `128x128/${String(display).toLowerCase()}.png`;
}

function getActivityMonSpriteFallback(mon) {
    const m = mon && typeof mon === "object" ? mon : { name: mon };
    const api = typeof window !== "undefined" ? window.MonExMonSprites : null;
    if (api?.getMonDisplayFallbackPath) return api.getMonDisplayFallbackPath(m);
    const display = getActivityMonDisplayName(m.name);
    return `128x128/${String(display).toLowerCase()}.png`;
}

function getActivityMonSpriteClass(mon) {
    const api = typeof window !== "undefined" ? window.MonExMonSprites : null;
    if (api?.getMonSpriteExtraClass) return api.getMonSpriteExtraClass(mon);
    return "";
}

function getActivityHouseIcon(name) {
    const display = getActivityMonDisplayName(name);
    const houseId = ACTIVITY_SPECIES_HOUSE[display] || ACTIVITY_SPECIES_HOUSE[name];
    return houseId ? ACTIVITY_HOUSE_ICONS[houseId] : null;
}

function parseActivitySkills(skillsStr) {
    if (!skillsStr) return [];
    return String(skillsStr)
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label) => ({
            label,
            isUlt: label.startsWith("★"),
            isPassive: label.startsWith("P:"),
        }));
}

const ACTIVITY_SKILL_ICON_DIR = "game_icons/skill/";
const ACTIVITY_SKILL_ICON_MAP = {
    "Slash": "slash.png",
    "Flame Burst": "flame-burst.png",
    "Aqua Jet": "aqua-jet.png",
    "Shock Bolt": "shock-bolt.png",
    "Rock Throw": "rock-throw.png",
    "Venom Bite": "venom-bite.png",
    "Frost Shard": "frost-shard.png",
    "Gale Slash": "gale-slash.png",
    "Shadow Strike": "shadow-strike.png",
    "Psy Beam": "psy-beam.png",
    "Holy Palm": "holy-palm.png",
    "Starfall Palm": "starfall-palm.png",
    "Star Swipe": "star-swipe.png",
    "Power Fist": "power-fist.png",
    "Ember Flask": "ember-flask.png",
    "Star Hammer": "star-hammer.png",
    "Crushing Hammer": "crushing-hammer.png",
    "Solar Vortex": "solar-vortex.png",
    "Flash Burst": "flash-burst.png",
    "Divine Gaze": "divine-gaze.png",
    "Force Palm": "force-palm.png",
    "Radiant Aura": "radiant-aura.png",
    "Verdant Canopy": "verdant-canopy.png",
    "Volt Seed": "volt-seed.png",
    "Divine Pillars": "divine-pillars.png",
    "Radiant Strike": "radiant-strike.png",
    "Void Monolith": "void-monolith.png",
    "Holy Blade": "holy-blade.png",
    "Arc Lightning": "arc-lightning.png",
    "Mending Rain": "mending-rain.png",
    "Spirit Beam": "spirit-beam.png",
    "Cleanse": "sacred-word.png",
    "Arcane Blast": "arcane-blast.png",
    "Mend": "mend.png",
    "Renew": "renew.png",
    "Life Bloom": "life-bloom.png",
    "Tough Hide": "tough-hide.png",
    "Sharp Claws": "sharp-claws.png",
    "Critical Instinct": "critical-instinct.png",
    "Evasive": "evasive.png",
    "Bulwark": "bulwark.png",
    "Regenerator": "regenerator.png",
    "Static Aegis": "static-aegis.png",
    "Shield Stance": "shield-stance.png",
    "Storm Guard": "storm-guard.png",
    "Emerald Ward": "emerald-ward.png",
    "Iron Will": "iron-will.png",
    "Mystic Sigil": "mystic-sigil.png",
    "Eagle Eye": "eagle-eye.png",
    "Piercing Gaze": "piercing-gaze.png",
    "Swift Feet": "swift-feet.png",
    "Apex Roar": "montiger.png",
    "Void Pulse": "monavara.png",
    "Crimson Spur": "moncock.png",
    "Venom Bloom": "larvanad.png",
    "Frost Nova": "molandak.png",
    "Mind Crush": "mokadal.png",
    "Abyssal Coil": "anago.png",
    "Seismic Shell": "pampam.png",
    "Croak Quake": "chog.png",
    "Bubble Barrage": "shramp.png",
    "Gale Stampede": "lyraffe.png",
    "Static Swarm": "mouch.png",
    "Shock Nova": "monhorse.png",
    "Tidal Crash": "salmonad.png",
    "Flame Geyser": "moyaki.png",
    "Web Cataclysm": "spidermon.png",
    "Blood Moon": "mosferatu.png",
};
const ACTIVITY_SKILL_NAME_KEYS = Object.keys(ACTIVITY_SKILL_ICON_MAP);

function resolveActivitySkillName(shortOrFull) {
    const s = String(shortOrFull || "").trim();
    if (!s) return s;
    if (ACTIVITY_SKILL_ICON_MAP[s]) return s;
    const lower = s.toLowerCase();
    const match = ACTIVITY_SKILL_NAME_KEYS.find(
        (k) => k.toLowerCase() === lower || k.toLowerCase().startsWith(lower)
    );
    return match || s;
}

function parseActivitySkillObjects(skillsStr) {
    return parseActivitySkills(skillsStr).map((entry) => {
        if (entry.isUlt) {
            return { type: "ultimate", name: entry.label.slice(1).trim() };
        }
        if (entry.isPassive) {
            return {
                type: "passive",
                name: resolveActivitySkillName(entry.label.slice(2).trim()),
            };
        }
        return { type: "active", name: resolveActivitySkillName(entry.label) };
    });
}

function getActivitySkillIconPath(skill) {
    if (!skill) return null;
    const mapped = ACTIVITY_SKILL_ICON_MAP[skill.name];
    if (mapped) return ACTIVITY_SKILL_ICON_DIR + mapped;
    if (skill.type === "ultimate") return null;
    if (skill.type === "passive") return ACTIVITY_SKILL_ICON_DIR + "tough-hide.png";
    return ACTIVITY_SKILL_ICON_DIR + "slash.png";
}

function getActivitySkillSquareClass(skill) {
    if (skill.type === "ultimate") return "skill-ult";
    if (skill.type === "passive") return "skill-passive";
    return "skill-active";
}

function renderActivitySkillIcon(skill) {
    const path = getActivitySkillIconPath(skill);
    const fb = skill.type === "ultimate" ? "★" : skill.type === "passive" ? "P" : skill.name.substring(0, 2).toUpperCase();
    if (!path) return `<span class="skill-icon-fallback">${escapeActivityHtml(fb)}</span>`;
    const fbEsc = escapeActivityHtml(fb);
    return `<img class="skill-icon-img" src="${escapeActivityHtml(path)}" alt="" onerror="this.outerHTML='<span class=\\'skill-icon-fallback\\'>${fbEsc}</span>'">`;
}

function renderActivitySkillTip(skill) {
    return `<div class="skill-tip">
        <div class="skill-tip-name">${escapeActivityHtml(skill.name)}</div>
    </div>`;
}

function buildActivitySkillIconsHtml(skillsStr) {
    const skills = parseActivitySkillObjects(skillsStr);
    if (!skills.length) return "";
    return `<div class="activity-skills-grid">${skills.map((skill) =>
        `<div class="activity-skill-square ${getActivitySkillSquareClass(skill)}" tabindex="0">
            ${renderActivitySkillIcon(skill)}
            ${renderActivitySkillTip(skill)}
        </div>`
    ).join("")}</div>`;
}

function buildActivityMonCardHtml(mon, mode) {
    if (!mon) return "";
    const name = getActivityMonDisplayName(mon.name);
    const rarity = mon.rarity || "Common";
    const rarityClass = getActivityRarityClass(rarity);
    const spriteClass = getActivityMonSpriteClass(mon);
    const houseIcon = getActivityHouseIcon(mon.name);
    const sprite = getActivityMonSprite(mon);
    const avatarAttrs = `data-mon-avatar="1" data-mon-name="${escapeActivityHtml(mon.name || "")}" data-mon-rarity="${escapeActivityHtml(rarity)}" decoding="async"`;

    if (mode === "mini") {
        return `<div class="activity-mon-card activity-mon-card--mini ${rarityClass}" aria-hidden="true">
            <div class="activity-mon-sprite ${spriteClass}">
                <img ${avatarAttrs} src="${escapeActivityHtml(sprite)}" alt="" loading="lazy">
            </div>
            <div class="activity-mon-identity">
                <div class="activity-mon-name">${escapeActivityHtml(name)}</div>
                <span class="activity-mon-rarity ${rarityClass}">${escapeActivityHtml(rarity)}</span>
            </div>
        </div>`;
    }

    const houseHtml = houseIcon
        ? `<div class="activity-mon-card-chrome"><img class="activity-house-icon" src="${escapeActivityHtml(houseIcon)}" alt=""></div>`
        : `<div class="activity-mon-card-chrome"></div>`;

    return `<div class="activity-mon-card activity-mon-card--box ${rarityClass}">
        ${houseHtml}
        <div class="activity-mon-card-top">
            <div class="activity-mon-sprite ${spriteClass}">
                <img ${avatarAttrs} src="${escapeActivityHtml(sprite)}" alt="${escapeActivityHtml(name)}" loading="lazy">
            </div>
            <div class="activity-mon-name">${escapeActivityHtml(name)}</div>
            <div class="activity-mon-rarity-row">
                <span class="activity-mon-rarity ${rarityClass}">${escapeActivityHtml(String(rarity).toUpperCase())}</span>
            </div>
            ${buildActivitySkillIconsHtml(mon.skills)}
        </div>
    </div>`;
}

function buildWildLogMiniCardsHtml(mons, totalCaught) {
    if (!mons || !mons.length) return "—";
    const shown = mons.slice(0, 2);
    const cards = shown.map((m) => buildActivityMonCardHtml(m, "mini")).join("");
    const total = Number.isFinite(totalCaught) ? totalCaught : mons.length;
    const more = total > 2 ? `<span class="wild-log-mini-more">+${total - 2} more</span>` : "";
    return `<div class="wild-log-mini-cards">${cards}${more}</div>`;
}

function describeWildLogCatch(entry) {
    const spend = Math.max(0, Number(entry.spend) || 0);
    const caught = Math.max(0, Number(entry.caughtCount) || 0);
    const throws = Math.max(0, Number(entry.throws) || spend || 0);
    const escaped = Math.max(0, Number(entry.escapedCount) || Math.max(0, throws - caught));

    if (throws <= 1) return caught === 0 ? "0 caught" : "1 caught";
    if (caught === throws) return `${caught} caught`;
    const escapedPart = escaped ? ` (${escaped} escaped)` : "";
    return spend ? `${spend} Monballs · ${caught}/${throws} caught${escapedPart}` : `${caught}/${throws} caught${escapedPart}`;
}

function describeWildLogBalance(entry) {
    const after = Number(entry.monballsLeft);
    if (Number.isFinite(after)) return String(after);
    return "—";
}

function formatWildLogCatchCell(entry) {
    const spend = Math.max(0, Number(entry.spend) || 0);
    const caught = Math.max(0, Number(entry.caughtCount) || 0);
    const throws = Math.max(0, Number(entry.throws) || spend || 0);
    const escaped = Math.max(0, Number(entry.escapedCount) || Math.max(0, throws - caught));

    if (throws <= 1) {
        if (caught === 0) return `<span class="wild-log-catch-miss">0 caught</span>`;
        return `<span class="wild-log-catch-ok">1 caught</span>`;
    }
    if (caught === throws) {
        return `<span class="wild-log-catch-ok">${escapeActivityHtml(String(caught))} caught</span>`;
    }
    const spendPart = spend
        ? `<span class="wild-log-catch-spend">${escapeActivityHtml(String(spend))} Monballs</span> · `
        : "";
    const escapedPart = escaped
        ? ` <span class="wild-log-catch-escaped">(${escapeActivityHtml(String(escaped))} escaped)</span>`
        : "";
    return `${spendPart}<span class="wild-log-catch-partial">${escapeActivityHtml(String(caught))}/${escapeActivityHtml(String(throws))} caught</span>${escapedPart}`;
}

function formatWildLogMonballsLeftCell(entry) {
    const text = describeWildLogBalance(entry);
    return `<span class="wild-log-balance">${escapeActivityHtml(text)}</span>`;
}

function formatActivityEntryHtml(entry, opts = {}) {
    const showUser = opts.showUser !== false;
    const time = escapeActivityHtml(new Date(entry.at).toLocaleString());
    const mons = getActivityMons(entry);
    const caught = mons.length
        ? mons.slice(0, 3).map((h) => `<span class="activity-rare">${escapeActivityHtml(h.rarity)}</span> ${escapeActivityHtml(h.name)}`).join(", ")
        : "no catches";
    const more = entry.caughtCount > 3 ? ` +${entry.caughtCount - 3} more` : "";
    const userPart = showUser ? `<span class="activity-user">@${escapeActivityHtml(entry.xUsername)}</span> · ` : "";
    return `<div class="activity-item activity-item-clickable" role="button" tabindex="0" data-activity-idx="__IDX__">
        ${userPart}${escapeActivityHtml(describeWildLogCatch(entry))}
        <div>${caught}${more}</div>
        <div class="activity-meta">${time} · ${escapeActivityHtml(describeWildLogBalance(entry))} Monballs left on X · tap for full log</div>
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
        ? `<div class="activity-wild-log-grid">${mons.map((m) => buildActivityMonCardHtml(m, "box")).join("")}</div>`
        : `<p class="activity-detail-note">No catches recorded for this session.</p>`;
    const legacyNote = !hasFullList && entry.caughtCount > displayCount
        ? `<p class="activity-detail-note">Older log — showing preview only (${displayCount} of ${entry.caughtCount} shown).</p>`
        : "";
    const escapedLine = entry.escapedCount > 0
        ? `<div class="activity-detail-escaped">${entry.escapedCount} Monanimal${entry.escapedCount === 1 ? "" : "s"} escaped.</div>`
        : "";
    return `
        <h3 class="activity-detail-title" id="activity-detail-title">CATCH SESSION</h3>
        <p class="activity-detail-summary">${userLine}${escapeActivityHtml(describeWildLogCatch(entry))}</p>
        <p class="activity-detail-meta">${time} · ${escapeActivityHtml(describeWildLogBalance(entry))} Monballs left on X</p>
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
        panel.classList.toggle("activity-detail-panel--game", !!opts.gameTheme);
        panel.classList.toggle("activity-detail-panel--wide", !!(opts.wideDetail || opts.homeTheme || opts.gameTheme));
    }
    if (body) {
        body.innerHTML = buildActivityDetailHtml(entry, opts);
        bindActivityMonAvatarImages(body);
    }
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

async function fetchPersonalReleases(limit, page) {
    const base = getMonexApiBase();
    const headers = getAuthHeaders();
    const params = new URLSearchParams({
        limit: String(limit || 30),
        page: String(page || 1),
    });
    const url = `${base}/api/releases/mine?${params}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error("personal release fetch failed");
    return res.json();
}

function formatReleaseRewardLine(entry) {
    const parts = [];
    if (entry.gold > 0) parts.push(`+${entry.gold} Gold`);
    if (entry.essence > 0) parts.push(`+${entry.essence} KB's Onion`);
    if (entry.shards > 0) parts.push(`+${entry.shards} Mon Shard${entry.shards === 1 ? "" : "s"}`);
    return parts.length ? parts.join(" · ") : "No salvage rewards";
}

function formatReleaseEntryHtml(entry) {
    const time = escapeActivityHtml(new Date(entry.at).toLocaleString());
    const displayName = getActivityMonDisplayName(entry.name);
    const rarity = escapeActivityHtml(entry.rarity || "Common");
    const level = escapeActivityHtml(entry.level || 1);
    const source = entry.source === "party" ? "Party" : "Box";
    const rewards = escapeActivityHtml(formatReleaseRewardLine(entry));
    return `<div class="activity-item">
        <span class="activity-rare">${rarity}</span> <b>${escapeActivityHtml(displayName)}</b> Lv.${level}
        <div class="profile-release-rewards">${rewards}</div>
        <div class="activity-meta">${time} · released from ${escapeActivityHtml(source)}</div>
    </div>`;
}

function renderReleaseFeedElement(el, entries, emptyMsg) {
    if (!el) return;
    injectActivityUiStyles();
    if (!entries || entries.length === 0) {
        el.innerHTML = `<p class="activity-empty">${emptyMsg}</p>`;
        return;
    }
    el.innerHTML = entries.map((entry) => formatReleaseEntryHtml(entry)).join("");
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
    if (window.MonExGameSession?.isGameplayAllowed && !window.MonExGameSession.isGameplayAllowed()) {
        throw new Error("game_session_inactive");
    }
    const body = {
        partyCount: partyCount || 0,
        boxCount: boxCount || 0,
        partyMax: partyMax || 3,
        boxMax: boxMax || 500,
    };
    if (username) body.username = username.replace("@", "");
    if (window.MonExGameSession?.getGameSessionId) {
        body.gameSessionId = window.MonExGameSession.getGameSessionId();
    }
    const res = await fetch(`${base}/api/sync`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
    });
    if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "game_session_inactive" || data.error === "game_session_required") {
            window.MonExGameSession?.handleInactiveFromApi?.();
            throw new Error(data.error || "game_session_inactive");
        }
    }
    if (!res.ok) throw new Error("sync failed");
    return res.json();
}

function formatActivityTableRow(entry, rowNum, idx) {
    const time = escapeActivityHtml(new Date(entry.at).toLocaleString());
    const mons = getActivityMons(entry);
    const monsCell = buildWildLogMiniCardsHtml(mons, entry.caughtCount);
    return `<tr class="activity-row activity-row-clickable" role="button" tabindex="0" data-activity-idx="${idx}">
        <td class="col-num">${rowNum}</td>
        <td class="col-time">${time}</td>
        <td class="col-user"><span class="activity-user">@${escapeActivityHtml(entry.xUsername)}</span></td>
        <td class="col-catch">${formatWildLogCatchCell(entry)}</td>
        <td class="col-mons">${monsCell}</td>
        <td class="col-left">${formatWildLogMonballsLeftCell(entry)}</td>
    </tr>`;
}

function renderActivityTable(el, data, emptyMsg, opts = {}) {
    if (!el) return;
    injectActivityUiStyles();
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
                <th>Catch</th>
                <th>Mons</th>
                <th>Monballs left</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
    bindActivityMonAvatarImages(el);
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

function bindActivityMonAvatarImages(root) {
    const scope = root || document;
    const api = typeof window !== "undefined" ? window.MonExMonSprites : null;
    scope.querySelectorAll("img[data-mon-avatar]").forEach((img) => {
        const mon = { name: img.dataset.monName, rarity: img.dataset.monRarity || undefined };
        if (api?.bindMonAvatarImg) {
            api.bindMonAvatarImg(img, mon);
            return;
        }
        img.src = getActivityMonSprite(mon);
        img.onerror = () => {
            img.onerror = null;
            img.src = getActivityMonSpriteFallback(mon);
        };
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
    bindActivityMonAvatarImages(el);
    bindActivityFeedClicks(el, entries, opts);
}

window.MonExActivity = {
    fetchMine: async (username, limit, page) => {
        const data = await fetchPersonalActivity(username, limit, page);
        return data.entries || [];
    },
    fetchReleases: async (limit, page) => {
        return fetchPersonalReleases(limit, page);
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
    renderReleaseFeed(el, entries, opts = {}) {
        renderReleaseFeedElement(
            el,
            entries,
            opts.emptyText || "No releases yet.",
        );
    },
    renderTable: renderActivityTable,
    renderPagination,
    fetchPending: fetchPendingMons,
    syncWild: syncWildMons,
    openDetail: openActivityDetail,
    closeDetail: closeActivityDetailModal,
    ensureUiStyles: injectActivityUiStyles,
    PAGE_SIZE: 50,
};

injectActivityUiStyles();
