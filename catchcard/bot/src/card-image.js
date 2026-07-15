import { LIMITS, SPECIES, RARITY_LABELS } from "../../shared/rules.js";

const RARITY_COLORS = ["#94a3b8", "#22c55e", "#3b82f6", "#eab308"];

export function cardSvg({ speciesId, rarity, tokenId, happiness }) {
  const species = SPECIES.find((s) => s.id === speciesId) ?? SPECIES[0];
  const rarityLabel = RARITY_LABELS[rarity] ?? "Common";
  const accent = RARITY_COLORS[rarity] ?? RARITY_COLORS[0];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840" viewBox="0 0 600 840">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="600" height="840" rx="32" fill="url(#bg)"/>
  <rect x="24" y="24" width="552" height="792" rx="24" fill="none" stroke="${accent}" stroke-width="6"/>
  <text x="300" y="90" text-anchor="middle" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="36" font-weight="700">CatchCard</text>
  <text x="300" y="140" text-anchor="middle" fill="${accent}" font-family="system-ui,sans-serif" font-size="24">${rarityLabel}</text>
  <circle cx="300" cy="380" r="140" fill="${accent}" opacity="0.25"/>
  <text x="300" y="400" text-anchor="middle" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="64" font-weight="800">${species.name}</text>
  <text x="300" y="620" text-anchor="middle" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="28">#${tokenId}</text>
  <text x="300" y="670" text-anchor="middle" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="22">Happiness ${happiness}/${LIMITS.HAPPINESS_MAX}</text>
  <text x="300" y="760" text-anchor="middle" fill="#64748b" font-family="system-ui,sans-serif" font-size="18">Monad Testnet · v1</text>
</svg>`;
}

export function cardSvgDataUrl(params) {
  const svg = cardSvg(params);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
