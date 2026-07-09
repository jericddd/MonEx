const FONT_REGULAR_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
const FONT_BOLD_URL =
  "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf";

let fontCache = null;

async function fetchFontBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed (${res.status}) for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getCatchCardFonts() {
  if (fontCache) return fontCache;
  const [regular, bold] = await Promise.all([
    fetchFontBuffer(FONT_REGULAR_URL),
    fetchFontBuffer(FONT_BOLD_URL),
  ]);
  fontCache = { regular, bold };
  return fontCache;
}

export function buildResvgFontOptions(fonts) {
  return {
    loadSystemFonts: false,
    defaultFontFamily: "Noto Sans",
    sansSerifFamily: "Noto Sans",
    fontBuffers: [fonts.regular, fonts.bold],
  };
}

export const CATCH_CARD_FONT_FAMILY = "Noto Sans";
