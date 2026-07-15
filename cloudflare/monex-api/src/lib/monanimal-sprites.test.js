import test from "node:test";
import assert from "node:assert/strict";
import {
  getMonDisplaySpritePath,
  getLegendaryCardGifPath,
  getPngPath,
  speciesHasSceneIdle,
  getMonDisplaySpriteCandidates,
} from "./monanimal-sprites.js";

test("getMonDisplaySpritePath uses PNG for Common", () => {
  assert.equal(getMonDisplaySpritePath({ name: "Anago", rarity: "Common" }), "128x128/anago.png");
});

test("getMonDisplaySpritePath never returns Johnw sprite for other species", () => {
  assert.notEqual(getMonDisplaySpritePath({ name: "Anago", rarity: "Common" }), "128x128/johnw-idle.gif");
  assert.notEqual(getMonDisplaySpritePath({ name: "Molandak", rarity: "Legendary" }), "128x128/johnw-idle.gif");
});

test("getMonDisplaySpritePath uses idle GIF for Legendary when confirmed", () => {
  assert.equal(
    getMonDisplaySpritePath({ name: "Anago", rarity: "Legendary" }),
    "128x128/anago-idle.gif"
  );
});

test("getMonDisplaySpritePath uses PNG for Legendary when GIF not confirmed", () => {
  assert.equal(
    getMonDisplaySpritePath({ name: "Lyraffe", rarity: "Legendary" }),
    "128x128/lyraffe.png"
  );
});

test("getMonDisplaySpritePath uses generic GIF for Legendary Molandak", () => {
  assert.equal(
    getMonDisplaySpritePath({ name: "Molandak", rarity: "Legendary" }),
    "128x128/molandak.gif"
  );
});

test("getLegendaryCardGifPath returns null for unconfirmed species", () => {
  assert.equal(getLegendaryCardGifPath("Shramp"), null);
});

test("getPngPath resolves rename display names", () => {
  assert.equal(getPngPath("Moxy"), "128x128/monhorse.png");
});

test("speciesHasSceneIdle is false when idle GIF is not confirmed", () => {
  assert.equal(speciesHasSceneIdle("Lyraffe"), false);
  assert.equal(speciesHasSceneIdle("Spidermon"), false);
});

test("speciesHasSceneIdle is true when scene idle is confirmed", () => {
  assert.equal(speciesHasSceneIdle("Anago"), true);
  assert.equal(speciesHasSceneIdle("Monhorse"), true);
  assert.equal(speciesHasSceneIdle("Monigga"), true);
  assert.equal(speciesHasSceneIdle("Mosferatu"), true);
});

test("getPngPath resolves Monigga and legacy Mosferatu rename", () => {
  assert.equal(getPngPath("Monigga"), "128x128/monigga.png");
  assert.equal(getPngPath("Mosferatu"), "128x128/monigga.png");
});

test("getMonDisplaySpriteCandidates always includes PNG fallback", () => {
  const candidates = getMonDisplaySpriteCandidates({ name: "Lyraffe", rarity: "Legendary" });
  assert.ok(candidates.includes("128x128/lyraffe.png"));
  assert.equal(candidates[0], "128x128/lyraffe.png");
  assert.ok(!candidates.includes("128x128/lyraffe-idle.gif"));
});
