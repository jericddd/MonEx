import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatchCardSvg, getFirstCaughtMon } from "./catch-card-core.js";

test("getFirstCaughtMon returns first successful catch", () => {
  const results = [
    { escaped: true, name: "Mouch" },
    { escaped: false, mon: { name: "Chog", rarity: "Rare", level: 1, skills: [] } },
    { escaped: false, mon: { name: "Anago", rarity: "Common", level: 1, skills: [] } },
  ];
  assert.equal(getFirstCaughtMon(results)?.name, "Chog");
});

test("getFirstCaughtMon returns null when all escaped", () => {
  const results = [{ escaped: true, name: "Mouch" }];
  assert.equal(getFirstCaughtMon(results), null);
});

test("buildCatchCardSvg centers card and includes mon details", () => {
  const svg = buildCatchCardSvg(
    {
      name: "Chog",
      rarity: "Legendary",
      level: 1,
    },
    "data:image/png;base64,AAAA",
    [{ fill: "#f59e0b", label: "★" }, { fill: "#2563eb", iconDataUri: "data:image/png;base64,BBBB" }]
  );
  assert.match(svg, /width="900"/);
  assert.match(svg, /CHOG/);
  assert.match(svg, /LEGENDARY/);
  assert.match(svg, /LV 1/);
  assert.match(svg, /MONEX WILD CATCH/);
  assert.match(svg, /Press Start 2P/);
  assert.match(svg, /data:image\/png;base64,BBBB/);
});
