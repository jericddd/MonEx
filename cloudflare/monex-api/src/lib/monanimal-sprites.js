/** Server mirror of js/monanimal-sprites.js — keep in sync when adding species or GIF assets. */

const MON_DISPLAY_NAMES = { Moxy: "Monhorse", Mondigrade: "Pampam" };

const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Legendary", "Mythic"];

const MANIFEST = {
  molandak: { cardGif: "generic", genericGif: "128x128/molandak.gif", gifConfirmed: true },
  chog: { cardGif: "generic", genericGif: "128x128/chog.gif", gifConfirmed: true },
  anago: { cardGif: "idle", idleGif: "128x128/anago-idle.gif", gifConfirmed: true, sceneIdle: true },
  mouch: { cardGif: "idle", idleGif: "128x128/mouch-idle.gif", gifConfirmed: true, sceneIdle: true },
  moyaki: { cardGif: "idle", idleGif: "128x128/main-moyaki.gif", gifConfirmed: true, sceneIdle: true },
  moncock: { cardGif: "idle", idleGif: "128x128/moncock-idle.gif", gifConfirmed: true, sceneIdle: true },
  salmonad: { cardGif: "idle", idleGif: "128x128/slamonad-idle.gif", gifConfirmed: true, sceneIdle: true },
  larvanad: { cardGif: "idle", idleGif: "128x128/larvanad-idle.gif", gifConfirmed: true, sceneIdle: true },
  monhorse: { cardGif: "idle", idleGif: "128x128/monhorse-idle.gif", gifConfirmed: true, sceneIdle: true },
  pampam: { cardGif: "idle", idleGif: "128x128/pampam-idle.gif", gifConfirmed: true, sceneIdle: true },
  lyraffe: { cardGif: "idle", idleGif: "128x128/lyraffe-idle.gif", gifConfirmed: false },
  mokadal: { cardGif: "idle", idleGif: "128x128/mokadal-idle.gif", gifConfirmed: false },
  monavara: { cardGif: "idle", idleGif: "128x128/monavara-idle.gif", gifConfirmed: false },
  montiger: { cardGif: "idle", idleGif: "128x128/montiger-idle.gif", gifConfirmed: false },
  mosferatu: { cardGif: "idle", idleGif: "128x128/mosferatu-idle.gif", gifConfirmed: false },
  shramp: { cardGif: "idle", idleGif: "128x128/shramp-idle.gif", gifConfirmed: false },
  spidermon: { cardGif: "idle", idleGif: "128x128/spidermon-idle.gif", gifConfirmed: false },
};

export function getSpeciesKey(name) {
  const display = MON_DISPLAY_NAMES[name] || name;
  return String(display || "").toLowerCase();
}

export function getMonDisplayName(name) {
  return MON_DISPLAY_NAMES[name] || name;
}

function getEntry(name) {
  return MANIFEST[getSpeciesKey(name)] || null;
}

export function isLegendaryOrAbove(rarity) {
  const rank = RARITY_ORDER.indexOf(rarity);
  const legRank = RARITY_ORDER.indexOf("Legendary");
  return rank >= legRank && rank >= 0;
}

export function getPngPath(name) {
  return `128x128/${getSpeciesKey(name)}.png`;
}

export function getLegendaryCardGifPath(name) {
  const entry = getEntry(name);
  if (!entry?.cardGif || entry.gifConfirmed === false) return null;
  if (entry.cardGif === "idle") return entry.idleGif || `128x128/${getSpeciesKey(name)}-idle.gif`;
  if (entry.cardGif === "generic") return entry.genericGif || `128x128/${getSpeciesKey(name)}.gif`;
  return null;
}

/** Sprite path for catch cards and other server-rendered mon portraits. */
export function getMonDisplaySpritePath(mon) {
  const name = mon?.name;
  if (!name) return getPngPath("");
  if (mon.rarity && isLegendaryOrAbove(mon.rarity)) {
    const gif = getLegendaryCardGifPath(name);
    if (gif) return gif;
  }
  return getPngPath(name);
}

/** @deprecated Use getMonDisplaySpritePath(mon) */
export function getMonSpritePath(name, rarity) {
  if (rarity != null) return getMonDisplaySpritePath({ name, rarity });
  return getPngPath(name);
}
