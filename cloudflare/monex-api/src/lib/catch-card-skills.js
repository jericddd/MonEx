import { bytesToBase64 } from "./catch-card-core.js";

const SKILL_ICON_DIR = "game_icons/skill/";

const SKILL_ICON_MAP = {
  Slash: "slash.png",
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
  Cleanse: "sacred-word.png",
  "Arcane Blast": "arcane-blast.png",
  Mend: "mend.png",
  Renew: "renew.png",
  "Life Bloom": "life-bloom.png",
  "Tough Hide": "tough-hide.png",
  "Sharp Claws": "sharp-claws.png",
  "Critical Instinct": "critical-instinct.png",
  Evasive: "evasive.png",
  Bulwark: "bulwark.png",
  Regenerator: "regenerator.png",
  "Static Aegis": "static-aegis.png",
  "Shield Stance": "shield-stance.png",
  "Storm Guard": "storm-guard.png",
  "Emerald Ward": "emerald-ward.png",
  "Iron Will": "iron-will.png",
  "Mystic Sigil": "mystic-sigil.png",
};

const SKILL_NAME_KEYS = Object.keys(SKILL_ICON_MAP);

function resolveSkillName(name) {
  const s = String(name || "").trim();
  if (!s) return s;
  if (SKILL_ICON_MAP[s]) return s;
  const lower = s.toLowerCase();
  const match = SKILL_NAME_KEYS.find(
    (key) => key.toLowerCase() === lower || key.toLowerCase().startsWith(lower)
  );
  return match || s;
}

export function getSkillIconPath(skill) {
  if (!skill || skill.type === "ultimate") return null;
  const name = resolveSkillName(skill.name);
  const mapped = SKILL_ICON_MAP[name];
  if (mapped) return `${SKILL_ICON_DIR}${mapped}`;
  if (skill.type === "passive") return `${SKILL_ICON_DIR}tough-hide.png`;
  return `${SKILL_ICON_DIR}slash.png`;
}

function getSkillSquareFill(skill) {
  if (skill.type === "ultimate") return "#f59e0b";
  if (skill.type === "passive") return "#7c3aed";
  if (skill.type === "heal") return "#16a34a";
  return "#2563eb";
}

async function fetchDataUri(origin, path) {
  const res = await fetch(`${origin}/${path}`);
  if (!res.ok) throw new Error(`asset fetch failed (${res.status}) for ${path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export async function fetchSkillTiles(skills, frontendOrigin) {
  const origin = (frontendOrigin || "https://monexmonad.xyz").replace(/\/$/, "");
  const list = Array.isArray(skills) ? skills.slice(0, 6) : [];
  const tiles = [];

  for (const skill of list) {
    const fill = getSkillSquareFill(skill);
    if (skill.type === "ultimate") {
      tiles.push({ fill, label: "★" });
      continue;
    }
    const path = getSkillIconPath(skill);
    try {
      const iconDataUri = await fetchDataUri(origin, path);
      tiles.push({ fill, iconDataUri });
    } catch {
      const label =
        skill.type === "passive" ? "P" : String(skill.name || "??").slice(0, 2).toUpperCase();
      tiles.push({ fill, label });
    }
  }

  return tiles;
}
