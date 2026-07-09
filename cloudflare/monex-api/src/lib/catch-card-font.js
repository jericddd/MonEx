const FONT_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/press-start-2p@main/PressStart2P-Regular.ttf";

let fontCache = null;

async function fetchFontBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed (${res.status}) for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getCatchCardFonts() {
  if (fontCache) return fontCache;
  const regular = await fetchFontBuffer(FONT_URL);
  fontCache = { regular };
  return fontCache;
}

export function buildResvgFontOptions(fonts) {
  return {
    loadSystemFonts: false,
    defaultFontFamily: "Press Start 2P",
    monospaceFamily: "Press Start 2P",
    fontBuffers: [fonts.regular],
  };
}

export const CATCH_CARD_FONT_FAMILY = "Press Start 2P";
