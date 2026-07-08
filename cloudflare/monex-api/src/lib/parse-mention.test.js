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
  assert.equal(parseMention("catch 10 monanimals", BOT).type, "ignore");
  assert.equal(parseMention("@monexmonad catch 10 monanimals", BOT).type, "catch");
});

test("thread reply: catch without @mention", () => {
  const r = parseMention("catch 10 monanimals", BOT, { replyToBot: true });
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 10);
});

test("bare catch defaults to 10 in thread", () => {
  const r = parseMention("lets catch", BOT, { replyToBot: true });
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 10);
});

test("catch keywords anywhere in sentence (outside post)", () => {
  const r = parseMention("hey @monexmonad can we catch 20 monanimals today?", BOT);
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 20);
});

test("high priority denom beats default catch phrasing", () => {
  const r = parseCatchIntent("catch 10 monanimals but actually catch 30 monanimals");
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 30);
});

test("catch 20/30/40/50 variants", () => {
  for (const spend of [20, 30, 40, 50]) {
    const thread = parseMention(`please catch ${spend} monanimal`, BOT, { replyToBot: true });
    assert.equal(thread.spend, spend);
    const outside = parseMention(`@monexmonad catch ${spend}`, BOT);
    assert.equal(outside.spend, spend);
  }
});

test("catch 10 monanimal singular", () => {
  const r = parseMention("catch 10 monanimal", BOT, { replyToBot: true });
  assert.equal(r.type, "catch");
  assert.equal(r.spend, 10);
});

test("invalid denom", () => {
  const r = parseMention("@monexmonad catch 15 monanimals", BOT);
  assert.equal(r.type, "invalid_denom");
  assert.equal(r.raw, "15");
});

test("isReplyToBotTweet", () => {
  assert.equal(isReplyToBotTweet({ inReplyToUserId: BOT_ID }, BOT_ID), true);
  assert.equal(isReplyToBotTweet({ inReplyToUserId: "999" }, BOT_ID), false);
  assert.equal(isReplyToBotTweet({}, BOT_ID), false);
});
