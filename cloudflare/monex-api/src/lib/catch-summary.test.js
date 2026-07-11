import test from "node:test";
import assert from "node:assert/strict";
import {
  formatRaritySummary,
  pickHighlightMons,
  buildCatchSummaryFields,
} from "./catch-summary.js";
import { buildNaturalCatchReply } from "./natural-reply.js";

test("formats rarity summary counts", () => {
  const caught = [
    { mon: { name: "Chog", rarity: "Legendary" } },
    { mon: { name: "Anago", rarity: "Legendary" } },
    { mon: { name: "Mouch", rarity: "Common" } },
    { mon: { name: "Salmonad", rarity: "Uncommon" } },
    { mon: { name: "Lyraffe", rarity: "Legendary" } },
  ];
  const summary = formatRaritySummary(caught);
  assert.ok(summary.includes("3 Legendary"));
  assert.ok(summary.includes("1 Common"));
  assert.ok(summary.includes("1 Uncommon"));
});

test("picks at least three highlight mons by rarity", () => {
  const caught = Array.from({ length: 20 }, (_, i) => ({
    mon: {
      name: `Mon${i}`,
      rarity: i < 2 ? "Legendary" : i < 8 ? "Rare" : "Common",
    },
  }));
  const highlights = pickHighlightMons(caught, 3, 7);
  assert.ok(highlights.includes("Legendary"));
  const parts = highlights.split(/, | and /);
  assert.ok(parts.length >= 3);
});

test("large catch reply stays compact under 280 chars", () => {
  const results = Array.from({ length: 10 }, (_, i) => ({
    escaped: i % 4 === 0,
    name: `Esc${i}`,
    mon: {
      name: `Mon${i}`,
      rarity: i < 2 ? "Legendary" : i < 5 ? "Rare" : i < 8 ? "Uncommon" : "Common",
    },
  })).map((r) => (r.escaped ? { escaped: true, name: r.name, rarity: "Common" } : { escaped: false, mon: r.mon }));

  const text = buildNaturalCatchReply({
    username: "jeric",
    monballSpend: 10,
    results,
    monballsLeft: 0,
    seed: 3,
    repliesLeftAfter: 4,
    dailyLimit: 4,
  });

  assert.ok(text.includes("Legendary"));
  assert.ok(/Standouts|Promising|carried|eyes on|standouts|keepers|lowkey|fwiw|field report/i.test(text));
  assert.ok(text.length <= 280);
  assert.equal(text.includes("Mon0, Mon1"), false);
});

test("summary fields include escaped note", () => {
  const caught = [{ mon: { name: "Chog", rarity: "Rare" } }];
  const escaped = [{ name: "Mouch" }, { name: "Anago" }];
  const fields = buildCatchSummaryFields(caught, escaped);
  assert.ok(fields.escapedNote.includes("got away"));
});
