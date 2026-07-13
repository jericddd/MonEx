import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { buildCatchCardSvg, bytesToBase64 } from "./catch-card-core.js";
import { getMonDisplaySpritePath } from "./monanimal-sprites.js";
import { buildResvgFontOptions, getCatchCardFonts } from "./catch-card-font.js";
import { fetchSkillTiles } from "./catch-card-skills.js";

let resvgReady = null;

function ensureResvg() {
  if (!resvgReady) resvgReady = initWasm(resvgWasm);
  return resvgReady;
}

async function fetchMonSpriteDataUri(mon, frontendOrigin) {
  const origin = (frontendOrigin || "https://monexmonad.xyz").replace(/\/$/, "");
  const path = getMonDisplaySpritePath(mon);
  const res = await fetch(`${origin}/${path}`);
  if (!res.ok) throw new Error(`sprite fetch failed (${res.status}) for ${path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export async function renderCatchCardPng(mon, env = {}) {
  if (!mon?.name) throw new Error("mon required for catch card");
  await ensureResvg();
  const origin = env.FRONTEND_ORIGIN || "https://monexmonad.xyz";
  const [spriteDataUri, skillTiles, fonts] = await Promise.all([
    fetchMonSpriteDataUri(mon, origin),
    fetchSkillTiles(mon.skills, origin),
    getCatchCardFonts(),
  ]);
  const svg = buildCatchCardSvg(mon, spriteDataUri, skillTiles);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 900 },
    font: buildResvgFontOptions(fonts),
  });
  return resvg.render().asPng();
}
