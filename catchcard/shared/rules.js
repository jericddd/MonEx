/**
 * CatchCard frozen rules — single source of truth (mirrors FROZEN_RULES.md).
 * RULES_VERSION must match contract RULES_VERSION().
 */

export const RULES_VERSION = 1;

export const COMMANDS = Object.freeze(["help", "link", "mint", "feed", "status"]);

/** Primary gameplay verb */
export const MINT_VERB = "mint";

export const LIMITS = Object.freeze({
  MINTS_PER_WALLET_PER_DAY: 3,
  MINT_COOLDOWN_MS: 5 * 60 * 1000,
  FEEDS_PER_TOKEN_PER_DAY: 1,
  HAPPINESS_START: 70,
  HAPPINESS_MAX: 100,
  HAPPINESS_PER_FEED: 10,
  SPECIES_HINT_SUCCESS_BPS: 3000, // 30%
});

export const RARITY = Object.freeze({
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  LEGENDARY: 3,
});

export const RARITY_LABELS = Object.freeze(["Common", "Uncommon", "Rare", "Legendary"]);

/** Roll weights out of 10_000 BPS */
export const RARITY_WEIGHTS_BPS = Object.freeze([
  { rarity: RARITY.COMMON, weight: 7000 },
  { rarity: RARITY.UNCOMMON, weight: 2000 },
  { rarity: RARITY.RARE, weight: 800 },
  { rarity: RARITY.LEGENDARY, weight: 200 },
]);

export const SPECIES = Object.freeze([
  { id: 0, name: "Spark", hint: "spark" },
  { id: 1, name: "Byte", hint: "byte" },
  { id: 2, name: "Glitch", hint: "glitch" },
  { id: 3, name: "Prism", hint: "prism" },
  { id: 4, name: "Volt", hint: "volt" },
  { id: 5, name: "Moss", hint: "moss" },
  { id: 6, name: "Dusk", hint: "dusk" },
  { id: 7, name: "Flux", hint: "flux" },
]);

const SPECIES_BY_HINT = Object.freeze(
  Object.fromEntries(SPECIES.map((s) => [s.hint, s.id]))
);

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function utcDayIndex(ms = Date.now()) {
  return Math.floor(ms / 86_400_000);
}

export function normalizeHandle(handle) {
  return String(handle || "").trim().replace(/^@/, "").toLowerCase();
}

export function isValidWallet(address) {
  return EVM_ADDRESS.test(String(address || "").trim());
}

export function speciesIdFromHint(hint) {
  const key = String(hint || "").trim().toLowerCase();
  return SPECIES_BY_HINT[key] ?? null;
}

export function speciesName(speciesId) {
  return SPECIES.find((s) => s.id === speciesId)?.name ?? "Unknown";
}

export function rarityLabel(rarityId) {
  return RARITY_LABELS[rarityId] ?? "Common";
}

/**
 * @param {number} roll 0..9999
 * @returns {number} rarity id
 */
export function rarityFromRoll(roll) {
  const n = Math.max(0, Math.min(9999, Math.floor(Number(roll) || 0)));
  let cursor = 0;
  for (const row of RARITY_WEIGHTS_BPS) {
    cursor += row.weight;
    if (n < cursor) return row.rarity;
  }
  return RARITY.COMMON;
}

/**
 * @param {() => number} rollFn returns 0..9999
 * @param {string | null | undefined} speciesHint
 */
export function rollMint(rollFn, speciesHint = null) {
  const rarity = rarityFromRoll(rollFn());
  let speciesId;
  const hinted = speciesIdFromHint(speciesHint);
  const hintRoll = rollFn();
  if (hinted != null && hintRoll < LIMITS.SPECIES_HINT_SUCCESS_BPS) {
    speciesId = hinted;
  } else {
    speciesId = Math.floor(rollFn() / 1250) % SPECIES.length; // 8 species
  }
  return { speciesId, rarity };
}

export function parseMention(text, botHandle = "catchcard") {
  const raw = String(text || "").trim();
  const handlePattern = new RegExp(`@${botHandle}\\b`, "i");
  if (!handlePattern.test(raw)) return null;

  const withoutMention = raw.replace(/@\w+/g, " ").replace(/\s+/g, " ").trim();
  const parts = withoutMention.toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return { command: "help", args: [] };

  const command = parts[0];
  if (!COMMANDS.includes(command)) return { command: "help", args: [] };

  if (command === "link") {
    return { command, args: [parts[1] || ""] };
  }
  if (command === "mint") {
    return { command, args: parts[1] ? [parts[1]] : [] };
  }
  if (command === "feed" || command === "status") {
    return { command, args: [parts[1] || ""] };
  }
  return { command, args: [] };
}

export function formatMintReply({ speciesId, rarity, tokenId, happiness, txUrl }) {
  const name = speciesName(speciesId);
  const rLabel = rarityLabel(rarity);
  const lines = [
    `MINTED! ${name} · ${rLabel} · #${tokenId}`,
    `Happiness: ${happiness}/${LIMITS.HAPPINESS_MAX}`,
  ];
  if (txUrl) lines.push(`Monad Testnet ✓ ${txUrl}`);
  return lines.join("\n");
}
