/** Server-side save validation — mirrors client game limits (Phase 1 security). */

export const MONANIMAL_NAMES = new Set([
  "Molandak", "Chog", "Mouch", "Salmonad", "Anago", "Larvanad", "Lyraffe", "Mokadal",
  "Monavara", "Moncock", "Mondigrade", "Montiger", "Mosferatu", "Monhorse", "Shramp",
  "Spidermon", "Moyaki",
]);

export const REMOVED_MONANIMAL_NAMES = new Set(["Mopo"]);

const MONANIMAL_LEGACY_RENAMES = { Moxy: "Monhorse" };

function canonicalMonanimalName(name) {
  return MONANIMAL_LEGACY_RENAMES[name] || name;
}

export const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Legendary", "Mythic"];

export const GEAR_SLOTS = ["weapon", "armor", "helmet", "boots"];

export const GEAR_SLOT_LABELS = {
  weapon: "Weapon",
  armor: "Armor",
  helmet: "Helmet",
  boots: "Boots",
};

export const GEAR_TIERS = [
  null,
  { name: "Common", color: "#111111" },
  { name: "Uncommon", color: "#16a34a" },
  { name: "Rare", color: "#2563eb" },
  { name: "Legendary", color: "#ca8a04" },
  { name: "Mythic", color: "#9f1239" },
];

const HOUSE_GEAR_LINES = {
  chog: "Croakguard",
  molandak: "Quillspire",
  moyaki: "Geyserfin",
};
const VALID_GEAR_HOUSES = new Set(Object.keys(HOUSE_GEAR_LINES));

export const STAT_SPECIALTIES = new Set(["spd", "crit", "pierce", "block", "hit", "dodge"]);

export const GEAR_BONUS_KEYS = new Set(["atk", "hp", "spd", "crit", "dodge", "block", "hit", "pierce"]);

export const LIMITS = {
  money: 99_999_999,
  essence: 9_999_999,
  monShards: 99_999,
  monballs: 9_999,
  trainerXp: 99_999_999,
  partyMax: 5,
  boxMax: 500,
  gearInventoryMax: 400,
  gearPerMonMax: 4,
  skillsMax: 12,
  statValueMax: 500,
  gearBonusMax: 9_999,
  maxChapter: 999,
  stagesPerChapter: 40,
  gearEnhanceMax: 21,
  maxGearTier: 5,
  maxGearLevelTier: 99,
  ascensionStarsMax: 99,
  ascensionSkillPendingMax: 3,
  resourceChestMaxMs: 24 * 60 * 60 * 1000,
  clockSkewMs: 5 * 60 * 1000,
  stringMaxLen: 120,
  gearIdMaxLen: 80,
  monLevelMax: 80,
  mailboxMax: 50,
};

const DAILY_LOGIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const LEVEL_CAP_BY_RARITY = {
  Common: 20,
  Uncommon: 30,
  Rare: 40,
  Legendary: 60,
  Mythic: 80,
};

function clampInt(value, min, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clampNum(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function resolveUpdatedAt(input, now) {
  const parsed = Date.parse(input?.updatedAt || "");
  if (!Number.isFinite(parsed)) return new Date(now).toISOString();
  const latest = now + LIMITS.clockSkewMs;
  return new Date(clampNum(parsed, 0, latest)).toISOString();
}

function trimString(value, maxLen = LIMITS.stringMaxLen) {
  if (typeof value !== "string") return "";
  // Strip angle brackets so a crafted save can never carry HTML into the DOM
  // (defense-in-depth for any client render path that misses escapeHtml).
  return value.replace(/[<>]/g, "").trim().slice(0, maxLen);
}

function getLevelCap(rarity) {
  return LEVEL_CAP_BY_RARITY[rarity] || 20;
}

function getGlobalAdventureProgress(chapter, stage) {
  const ch = Math.max(1, chapter || 1);
  const st = Math.max(1, stage || 1);
  return (ch - 1) * LIMITS.stagesPerChapter + st;
}

function globalProgressToChapterStage(globalProgress) {
  const g = Math.max(1, globalProgress || 1);
  return {
    chapter: Math.floor((g - 1) / LIMITS.stagesPerChapter) + 1,
    stage: ((g - 1) % LIMITS.stagesPerChapter) + 1,
  };
}

function sanitizeGearBonuses(raw) {
  const bonuses = {};
  if (!raw || typeof raw !== "object") return bonuses;
  for (const key of GEAR_BONUS_KEYS) {
    if (raw[key] == null) continue;
    bonuses[key] = clampInt(raw[key], 0, LIMITS.gearBonusMax);
  }
  return bonuses;
}

function sanitizeGearRollLine(raw) {
  if (!raw || typeof raw !== "object") return null;
  const stat = GEAR_BONUS_KEYS.has(raw.stat) ? raw.stat : null;
  if (!stat) return null;
  return {
    stat,
    value: clampInt(raw.value, 0, LIMITS.gearBonusMax),
    min: clampInt(raw.min, 0, LIMITS.gearBonusMax),
    max: clampInt(raw.max, 0, LIMITS.gearBonusMax),
  };
}

function gearRequiredLevelForTier(gearLevelTier) {
  return (Math.max(1, gearLevelTier) - 1) * 20 + 1;
}

export function sanitizeGear(raw) {
  if (!raw || typeof raw !== "object") return null;
  const slot = GEAR_SLOTS.includes(raw.slot) ? raw.slot : null;
  if (!slot) return null;

  const tier = clampInt(raw.tier, 1, LIMITS.maxGearTier);
  const tierInfo = GEAR_TIERS[tier];
  if (!tierInfo) return null;

  const enhanceLevel = clampInt(raw.enhanceLevel ?? 0, 0, LIMITS.gearEnhanceMax);
  const tierName = tierInfo.name;
  const house = VALID_GEAR_HOUSES.has(raw.house) ? raw.house : undefined;
  const lineName = house ? HOUSE_GEAR_LINES[house] : (trimString(raw.lineName, 32) || undefined);
  const name = house && lineName
    ? `${lineName} ${tierName} ${GEAR_SLOT_LABELS[slot]}`
    : `${tierName} ${GEAR_SLOT_LABELS[slot]}`;
  const id = trimString(raw.id, LIMITS.gearIdMaxLen) || `gear_srv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const gear = {
    id,
    slot,
    tier,
    tierName,
    name,
    bonuses: sanitizeGearBonuses(raw.bonuses),
    baseBonuses: sanitizeGearBonuses(raw.baseBonuses || raw.bonuses),
    enhanceLevel,
    gearVersion: raw.gearVersion != null ? clampInt(raw.gearVersion, 1, 99) : undefined,
  };
  if (house) gear.house = house;
  if (lineName) gear.lineName = lineName;
  if (raw.iconVersion != null) gear.iconVersion = clampInt(raw.iconVersion, 1, 99);
  const primaryRoll = sanitizeGearRollLine(raw.primaryRoll);
  if (primaryRoll) gear.primaryRoll = primaryRoll;
  if (Array.isArray(raw.rngLines)) {
    const maxLines = tier >= 5 ? 3 : 2;
    gear.rngLines = raw.rngLines.map(sanitizeGearRollLine).filter(Boolean).slice(0, maxLines);
  }
  const gearLevelTier = raw.gearLevelTier != null
    ? clampInt(raw.gearLevelTier, 1, LIMITS.maxGearLevelTier)
    : 1;
  gear.gearLevelTier = gearLevelTier;
  gear.requiredLevel = clampInt(
    gearRequiredLevelForTier(gearLevelTier),
    1,
    LIMITS.monLevelMax,
  );
  return gear;
}

function sanitizeMonStats(raw) {
  if (!raw || typeof raw !== "object") return null;
  const stats = {};
  for (const key of STAT_SPECIALTIES) {
    if (raw[key] == null) continue;
    stats[key] = clampInt(raw[key], 0, LIMITS.statValueMax);
  }
  if (typeof raw.specialty === "string" && STAT_SPECIALTIES.has(raw.specialty)) {
    stats.specialty = raw.specialty;
  }
  return Object.keys(stats).length ? stats : null;
}

function sanitizeSkill(raw) {
  if (!raw || typeof raw !== "object") return null;
  const skill = {};
  if (typeof raw.name === "string") skill.name = trimString(raw.name, 64);
  if (typeof raw.type === "string") skill.type = trimString(raw.type, 24);
  if (typeof raw.element === "string") skill.element = trimString(raw.element, 24);
  if (raw.power != null) skill.power = clampNum(raw.power, 0, 99);
  if (typeof raw.desc === "string") skill.desc = trimString(raw.desc, 200);
  if (raw.manaCost != null) skill.manaCost = clampInt(raw.manaCost, 0, 999);
  if (raw.cooldown != null) skill.cooldown = clampInt(raw.cooldown, 0, 99);
  if (raw.healPower != null) skill.healPower = clampNum(raw.healPower, 0, 10);
  if (raw.dmgTaken != null) skill.dmgTaken = clampNum(raw.dmgTaken, 0, 1);
  if (raw.dmgDealt != null) skill.dmgDealt = clampNum(raw.dmgDealt, 0, 10);
  if (raw.critBonus != null) skill.critBonus = clampInt(raw.critBonus, 0, 100);
  if (raw.dodgeBonus != null) skill.dodgeBonus = clampInt(raw.dodgeBonus, 0, 100);
  if (raw.blockBonus != null) skill.blockBonus = clampInt(raw.blockBonus, 0, 100);
  if (raw.hitBonus != null) skill.hitBonus = clampInt(raw.hitBonus, 0, 100);
  if (raw.pierceBonus != null) skill.pierceBonus = clampInt(raw.pierceBonus, 0, 100);
  if (raw.spdBonus != null) skill.spdBonus = clampInt(raw.spdBonus, 0, 200);
  if (raw.regen != null) skill.regen = clampNum(raw.regen, 0, 1);
  if (raw.cleanse === true) skill.cleanse = true;
  if (raw.effect && typeof raw.effect === "object" && typeof raw.effect.type === "string") {
    skill.effect = {
      type: trimString(raw.effect.type, 24),
      turns: raw.effect.turns != null ? clampInt(raw.effect.turns, 1, 99) : undefined,
      chance: raw.effect.chance != null ? clampNum(raw.effect.chance, 0, 1) : undefined,
    };
  }
  const selfBuff = sanitizeBuffDef(raw.selfBuff);
  if (selfBuff) skill.selfBuff = selfBuff;
  if (Array.isArray(raw.multiHit)) {
    skill.multiHit = raw.multiHit.map((v) => clampNum(v, 0, 10)).filter((v) => v > 0).slice(0, 8);
  }
  if (raw.bonusHit && typeof raw.bonusHit === "object") {
    skill.bonusHit = {
      power: clampNum(raw.bonusHit.power, 0, 10),
      spdLead: raw.bonusHit.spdLead != null ? clampInt(raw.bonusHit.spdLead, 0, 200) : undefined,
    };
  }
  if (raw.ultCritChanceBonus != null) skill.ultCritChanceBonus = clampInt(raw.ultCritChanceBonus, 0, 100);
  if (raw.ultCritDamageMult != null) skill.ultCritDamageMult = clampNum(raw.ultCritDamageMult, 1, 5);
  if (raw.executeThreshold != null) skill.executeThreshold = clampNum(raw.executeThreshold, 0, 1);
  if (raw.executeBonus != null) skill.executeBonus = clampNum(raw.executeBonus, 0, 2);
  if (raw.ignoreBlock != null) skill.ignoreBlock = clampNum(raw.ignoreBlock, 0, 1);
  if (raw.cannotBeBlocked === true) skill.cannotBeBlocked = true;
  if (raw.bonusVsBlock != null) skill.bonusVsBlock = clampNum(raw.bonusVsBlock, 0, 2);
  if (raw.bonusVsBlockMin != null) skill.bonusVsBlockMin = clampInt(raw.bonusVsBlockMin, 0, 100);
  if (raw.bonusVsShield != null) skill.bonusVsShield = clampNum(raw.bonusVsShield, 0, 2);
  if (raw.bonusIfBurning != null) skill.bonusIfBurning = clampNum(raw.bonusIfBurning, 0, 2);
  if (raw.lifesteal != null) skill.lifesteal = clampNum(raw.lifesteal, 0, 1);
  if (raw.shieldPct != null) skill.shieldPct = clampNum(raw.shieldPct, 0, 1);
  if (raw.shieldTurns != null) skill.shieldTurns = clampInt(raw.shieldTurns, 1, 10);
  if (typeof raw.shieldId === "string") skill.shieldId = trimString(raw.shieldId, 24);
  if (raw.stunPerHit != null) skill.stunPerHit = clampNum(raw.stunPerHit, 0, 1);
  if (raw.stunIfBelowHp != null) skill.stunIfBelowHp = clampNum(raw.stunIfBelowHp, 0, 1);
  const enemyDebuff = sanitizeBuffDef(raw.enemyDebuff);
  if (enemyDebuff) skill.enemyDebuff = enemyDebuff;
  return skill.name ? skill : null;
}

function sanitizeBuffDef(raw) {
  if (!raw || typeof raw !== "object") return null;
  const buff = {};
  if (typeof raw.id === "string") buff.id = trimString(raw.id, 24);
  if (raw.turns != null) buff.turns = clampInt(raw.turns, 1, 99);
  if (raw.statMods && typeof raw.statMods === "object") {
    const mods = {};
    for (const key of ["atk", "hp", "spd", "crit", "dodge", "block", "hit", "pierce"]) {
      if (raw.statMods[key] != null) mods[key] = clampInt(raw.statMods[key], -200, 200);
    }
    if (Object.keys(mods).length) buff.statMods = mods;
  }
  return Object.keys(buff).length ? buff : null;
}

function sanitizeEquipment(raw) {
  const equipment = { weapon: null, armor: null, helmet: null, boots: null };
  if (!raw || typeof raw !== "object") return equipment;
  for (const slot of GEAR_SLOTS) {
    const gear = sanitizeGear(raw[slot]);
    equipment[slot] = gear;
  }
  return equipment;
}

export function sanitizeMon(raw) {
  if (!raw || typeof raw !== "object") return null;
  let name = trimString(raw.name, 48);
  name = canonicalMonanimalName(name);
  if (!name || !MONANIMAL_NAMES.has(name) || REMOVED_MONANIMAL_NAMES.has(name)) return null;

  const rarity = RARITY_ORDER.includes(raw.rarity) ? raw.rarity : "Common";
  const level = clampInt(raw.level, 1, getLevelCap(rarity));
  const maxHp = clampInt(raw.max_hp, 1, 99_999);
  let currentHp = clampInt(raw.current_hp ?? maxHp, 0, maxHp);

  const mon = {
    name,
    rarity,
    level,
    max_hp: maxHp,
    current_hp: currentHp,
    equipment: sanitizeEquipment(raw.equipment),
  };

  const stats = sanitizeMonStats(raw.stats);
  if (stats) mon.stats = stats;
  if (Number.isFinite(raw.statVersion)) mon.statVersion = clampInt(raw.statVersion, 1, 99);
  if (Number.isFinite(raw.ultimateVersion)) mon.ultimateVersion = clampInt(raw.ultimateVersion, 1, 99);

  if (Array.isArray(raw.skills)) {
    const skills = raw.skills.map(sanitizeSkill).filter(Boolean).slice(0, LIMITS.skillsMax);
    if (skills.length) mon.skills = skills;
  }
  if (raw.ultimate && typeof raw.ultimate === "object") {
    const ultimate = sanitizeSkill(raw.ultimate);
    if (ultimate) mon.ultimate = ultimate;
  }

  mon.ascensionStars = clampInt(raw.ascensionStars ?? 0, 0, LIMITS.ascensionStarsMax);
  if (Array.isArray(raw.ascensionSkillPending)) {
    const pending = raw.ascensionSkillPending
      .map(sanitizeSkill)
      .filter(Boolean)
      .slice(0, LIMITS.ascensionSkillPendingMax);
    if (pending.length) mon.ascensionSkillPending = pending;
  }

  return mon;
}

function sanitizeMonList(raw, maxLen) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeMon).filter(Boolean).slice(0, maxLen);
}

function sanitizeGearInventory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeGear).filter(Boolean).slice(0, LIMITS.gearInventoryMax);
}

function sanitizeResourceChestTimestamp(raw, now = Date.now()) {
  if (!Number.isFinite(raw) || raw <= 0) return now;
  const earliest = now - LIMITS.resourceChestMaxMs;
  const latest = now + LIMITS.clockSkewMs;
  return clampNum(raw, earliest, latest);
}

function sanitizeAdventureFields(src) {
  let adventureGlobalBest = clampInt(
    src.adventureGlobalBest ?? src.highestStageCleared ?? 0,
    0,
    LIMITS.maxChapter * LIMITS.stagesPerChapter,
  );
  let highestStageCleared = clampInt(src.highestStageCleared ?? 0, 0, LIMITS.stagesPerChapter);

  let currentChapter = clampInt(src.currentChapter ?? 1, 1, LIMITS.maxChapter);
  let currentStage = clampInt(src.currentStage ?? 1, 1, LIMITS.stagesPerChapter);

  const fromBest = globalProgressToChapterStage(adventureGlobalBest);
  highestStageCleared = fromBest.stage;

  const currentGlobal = getGlobalAdventureProgress(currentChapter, currentStage);
  if (currentGlobal > adventureGlobalBest + 1) {
    const capped = globalProgressToChapterStage(adventureGlobalBest + 1);
    currentChapter = capped.chapter;
    currentStage = capped.stage;
  }

  return {
    highestStageCleared,
    adventureGlobalBest,
    currentChapter,
    currentStage,
  };
}

function sanitizeQuestGrant(raw) {
  if (!raw || typeof raw !== "object") return null;
  const grant = {};
  if (raw.gold != null) grant.gold = clampInt(raw.gold, 0, LIMITS.money);
  if (raw.essence != null) grant.essence = clampInt(raw.essence, 0, LIMITS.essence);
  if (raw.monballs != null) grant.monballs = clampInt(raw.monballs, 0, LIMITS.monballs);
  if (raw.monShards != null) grant.monShards = clampInt(raw.monShards, 0, LIMITS.monShards);
  if (raw.trainerXp != null) grant.trainerXp = clampInt(raw.trainerXp, 0, LIMITS.trainerXp);
  return Object.keys(grant).length ? grant : null;
}

function sanitizeQuestState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tabs = ["dailies", "weeklies", "campaign"];
  const tasks = {};
  tabs.forEach((tab) => {
    if (!Array.isArray(raw.tasks?.[tab])) return;
    tasks[tab] = raw.tasks[tab]
      .filter((t) => t && typeof t.id === "string")
      .slice(0, 20)
      .map((t) => ({
        id: trimString(t.id, 16),
        progress: clampInt(t.progress ?? 0, 0, 9999),
        claimed: !!t.claimed,
      }));
  });
  const grantedKeys = Array.isArray(raw.grantedKeys)
    ? raw.grantedKeys.map((k) => trimString(k, 48)).filter(Boolean).slice(0, 80)
    : [];
  return {
    tab: tabs.includes(raw.tab) ? raw.tab : "dailies",
    points: clampInt(raw.points ?? 0, 0, 100),
    claimedChests: Array.isArray(raw.claimedChests)
      ? raw.claimedChests.map((n) => clampInt(n, 0, 100)).filter((n) => [20, 40, 60, 80, 100].includes(n)).slice(0, 5)
      : [],
    grantedKeys,
    dailyResetKey: typeof raw.dailyResetKey === "string" ? trimString(raw.dailyResetKey, 16) : null,
    weeklyResetKey: typeof raw.weeklyResetKey === "string" ? trimString(raw.weeklyResetKey, 16) : null,
    tasks,
  };
}

function sanitizeMailboxItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = trimString(raw.id, 80);
  if (!id) return null;
  const type = raw.type === "monballs" ? "monballs" : raw.type === "resources" ? "resources" : null;
  if (!type) return null;
  const createdAt = trimString(raw.createdAt, 40) || null;
  const claimedAt = raw.claimedAt ? trimString(raw.claimedAt, 40) : null;
  const base = {
    id,
    type,
    title: trimString(raw.title, 80) || "Reward",
    body: trimString(raw.body, 160) || "",
    createdAt: createdAt || new Date(0).toISOString(),
    ...(claimedAt ? { claimedAt } : {}),
  };
  if (type === "monballs") {
    return {
      ...base,
      amount: clampInt(raw.amount ?? 1, 1, LIMITS.monballs),
    };
  }
  const grant = sanitizeQuestGrant(raw.grant);
  if (!grant) return null;
  return { ...base, grant };
}

export function sanitizeMailbox(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeMailboxItem).filter(Boolean).slice(0, LIMITS.mailboxMax);
}

export function unclaimedMailboxCount(raw) {
  return sanitizeMailbox(raw).filter((item) => !item.claimedAt).length;
}

export function mailboxHasCapacity(raw, max = LIMITS.mailboxMax) {
  return unclaimedMailboxCount(raw) < max;
}

function sanitizeDailyLoginLastClaimAt(raw, now = Date.now()) {
  if (!raw) return null;
  const ts = Date.parse(String(raw));
  if (!Number.isFinite(ts) || ts > now + LIMITS.clockSkewMs) return null;
  return new Date(ts).toISOString();
}

export function getDailyLoginStatusFromSave(save, now = Date.now()) {
  const lastRaw = save?.dailyLoginLastClaimAt;
  const last = lastRaw ? Date.parse(lastRaw) : 0;
  const ready = !Number.isFinite(last) || now - last >= DAILY_LOGIN_COOLDOWN_MS;
  return {
    ready,
    nextClaimAt: ready ? null : new Date(last + DAILY_LOGIN_COOLDOWN_MS).toISOString(),
    unclaimed: sanitizeMailbox(save?.mailbox).filter((m) => !m.claimedAt).length,
  };
}

/**
 * Validate and sanitize a full save object. Returns a clean payload safe to store.
 */
export function validateAndSanitizeSave(src, session = {}, options = {}) {
  const input = src && typeof src === "object" ? src : {};
  const now = options.now ?? Date.now();
  const adventure = sanitizeAdventureFields(input);

  return {
    party: sanitizeMonList(input.party, LIMITS.partyMax),
    box: sanitizeMonList(input.box, LIMITS.boxMax),
    monballs: clampInt(input.monballs ?? 10, 0, LIMITS.monballs),
    money: clampInt(input.money ?? 5000, 0, LIMITS.money),
    essence: clampInt(input.essence ?? 0, 0, LIMITS.essence),
    monShards: clampInt(input.monShards ?? 0, 0, LIMITS.monShards),
    trainerXp: clampInt(input.trainerXp ?? 0, 0, LIMITS.trainerXp),
    trainerRewardLevel: clampInt(input.trainerRewardLevel ?? 1, 1, 9999),
    highestStageCleared: adventure.highestStageCleared,
    adventureGlobalBest: adventure.adventureGlobalBest,
    currentChapter: adventure.currentChapter,
    currentStage: adventure.currentStage,
    gearInventory: sanitizeGearInventory(input.gearInventory),
    gearInventorySeedVersion: clampInt(input.gearInventorySeedVersion ?? 0, 0, 99),
    lastResetDate: typeof input.lastResetDate === "string" ? trimString(input.lastResetDate, 32) || null : null,
    patrolScansUsed: clampInt(input.patrolScansUsed ?? 0, 0, 50),
    patrolScansDay: typeof input.patrolScansDay === "string" ? trimString(input.patrolScansDay, 32) || null : null,
    resourceChestLastCollectAt: sanitizeResourceChestTimestamp(input.resourceChestLastCollectAt, now),
    questState: sanitizeQuestState(input.questState),
    mailbox: sanitizeMailbox(input.mailbox),
    dailyLoginLastClaimAt: sanitizeDailyLoginLastClaimAt(input.dailyLoginLastClaimAt, now),
    adventureBattleActive: false,
    revision: clampInt(input.revision ?? 0, 0, Number.MAX_SAFE_INTEGER),
    saveVersion: Number.isFinite(input.saveVersion) ? clampInt(input.saveVersion, 1, 999) : 1,
    xHandle: session.username || trimString(input.xHandle, 48) || "",
    updatedAt: resolveUpdatedAt(input, now),
  };
}
