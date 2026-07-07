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

test("accepts direct reply to bot without repeating @mention", () => {
  const r = parseMention("catch 10 monanimals", BOT, { inReplyToBot: true });
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 10);
});

test("ignores unrelated reply without @mention or reply-to-bot", () => {
  const r = parseMention("catch 10 monanimals", BOT);
  assert.equal(r.type, "ignore");
});
