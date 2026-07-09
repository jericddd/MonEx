import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import { buildCatchCardSvg, bytesToBase64, getMonSpritePath } from "./catch-card-core.js";

let resvgReady = null;

function ensureResvg() {
  if (!resvgReady) resvgReady = initWasm(resvgWasm);
  return resvgReady;
}

async function fetchMonSpriteDataUri(mon, frontendOrigin) {
  const origin = (frontendOrigin || "https://monexmonad.xyz").replace(/\/$/, "");
  const path = getMonSpritePath(mon.name);
  const res = await fetch(`${origin}/${path}`);
  if (!res.ok) throw new Error(`sprite fetch failed (${res.status}) for ${path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export async function renderCatchCardPng(mon, env = {}) {
  if (!mon?.name) throw new Error("mon required for catch card");
  await ensureResvg();
  const spriteDataUri = await fetchMonSpriteDataUri(mon, env.FRONTEND_ORIGIN);
  const svg = buildCatchCardSvg(mon, spriteDataUri);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 900 },
  });
  return resvg.render().asPng();
}
