import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMention } from "./parse-mention.js";

const BOT = "monexmonad";

test("accepts @mention in a standalone tweet", () => {
  const r = parseMention("@monexmonad catch 10 monanimals", BOT);
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 10);
});

test("accepts @mention in a reply", () => {
  const r = parseMention("@monexmonad catch 20", BOT);
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 20);
});

test("ignores reply without @monexmonad", () => {
  const r = parseMention("catch 10 monanimals", BOT);
  assert.equal(r.type, "ignore");
});

test("ignores tweet that does not mention the bot", () => {
  const r = parseMention("catch 10 monanimals", BOT);
  assert.equal(r.type, "ignore");
});
