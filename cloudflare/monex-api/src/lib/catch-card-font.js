const PRESS_START_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/press-start-2p@main/PressStart2P-Regular.ttf";
const NOTO_ITALIC_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Italic.ttf";

let fontCache = null;

async function fetchFontBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed (${res.status}) for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getCatchCardFonts() {
  if (fontCache) return fontCache;
  const [pressStart, notoItalic] = await Promise.all([
    fetchFontBuffer(PRESS_START_URL),
    fetchFontBuffer(NOTO_ITALIC_URL),
  ]);
  fontCache = { pressStart, notoItalic };
  return fontCache;
}

export function buildResvgFontOptions(fonts) {
  return {
    loadSystemFonts: false,
    defaultFontFamily: "Press Start 2P",
    monospaceFamily: "Press Start 2P",
    sansSerifFamily: "Noto Sans",
    fontBuffers: [fonts.pressStart, fonts.notoItalic],
  };
}

export const CATCH_CARD_FONT_FAMILY = "Press Start 2P";
export const CATCH_CARD_FOOTER_FONT_FAMILY = "Noto Sans";
