import test from "node:test";
import assert from "node:assert/strict";
import { formatCatchReply } from "./catch-engine.js";

test("lists all throws with escapes and no URL", () => {
  const results = Array.from({ length: 10 }, (_, i) =>
    i % 3 === 0
      ? { escaped: true, name: "Mouch", rarity: "Common" }
      : { escaped: false, mon: { name: "Chog", rarity: "Rare", level: 1, skills: [] } }
  );

  const text = formatCatchReply({
    username: "jeric",
    monballSpend: 10,
    results,
    monballsLeft: 0,
  });

  assert.ok(text.includes("@jeric"));
  assert.ok(text.includes("✗ Mouch escaped"));
  assert.ok(text.includes("✓ Chog"));
  assert.ok(text.includes("Monballs left: 0"));
  assert.ok(text.includes("Visit site to play the game"));
  assert.equal(text.includes("http"), false);
  assert.ok(text.length <= 280);
});
