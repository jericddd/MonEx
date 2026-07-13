/**
 * Central monanimal sprite manifest — party/box cards, catch cards, activity log.
 *
 * Card rule: Common / Uncommon / Rare → PNG; Legendary / Mythic → GIF when confirmed.
 * Set gifConfirmed: true when idle/generic GIF art is deployed for a species.
 */
(() => {
  "use strict";

  const MON_DISPLAY_NAMES = { Moxy: "Monhorse", Mondigrade: "Pampam" };

  const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Legendary", "Mythic"];

  /** @type {Record<string, { cardGif?: "idle"|"generic"|null, idleGif?: string, genericGif?: string, gifConfirmed?: boolean, sceneIdle?: boolean }>} */
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

  const SPECIAL = {
    johnw: {
      png: "128x128/johnw.png",
      idleGif: "128x128/johnw-idle.gif",
    },
  };

  const preloadedUrls = new Set();

  function getSpeciesKey(name) {
    const display = MON_DISPLAY_NAMES[name] || name;
    return String(display || "").toLowerCase();
  }

  function getMonDisplayName(name) {
    return MON_DISPLAY_NAMES[name] || name;
  }

  function getEntry(name) {
    return MANIFEST[getSpeciesKey(name)] || null;
  }

  function isJohnw(name) {
    return getSpeciesKey(name) === "johnw";
  }

  function isLegendaryOrAbove(rarity) {
    const rank = RARITY_ORDER.indexOf(rarity);
    const legRank = RARITY_ORDER.indexOf("Legendary");
    return rank >= legRank && rank >= 0;
  }

  function isMythic(rarity) {
    return rarity === "Mythic";
  }

  function getPngPath(name) {
    if (isJohnw(name)) return SPECIAL.johnw.png;
    return `128x128/${getSpeciesKey(name)}.png`;
  }

  function getIdleGifPath(name) {
    if (isJohnw(name)) return SPECIAL.johnw.idleGif;
    const entry = getEntry(name);
    if (entry?.idleGif) return entry.idleGif;
    return `128x128/${getSpeciesKey(name)}-idle.gif`;
  }

  function getGenericGifPath(name) {
    const entry = getEntry(name);
    if (entry?.genericGif) return entry.genericGif;
    return `128x128/${getSpeciesKey(name)}.gif`;
  }

  function speciesHasLegendaryCardGif(name) {
    const entry = getEntry(name);
    if (!entry?.cardGif) return false;
    return entry.gifConfirmed !== false;
  }

  function getLegendaryCardGifPath(name) {
    const entry = getEntry(name);
    if (!entry?.cardGif || entry.gifConfirmed === false) return null;
    if (entry.cardGif === "idle") return entry.idleGif || getIdleGifPath(name);
    if (entry.cardGif === "generic") return entry.genericGif || getGenericGifPath(name);
    return null;
  }

  function speciesHasSceneIdle(name) {
    if (isJohnw(name)) return true;
    const entry = getEntry(name);
    return !!(entry?.sceneIdle || entry?.idleGif);
  }

  function normalizeMon(mon) {
    if (mon && typeof mon === "object") return mon;
    return { name: mon };
  }

  function getMonDisplaySpritePath(mon) {
    const m = normalizeMon(mon);
    const name = m.name;
    if (!name) return getPngPath("");
    if (isJohnw(name)) return SPECIAL.johnw.idleGif;
    if (m.rarity && isLegendaryOrAbove(m.rarity)) {
      const gif = getLegendaryCardGifPath(name);
      if (gif) return gif;
    }
    return getPngPath(name);
  }

  function getMonDisplayFallbackPath(mon) {
    const m = normalizeMon(mon);
    return getPngPath(m.name);
  }

  function usesLegendaryStaticSprite(mon) {
    const m = normalizeMon(mon);
    if (!m.rarity || !isLegendaryOrAbove(m.rarity)) return false;
    if (isJohnw(m.name)) return false;
    return !getLegendaryCardGifPath(m.name);
  }

  function getMonSpriteExtraClass(mon) {
    const m = normalizeMon(mon);
    const parts = [];
    if (usesLegendaryStaticSprite(m)) parts.push("mon-sprite--legendary-static");
    if (isMythic(m.rarity)) parts.push("mon-sprite--mythic");
    return parts.join(" ");
  }

  function preloadSpriteUrls(urls) {
    (urls || []).forEach((url) => {
      if (!url || preloadedUrls.has(url)) return;
      preloadedUrls.add(url);
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    });
  }

  function preloadMonAvatars(mons) {
    const urls = new Set();
    (mons || []).forEach((mon) => {
      if (!mon?.name) return;
      urls.add(getPngPath(mon.name));
      if (mon.rarity && isLegendaryOrAbove(mon.rarity)) {
        const gif = getLegendaryCardGifPath(mon.name);
        if (gif) urls.add(gif);
      }
    });
    preloadSpriteUrls([...urls]);
  }

  const api = {
    MON_DISPLAY_NAMES,
    RARITY_ORDER,
    MANIFEST,
    getSpeciesKey,
    getMonDisplayName,
    getPngPath,
    getIdleGifPath,
    getGenericGifPath,
    getLegendaryCardGifPath,
    speciesHasLegendaryCardGif,
    speciesHasSceneIdle,
    isLegendaryOrAbove,
    isMythic,
    isJohnw,
    getMonDisplaySpritePath,
    getMonDisplayFallbackPath,
    usesLegendaryStaticSprite,
    getMonSpriteExtraClass,
    preloadMonAvatars,
    preloadSpriteUrls,
  };

  if (typeof window !== "undefined") window.MonExMonSprites = api;
  if (typeof globalThis !== "undefined") globalThis.MonExMonSprites = api;
})();
