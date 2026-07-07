import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNaturalCatchReply,
  buildNaturalInvalidDenomReply,
  getReplySeed,
  CATCH_REPLY_TEMPLATE_SAMPLES,
  buildDailyLimitNoticeReply,
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
    repliesLeftAfter: 2,
    dailyLimit: 5,
  });

  assert.ok(text.startsWith("@jeric"));
  assert.ok(/caught|bagged|hooked|secured|stayed|in,/i.test(text));
  assert.ok(text.includes("Chog"));
  assert.ok(text.includes("Mouch"));
  assert.ok(/Visit the site|on the site/i.test(text));
  assert.ok(/@ replies left today: \d+\/5/.test(text));
  assert.equal(text.includes("http"), false);
  assert.ok(text.length <= 280);
});

test("invalid denom has varied natural wording", () => {
  const a = buildNaturalInvalidDenomReply("jeric", 1);
  const b = buildNaturalInvalidDenomReply("jeric", 2);
  assert.notEqual(a, b);
});

test("has at least 10 catch reply template samples", () => {
  assert.ok(CATCH_REPLY_TEMPLATE_SAMPLES.length >= 10);
});

test("last reply warns catches still work", () => {
  const results = [{ escaped: false, mon: { name: "Chog", rarity: "Rare" } }];
  const text = buildNaturalCatchReply({
    username: "jeric",
    monballSpend: 10,
    results,
    monballsLeft: 5,
    seed: 0,
    repliesLeftAfter: 0,
    dailyLimit: 5,
  });
  assert.ok(text.includes("No @ replies left today"));
  assert.ok(text.includes("Profile → X log"));
});

test("daily limit notice reassures player", () => {
  const text = buildDailyLimitNoticeReply("jeric", 5, 0);
  assert.ok(text.includes("catch still worked") || text.includes("Catches still count"));
  assert.ok(text.includes("Profile → X log"));
});

test("reply seed is stable per tweet", () => {
  const seedA = getReplySeed({ id: "1", authorId: "9", text: "catch" });
  const seedB = getReplySeed({ id: "1", authorId: "9", text: "catch" });
  assert.equal(seedA, seedB);
});
