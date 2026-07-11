/** Shared catch logic — mirrors monanimal_game.html */

export const MONANIMAL_NAMES = [
  "Molandak", "Chog", "Mouch", "Salmonad", "Anago", "Larvanad", "Lyraffe", "Mokadal",
  "Monavara", "Moncock", "Mondigrade", "Montiger", "Mosferatu", "Monhorse", "Shramp",
  "Spidermon", "Moyaki",
];

const DAMAGE_ACTIVE_POOL = [
  { name: "Slash", element: "physical", type: "active", power: 1.0 },
  { name: "Flame Burst", element: "fire", type: "active", power: 1.15 },
  { name: "Aqua Jet", element: "water", type: "active", power: 0.95 },
  { name: "Shock Bolt", element: "electric", type: "active", power: 1.05 },
  { name: "Rock Throw", element: "earth", type: "active", power: 1.2 },
  { name: "Venom Bite", element: "poison", type: "active", power: 1.1 },
  { name: "Frost Shard", element: "ice", type: "active", power: 1.0 },
  { name: "Gale Slash", element: "wind", type: "active", power: 1.0 },
  { name: "Shadow Strike", element: "dark", type: "active", power: 1.1 },
  { name: "Psy Beam", element: "psychic", type: "active", power: 1.1 },
  { name: "Holy Palm", element: "physical", type: "active", power: 1.05 },
  { name: "Starfall Palm", element: "psychic", type: "active", power: 1.1 },
  { name: "Star Swipe", element: "wind", type: "active", power: 1.0 },
  { name: "Power Fist", element: "physical", type: "active", power: 1.15 },
  { name: "Ember Flask", element: "fire", type: "active", power: 1.1 },
  { name: "Star Hammer", element: "physical", type: "active", power: 1.2 },
  { name: "Crushing Hammer", element: "physical", type: "active", power: 1.2 },
  { name: "Solar Vortex", element: "fire", type: "active", power: 1.15 },
  { name: "Flash Burst", element: "electric", type: "active", power: 1.05 },
  { name: "Divine Gaze", element: "dark", type: "active", power: 1.1 },
  { name: "Force Palm", element: "physical", type: "active", power: 1.05 },
  { name: "Radiant Aura", element: "psychic", type: "active", power: 1.1 },
  { name: "Verdant Canopy", element: "earth", type: "active", power: 1.0 },
  { name: "Volt Seed", element: "electric", type: "active", power: 1.1 },
  { name: "Divine Pillars", element: "psychic", type: "active", power: 1.15 },
  { name: "Radiant Strike", element: "psychic", type: "active", power: 1.15 },
  { name: "Void Monolith", element: "dark", type: "active", power: 1.1 },
  { name: "Holy Blade", element: "physical", type: "active", power: 1.2 },
  { name: "Arc Lightning", element: "electric", type: "active", power: 1.1 },
  { name: "Mending Rain", element: "water", type: "active", power: 1.0 },
  { name: "Spirit Beam", element: "psychic", type: "active", power: 1.05 },
  { name: "Sacred Word", element: "psychic", type: "active", power: 1.05 },
  { name: "Arcane Blast", element: "psychic", type: "active", power: 1.15 },
];

const HEAL_SKILL_POOL = [
  { name: "Mend", element: "heal", type: "heal", heal: 0.35 },
  { name: "Renew", element: "heal", type: "heal", heal: 0.25 },
  { name: "Life Bloom", element: "heal", type: "heal", heal: 0.45 },
];

const PASSIVE_SKILL_POOL = [
  { name: "Tough Hide", type: "passive" },
  { name: "Sharp Claws", type: "passive" },
  { name: "Critical Instinct", type: "passive" },
  { name: "Evasive", type: "passive" },
  { name: "Bulwark", type: "passive" },
  { name: "Regenerator", type: "passive" },
  { name: "Static Aegis", type: "passive" },
  { name: "Shield Stance", type: "passive" },
  { name: "Storm Guard", type: "passive" },
  { name: "Emerald Ward", type: "passive" },
  { name: "Iron Will", type: "passive" },
  { name: "Mystic Sigil", type: "passive" },
];

const SPECIES_ULTIMATE = {
  Molandak: { name: "Frost Nova", element: "ice" },
  Chog: { name: "Croak Quake", element: "earth" },
  Mouch: { name: "Static Swarm", element: "electric" },
  Salmonad: { name: "Tidal Crash", element: "water" },
  Anago: { name: "Abyssal Coil", element: "water" },
  Larvanad: { name: "Venom Bloom", element: "poison" },
  Lyraffe: { name: "Gale Stampede", element: "wind" },
  Mokadal: { name: "Mind Crush", element: "psychic" },
  Monavara: { name: "Void Pulse", element: "dark" },
  Moncock: { name: "Crimson Spur", element: "fire" },
  Mondigrade: { name: "Seismic Shell", element: "earth" },
  Montiger: { name: "Apex Roar", element: "physical" },
  Mosferatu: { name: "Blood Moon", element: "dark" },
  Monhorse: { name: "Shock Nova", element: "electric" },
  Shramp: { name: "Bubble Barrage", element: "water" },
  Spidermon: { name: "Web Cataclysm", element: "poison" },
  Moyaki: { name: "Flame Geyser", element: "fire" },
};

export const MIN_CATCH_SPEND = 1;
export const MAX_CATCH_SPEND = 10;
export const CATCH_DENOMINATIONS = Array.from(
  { length: MAX_CATCH_SPEND - MIN_CATCH_SPEND + 1 },
  (_, i) => i + MIN_CATCH_SPEND
);
export const MIN_MONBALLS = MIN_CATCH_SPEND;
export const MONBALLS_PER_THROW = 1;
export const CATCH_RATE = 0.95;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollActiveSkill() {
  const total = DAMAGE_ACTIVE_POOL.length + HEAL_SKILL_POOL.length;
  const roll = randInt(0, total - 1);
  if (roll < DAMAGE_ACTIVE_POOL.length) return { ...DAMAGE_ACTIVE_POOL[roll] };
  return { ...HEAL_SKILL_POOL[roll - DAMAGE_ACTIVE_POOL.length] };
}

const ACTIVE_SKILL_POOL = [...DAMAGE_ACTIVE_POOL, ...HEAL_SKILL_POOL];

function pickUniqueSkill(pool, usedNames) {
  const available = pool.filter((skill) => !usedNames.has(skill.name));
  if (!available.length) return null;
  const skill = available[randInt(0, available.length - 1)];
  usedNames.add(skill.name);
  return { ...skill };
}

function getSpeciesUltimate(name) {
  return {
    ...(SPECIES_ULTIMATE[name] || { name: "Power Surge", element: "physical" }),
    type: "ultimate",
  };
}

function getSkillCount(rarity) {
  if (rarity === "Common" || rarity === "Uncommon") return 4;
  if (rarity === "Rare") return 5;
  return 6;
}

export function generateSkills(name, rarity) {
  const count = getSkillCount(rarity);
  const usedNames = new Set();
  const skills = [{ ...getSpeciesUltimate(name) }];
  const passive = pickUniqueSkill(PASSIVE_SKILL_POOL, usedNames);
  if (passive) skills.push(passive);
  while (skills.length < count) {
    const active = pickUniqueSkill(ACTIVE_SKILL_POOL, usedNames);
    if (!active) break;
    skills.push(active);
  }
  return skills;
}

export function getRarityRoll() {
  const roll = Math.random() * 100;
  // Mythic catch rate disabled (0%) until re-enabled
  if (roll < 4.1) return "Legendary";
  if (roll < 16.1) return "Rare";
  if (roll < 49.1) return "Uncommon";
  return "Common";
}

export function formatSkillsShort(skills) {
  return skills
    .map((s, i) => {
      if (s.type === "ultimate") return `★${s.name}`;
      if (s.type === "passive") return `P:${s.name}`;
      return s.name.slice(0, 8);
    })
    .join(" | ");
}

export function attemptSingleCatch() {
  const name = MONANIMAL_NAMES[randInt(0, MONANIMAL_NAMES.length - 1)];
  const rarity = getRarityRoll();
  const escaped = Math.random() >= CATCH_RATE;
  if (escaped) {
    return { escaped: true, name, rarity };
  }
  const skills = generateSkills(name, rarity);
  return {
    escaped: false,
    mon: { name, rarity, level: 1, skills },
  };
}

/** Spend `monballSpend` (1–10). 1 Monball = 1 catch. Returns { throws, results } */
export function runCatchSession(monballSpend) {
  const throws = monballSpend / MONBALLS_PER_THROW;
  const results = [];
  for (let i = 0; i < throws; i++) results.push(attemptSingleCatch());
  return { throws, results };
}

export function formatCatchReply({ username, monballSpend, results, monballsLeft }) {
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);

  const throwLines = results.map((r, i) => {
    const n = i + 1;
    if (r.escaped) return `${n}. ✗ ${r.name} escaped`;
    return `${n}. ✓ ${r.mon.name}`;
  });

  const build = (header, lines, footer) =>
    [header, ...lines, ...footer].filter(Boolean).join("\n").slice(0, 280);

  const footer = [
    `${caught.length} caught · ${escaped.length} escaped`,
    `Monballs left: ${monballsLeft}`,
    "Visit site to play the game",
  ];

  let text = build(
    `@${username} — MonEx Wild Catch (${monballSpend} Monballs)`,
    throwLines,
    footer
  );

  if (text.length >= 280 && results.length > 1) {
    const packed = [];
    for (let i = 0; i < results.length; i += 2) {
      const left = formatThrowCompact(results[i], i + 1);
      const right = results[i + 1] ? ` ${formatThrowCompact(results[i + 1], i + 2)}` : "";
      packed.push(left + right);
    }
    text = build(`@${username} — Wild Catch x${monballSpend}`, packed, footer);
  }

  if (text.length >= 280) {
    const caughtNames = caught.map((r) => r.mon.name).join(", ") || "—";
    const escapedNames = escaped.map((r) => r.name).join(", ") || "—";
    text = build(
      `@${username} — Wild Catch x${monballSpend}`,
      [`Caught: ${caughtNames}`, `Escaped: ${escapedNames}`],
      footer
    );
  }

  return text;
}

function formatThrowCompact(r, n) {
  if (r.escaped) return `${n}✗${r.name}`;
  return `${n}✓${r.mon.name}`;
}
