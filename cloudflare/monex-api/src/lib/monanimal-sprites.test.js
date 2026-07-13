import test from "node:test";
import assert from "node:assert/strict";
import {
  getMonDisplaySpritePath,
  getLegendaryCardGifPath,
  getPngPath,
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
