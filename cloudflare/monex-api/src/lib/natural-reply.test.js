import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNaturalCatchReply,
  buildNaturalInvalidDenomReply,
  getReplySeed,
} from "./natural-reply.js";

test("natural catch reply reads like human text", () => {
  const results = [
    { escaped: false, mon: { name: "Chog", rarity: "Rare" } },
    { escaped: true, name: "Mouch", rarity: "Common" },
    { escaped: false, mon: { name: "Salmonad", rarity: "Uncommon" } },
  ];

  const text = buildNaturalCatchReply({
    username: "jeric",
    monballSpend: 10,
    results,
    monballsLeft: 0,
    seed: 42,
  });

  assert.ok(text.startsWith("@jeric"));
  assert.ok(/caught/i.test(text));
  assert.ok(text.includes("Chog"));
  assert.ok(text.includes("Mouch"));
  assert.ok(text.includes("Visit the site"));
  assert.equal(text.includes("http"), false);
  assert.ok(text.length <= 280);
});

test("invalid denom has varied natural wording", () => {
  const a = buildNaturalInvalidDenomReply("jeric", 1);
  const b = buildNaturalInvalidDenomReply("jeric", 2);
  assert.notEqual(a, b);
});

test("reply seed is stable per tweet", () => {
  const seedA = getReplySeed({ id: "1", authorId: "9", text: "catch" });
  const seedB = getReplySeed({ id: "1", authorId: "9", text: "catch" });
  assert.equal(seedA, seedB);
});
