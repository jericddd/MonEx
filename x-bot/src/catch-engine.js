/** Shared catch logic — mirrors monanimal_game.html */

export const MONANIMAL_NAMES = [
  "Molandak", "Chog", "Mouch", "Salmonad", "Anago", "Larvanad", "Lyraffe", "Mokadal",
  "Monavara", "Moncock", "Mondigrade", "Montiger", "Mopo", "Mosferatu", "Moxy", "Shramp",
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
  Mopo: { name: "Cyclone Rush", element: "wind" },
  Mosferatu: { name: "Blood Moon", element: "dark" },
  Moxy: { name: "Shock Nova", element: "electric" },
  Shramp: { name: "Bubble Barrage", element: "water" },
  Spidermon: { name: "Web Cataclysm", element: "poison" },
  Moyaki: { name: "Flame Geyser", element: "fire" },
};

export const CATCH_DENOMINATIONS = [10, 20, 30, 40, 50];
export const MIN_MONBALLS = 10;
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

function generateSkills(name, rarity) {
  const count = getSkillCount(rarity);
  const skills = [{ ...getSpeciesUltimate(name) }];
  skills.push({ ...PASSIVE_SKILL_POOL[randInt(0, PASSIVE_SKILL_POOL.length - 1)] });
  while (skills.length < count) skills.push(rollActiveSkill());
  return skills;
}

export function getRarityRoll() {
  const roll = Math.random() * 100;
  if (roll < 0.1) return "Mythic";
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

/** Spend `monballSpend` (10–50). 1 Monball = 1 catch. Returns { throws, results } */
export function runCatchSession(monballSpend) {
  const throws = monballSpend / MONBALLS_PER_THROW;
  const results = [];
  for (let i = 0; i < throws; i++) results.push(attemptSingleCatch());
  return { throws, results };
}

export function formatCatchReply({ username, monballSpend, results, monballsLeft, gameUrl }) {
  const caught = results.filter((r) => !r.escaped);
  const escaped = results.filter((r) => r.escaped);
  const lines = [`@${username} — MonEx Wild Catch (${monballSpend} Monballs)`];

  if (caught.length === 0) {
    lines.push("All targets escaped this round!");
    if (escaped.length === 1) {
      lines.push(`A wild ${escaped[0].name} slipped away.`);
    }
  } else {
    lines.push(`Caught ${caught.length}/${results.length}:`);
    caught.slice(0, 3).forEach((r) => {
      const m = r.mon;
      lines.push(`• ${m.rarity.toUpperCase()} ${m.name}`);
      lines.push(`  Skills: ${formatSkillsShort(m.skills)}`);
    });
    if (caught.length > 3) lines.push(`…and ${caught.length - 3} more (saved for claim).`);
  }

  lines.push(`Monballs left: ${monballsLeft}`);
  lines.push(`Claim in game (X login soon): ${gameUrl}`);
  return lines.join("\n");
}
