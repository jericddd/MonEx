import test from "node:test";
import assert from "node:assert/strict";
import {
  RULES_VERSION,
  rollMint,
  rarityFromRoll,
  parseMention,
  isValidWallet,
  speciesIdFromHint,
  utcDayIndex,
} from "./rules.js";

test("RULES_VERSION is 1", () => {
  assert.equal(RULES_VERSION, 1);
});

test("rarityFromRoll matches frozen weights", () => {
  assert.equal(rarityFromRoll(0), 0);
  assert.equal(rarityFromRoll(6999), 0);
  assert.equal(rarityFromRoll(7000), 1);
  assert.equal(rarityFromRoll(8999), 1);
  assert.equal(rarityFromRoll(9000), 2);
  assert.equal(rarityFromRoll(9799), 2);
  assert.equal(rarityFromRoll(9800), 3);
});

test("parseMention mint and link", () => {
  assert.deepEqual(parseMention("@CatchCard mint spark"), {
    command: "mint",
    args: ["spark"],
  });
  assert.deepEqual(parseMention("@CatchCard mint"), { command: "mint", args: [] });
  assert.deepEqual(parseMention("@CatchCard link 0x" + "a".repeat(40)), {
    command: "link",
    args: ["0x" + "a".repeat(40)],
  });
});

test("species hints", () => {
  assert.equal(speciesIdFromHint("volt"), 4);
  assert.equal(speciesIdFromHint("nope"), null);
});

test("wallet validation", () => {
  assert.equal(isValidWallet("0x" + "b".repeat(40)), true);
  assert.equal(isValidWallet("0xshort"), false);
});

test("rollMint deterministic with mock rolls", () => {
  const rolls = [100, 5000, 100, 2000];
  let i = 0;
  const rollFn = () => rolls[i++ % rolls.length];
  const result = rollMint(rollFn, "spark");
  assert.equal(result.rarity, 0);
  assert.equal(result.speciesId, 0);
});

test("utcDayIndex", () => {
  assert.equal(typeof utcDayIndex(), "number");
});
