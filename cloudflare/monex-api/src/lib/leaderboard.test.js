import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateMonPowerPreview,
  estimatePartyPowerPreview,
  formatCampaignLabel,
  getLeaderboard,
  buildLeaderboard,
} from "./leaderboard.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = typeof value === "string" ? value : String(value);
    },
    async list({ prefix } = {}) {
      const keys = Object.keys(store)
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

test("formatCampaignLabel maps global best to chapter/stage", () => {
  assert.equal(formatCampaignLabel(0), "Ch.1 Stage 0");
  assert.equal(formatCampaignLabel(1), "Ch.1 Stage 1");
  assert.equal(formatCampaignLabel(40), "Ch.1 Stage 40");
  assert.equal(formatCampaignLabel(41), "Ch.2 Stage 1");
});

test("estimateMonPowerPreview grows with level and rarity", () => {
  const common = estimateMonPowerPreview({ name: "Chog", level: 10, rarity: "Common" });
  const mythic = estimateMonPowerPreview({ name: "Chog", level: 10, rarity: "Mythic" });
  assert.ok(mythic > common);
  assert.ok(common > 0);
});

test("estimatePartyPowerPreview sums party only", () => {
  const party = [
    { name: "A", level: 5, rarity: "Common" },
    { name: "B", level: 5, rarity: "Common" },
  ];
  assert.equal(estimatePartyPowerPreview(party), estimateMonPowerPreview(party[0]) * 2);
  assert.equal(estimatePartyPowerPreview([]), 0);
});

test("campaign leaderboard ranks by adventureGlobalBest", async () => {
  const store = {
    "monex:save:1": JSON.stringify({
      xHandle: "alice",
      adventureGlobalBest: 12,
      party: [{ level: 1, rarity: "Common" }],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
    "monex:save:2": JSON.stringify({
      xHandle: "bob",
      adventureGlobalBest: 45,
      party: [{ level: 1, rarity: "Common" }],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
    "monex:save:3": JSON.stringify({
      xHandle: "cara",
      adventureGlobalBest: 45,
      party: [{ level: 1, rarity: "Common" }],
      updatedAt: "2026-07-24T01:00:00.000Z",
    }),
  };
  const result = await buildLeaderboard(makeKv(store), "campaign", { limit: 10 });
  assert.equal(result.ok, true);
  // Same score: earlier updatedAt ranks higher (bob before cara).
  assert.equal(result.entries[0].username, "bob");
  assert.equal(result.entries[0].score, 45);
  assert.equal(result.entries[0].label, "Ch.2 Stage 5");
  assert.equal(result.entries[1].username, "cara");
  assert.equal(result.entries[2].username, "alice");
});

test("power leaderboard ranks by party preview score", async () => {
  const store = {
    "monex:save:1": JSON.stringify({
      xHandle: "weak",
      adventureGlobalBest: 99,
      party: [{ level: 2, rarity: "Common" }],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
    "monex:save:2": JSON.stringify({
      xHandle: "strong",
      adventureGlobalBest: 1,
      party: [
        { level: 20, rarity: "Mythic", ascensionStars: 2 },
        { level: 18, rarity: "Legendary" },
      ],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
  };
  const result = await getLeaderboard(makeKv(store), "power", { limit: 5, bypassCache: true });
  assert.equal(result.ok, true);
  assert.equal(result.preview, true);
  assert.equal(result.entries[0].username, "strong");
  assert.ok(result.entries[0].score > result.entries[1].score);
});

test("getLeaderboard rejects invalid board", async () => {
  const result = await getLeaderboard(makeKv({}), "nope");
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_board");
});
