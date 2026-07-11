import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMention,
  parseCatchIntent,
  isReplyToBotTweet,
} from "./parse-mention.js";

const BOT = "monexmonad";
const BOT_ID = "12345";

test("outside post: requires @monexmonad in sentence", () => {
  assert.equal(parseMention("catch 1 monanimal", BOT).type, "ignore");
  assert.equal(parseMention("@monexmonad catch 1 monanimal", BOT).type, "catch");
});

test("thread reply: catch without @mention", () => {
  const r = parseMention("catch 3 monanimals", BOT, { replyToBot: true });
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 3);
});

test("bare catch defaults to 1 in thread", () => {
  const r = parseMention("lets catch", BOT, { replyToBot: true });
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 1);
});

test("catch keywords anywhere in sentence (outside post)", () => {
  const r = parseMention("hey @monexmonad can we catch 8 monanimals today?", BOT);
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 8);
});

test("high priority denom beats lower catch phrasing", () => {
  const r = parseCatchIntent("catch 5 monanimals but actually catch 10 monanimals");
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 10);
});

test("catch 1 through 6 variants", () => {
  for (const spend of [1, 2, 3, 4, 5, 6]) {
    const thread = parseMention(`please catch ${spend} monanimal`, BOT, { replyToBot: true });
    assert.equal(thread.spend, spend);
    const outside = parseMention(`@monexmonad catch ${spend}`, BOT);
    assert.equal(outside.spend, spend);
  }
});

test("catch 10 max", () => {
  const r = parseMention("@monexmonad catch 10 monanimals", BOT);
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 10);
});

test("catch 1 monanimal singular", () => {
  const r = parseMention("catch 1 monanimal", BOT, { replyToBot: true });
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 1);
});

test("invalid denom below min", () => {
  const r = parseMention("@monexmonad catch 0 monanimals", BOT);
  assert.equal(r.type, "invalid_denom");
  assert.equal(r.raw, "0");
});

test("invalid denom above max", () => {
  const r = parseMention("@monexmonad catch 11 monanimals", BOT);
  assert.equal(r.type, "invalid_denom");
  assert.equal(r.raw, "11");
});

test("valid mid-range denom", () => {
  const r = parseMention("@monexmonad catch 7 monanimals", BOT);
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 7);
});

test("isReplyToBotTweet", () => {
  assert.equal(isReplyToBotTweet({ inReplyToUserId: BOT_ID }, BOT_ID), true);
  assert.equal(isReplyToBotTweet({ inReplyToUserId: "999" }, BOT_ID), false);
  assert.equal(isReplyToBotTweet({}, BOT_ID), false);
});
