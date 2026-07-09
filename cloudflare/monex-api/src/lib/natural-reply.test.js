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
    dailyLimit: 4,
  });

  assert.ok(!text.startsWith("@jeric"));
  assert.ok(/Legendary|Rare|Uncommon|Common/.test(text));
  assert.ok(
    /carried|eyes on|standouts|keepers|lowkey|fwiw|field report|respectable|peep|look proper|stood out|this one hits|might be it|cooked|kind-ish|pulled|not bad/i.test(
      text
    )
  );
  assert.equal(text.includes("http"), false);
  assert.ok(/monexmonad|Profile → X log|your box|in game/i.test(text));
  assert.ok(/@ replies.*\d+\/4/i.test(text));
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
    dailyLimit: 4,
  });
  assert.ok(text.includes("out of @ replies for today (4/4)") || text.includes("daily @ reply cap hit (4/4)") || text.includes("no @ replies left today (4/4)"));
  assert.ok(/catch commands still work|can still catch|catches still run/i.test(text));
  assert.ok(text.includes("Profile → X log"));
});

test("daily limit notice reassures player", () => {
  const text = buildDailyLimitNoticeReply("jeric", 4, 0);
  assert.ok(/catch commands still work|can still catch|catches still run/i.test(text));
  assert.ok(/catch 1|catch 1–50|tag catch|using catch/i.test(text));
  assert.ok(text.includes("Profile → X log"));
});

test("daily limit notice variants mention catch command", () => {
  const a = buildDailyLimitNoticeReply("jeric", 4, 0);
  const b = buildDailyLimitNoticeReply("jeric", 4, 1);
  const c = buildDailyLimitNoticeReply("jeric", 4, 2);
  for (const text of [a, b, c]) {
    assert.ok(/catch/i.test(text));
    assert.ok(text.length <= 280);
  }
});

test("fourth reply embeds daily cap notice", () => {
  const results = [{ escaped: false, mon: { name: "Chog", rarity: "Rare" } }];
  const text = buildNaturalCatchReply({
    username: "jeric",
    monballSpend: 10,
    results,
    monballsLeft: 0,
    seed: 0,
    repliesLeftAfter: 0,
    dailyLimit: 4,
  });
  assert.ok(/\(4\/4\)/.test(text));
  assert.ok(/catch commands still work|can still catch|catches still run/i.test(text));
  assert.ok(/tag @monexmonad catch|keep using catch|tag catch anytime/i.test(text));
});

test("reply seed is stable per tweet", () => {
  const seedA = getReplySeed({ id: "1", authorId: "9", text: "catch" });
  const seedB = getReplySeed({ id: "1", authorId: "9", text: "catch" });
  assert.equal(seedA, seedB);
});
