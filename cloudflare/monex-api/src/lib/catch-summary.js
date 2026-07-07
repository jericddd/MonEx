const RARITY_ORDER = ["Mythic", "Legendary", "Rare", "Uncommon", "Common"];

const RARITY_RANK = {
  Mythic: 5,
  Legendary: 4,
  Rare: 3,
  Uncommon: 2,
  Common: 1,
};

function formatCountList(parts) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export function countCaughtByRarity(caught) {
  const counts = {};
  for (const row of caught) {
    const rarity = row.mon?.rarity || "Common";
    counts[rarity] = (counts[rarity] || 0) + 1;
  }
  return counts;
}

export function formatRaritySummary(caught) {
  const counts = countCaughtByRarity(caught);
  const parts = RARITY_ORDER.filter((r) => counts[r] > 0).map((r) => {
    const n = counts[r];
    return `${n} ${r}${n === 1 ? "" : ""}`;
  });
  return formatCountList(parts);
}

export function pickHighlightMons(caught, min = 3, seed = 0) {
  if (!caught.length) return "";

  const byRarity = {};
  for (const row of caught) {
    const rarity = row.mon?.rarity || "Common";
    if (!byRarity[rarity]) byRarity[rarity] = [];
    byRarity[rarity].push(row.mon.name);
  }

  const target = Math.min(min, caught.length);
  const picks = [];

  for (const rarity of RARITY_ORDER) {
    const names = byRarity[rarity];
    if (!names?.length) continue;

    const unique = [...new Set(names)];
    const start = seed % unique.length;
    for (let i = 0; picks.length < target && i < unique.length; i++) {
      const name = unique[(start + i) % unique.length];
      picks.push(`${rarity} ${name}`);
    }
    if (picks.length >= target) break;
  }

  return formatCountList(picks);
}

export function formatEscapedNote(escaped) {
  if (!escaped.length) return "none escaped";
  if (escaped.length > 3) return `${escaped.length} slipped away`;
  const names = [...new Set(escaped.map((r) => r.name))];
  if (names.length === 1) return `${names[0]} got away`;
  return `${formatCountList(names)} got away`;
}

function formatNameList(names) {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique.at(-1)}`;
}

export function buildCatchSummaryFields(caught, escaped, seed = 0) {
  return {
    raritySummary: formatRaritySummary(caught) || "no catches",
    highlights: pickHighlightMons(caught, Math.min(3, caught.length) || 0, seed) || "—",
    escapedNote: formatEscapedNote(escaped),
    caughtList: formatNameList(caught.map((r) => r.mon.name)),
    escapedList: formatNameList(escaped.map((r) => r.name)),
  };
}
