import { PRESS_START_TTF_B64, NOTO_ITALIC_TTF_B64 } from "./catch-card-font-data.js";

let fontCache = null;

function b64ToUint8Array(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function getCatchCardFonts() {
  if (fontCache) return fontCache;
  fontCache = {
    pressStart: b64ToUint8Array(PRESS_START_TTF_B64),
    notoItalic: b64ToUint8Array(NOTO_ITALIC_TTF_B64),
  };
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
