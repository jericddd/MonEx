import { CATCH_CARD_FONT_FAMILY } from "./catch-card-font.js";

const CANVAS_W = 900;
const CANVAS_H = 520;
const CARD_W = 300;
const CARD_H = 400;
const CARD_X = (CANVAS_W - CARD_W) / 2;
const CARD_Y = (CANVAS_H - CARD_H) / 2;
const FONT = CATCH_CARD_FONT_FAMILY;

const RARITY_STYLES = {
  Common: { border: "#111111", badge: "#111111", badgeText: "#ffffff" },
  Uncommon: { border: "#16a34a", badge: "#16a34a", badgeText: "#ffffff" },
  Rare: { border: "#2563eb", badge: "#2563eb", badgeText: "#ffffff" },
  Legendary: { border: "#ca8a04", badge: "#ca8a04", badgeText: "#111111" },
  Mythic: { border: "#9f1239", badge: "#9f1239", badgeText: "#ffffff" },
};

const MON_DISPLAY_NAMES = { Moxy: "Monhorse" };

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getMonDisplayName(name) {
  return MON_DISPLAY_NAMES[name] || name;
}

function getRarityStyle(rarity) {
  return RARITY_STYLES[rarity] || RARITY_STYLES.Common;
}

function buildSkillTilesSvg(tiles) {
  if (!tiles?.length) return "";
  const size = 34;
  const gap = 8;
  const iconSize = 22;
  const totalW = tiles.length * size + (tiles.length - 1) * gap;
  const startX = CARD_X + (CARD_W - totalW) / 2;
  const y = CARD_Y + 306;

  return tiles
    .map((tile, index) => {
      const x = startX + index * (size + gap);
      const iconX = x + (size - iconSize) / 2;
      const iconY = y + (size - iconSize) / 2;
      let inner = "";
      if (tile.iconDataUri) {
        inner = `<image href="${tile.iconDataUri}" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" preserveAspectRatio="xMidYMid meet"/>`;
      } else if (tile.label) {
        inner = `<text x="${x + size / 2}" y="${y + size / 2 + 6}" text-anchor="middle" fill="#ffffff" font-size="14" font-family="${FONT}" font-weight="700">${escapeXml(tile.label)}</text>`;
      }
      return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${tile.fill}" stroke="#111111" stroke-width="2"/>${inner}`;
    })
    .join("");
}

export function buildCatchCardSvg(mon, spriteDataUri, skillTiles = []) {
  const name = getMonDisplayName(mon.name);
  const rarity = mon.rarity || "Common";
  const style = getRarityStyle(rarity);
  const level = Math.floor(mon.level || 1);
  const shadowX = CARD_X + 8;
  const shadowY = CARD_Y + 8;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2a1448"/>
      <stop offset="100%" stop-color="#120a22"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" rx="24" fill="url(#bg)"/>
  <rect x="18" y="18" width="${CANVAS_W - 36}" height="${CANVAS_H - 36}" rx="18" fill="none" stroke="#6b21a8" stroke-width="4" opacity="0.85"/>
  <rect x="28" y="28" width="${CANVAS_W - 56}" height="${CANVAS_H - 56}" rx="14" fill="none" stroke="#a855f7" stroke-width="2" opacity="0.35"/>
  <rect x="${shadowX}" y="${shadowY}" width="${CARD_W}" height="${CARD_H}" fill="${style.border}" opacity="0.95"/>
  <rect x="${CARD_X}" y="${CARD_Y}" width="${CARD_W}" height="${CARD_H}" fill="#ffffff" stroke="${style.border}" stroke-width="8"/>
  <rect x="${CARD_X + 14}" y="${CARD_Y + 14}" width="${CARD_W - 28}" height="168" fill="#f8f5ff"/>
  <image href="${spriteDataUri}" x="${CARD_X + (CARD_W - 128) / 2}" y="${CARD_Y + 28}" width="128" height="128" preserveAspectRatio="xMidYMid meet"/>
  <text x="${CARD_X + CARD_W / 2}" y="${CARD_Y + 214}" text-anchor="middle" fill="#111111" font-size="28" font-family="${FONT}" font-weight="700">${escapeXml(name)}</text>
  <rect x="${CARD_X + CARD_W / 2 - 72}" y="${CARD_Y + 228}" width="144" height="30" fill="${style.badge}" stroke="${style.border}" stroke-width="2"/>
  <text x="${CARD_X + CARD_W / 2}" y="${CARD_Y + 249}" text-anchor="middle" fill="${style.badgeText}" font-size="13" font-family="${FONT}" font-weight="700">${escapeXml(String(rarity).toUpperCase())}</text>
  <text x="${CARD_X + CARD_W / 2}" y="${CARD_Y + 286}" text-anchor="middle" fill="#444444" font-size="16" font-family="${FONT}" font-weight="600">LV ${level}</text>
  ${buildSkillTilesSvg(skillTiles)}
  <text x="${CARD_X + CARD_W / 2}" y="${CARD_Y + CARD_H - 18}" text-anchor="middle" fill="#6b21a8" font-size="12" font-family="${FONT}" font-weight="700">MONEX WILD CATCH</text>
</svg>`;
}

export function getFirstCaughtMon(results) {
  if (!Array.isArray(results)) return null;
  const hit = results.find((r) => r && !r.escaped && r.mon);
  return hit?.mon ?? null;
}

export function getMonSpritePath(name) {
  return `128x128/${getMonDisplayName(name).toLowerCase()}.png`;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
