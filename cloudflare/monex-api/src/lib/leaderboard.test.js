import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCampaignLabel,
  getLeaderboard,
  buildLeaderboard,
} from "./leaderboard.js";
import { getMonPower, getPartyPower } from "./power-rating.js";

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

function sampleMon(overrides = {}) {
  return {
    level: 10,
    rarity: "Common",
    ascensionStars: 0,
    stats: { spd: 90, crit: 22, dodge: 22, block: 22, hit: 22, pierce: 22 },
    skills: [{ name: "u" }, { name: "p" }, { name: "a" }, { name: "b" }],
    equipment: {},
    ...overrides,
  };
}

test("formatCampaignLabel maps global best to chapter/stage", () => {
  assert.equal(formatCampaignLabel(0), "Ch.1 Stage 0");
  assert.equal(formatCampaignLabel(1), "Ch.1 Stage 1");
  assert.equal(formatCampaignLabel(40), "Ch.1 Stage 40");
  assert.equal(formatCampaignLabel(41), "Ch.2 Stage 1");
});

test("campaign leaderboard ranks by adventureGlobalBest", async () => {
  const store = {
    "monex:save:1": JSON.stringify({
      xHandle: "alice",
      adventureGlobalBest: 12,
      party: [sampleMon()],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
    "monex:save:2": JSON.stringify({
      xHandle: "bob",
      adventureGlobalBest: 45,
      party: [sampleMon()],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
    "monex:save:3": JSON.stringify({
      xHandle: "cara",
      adventureGlobalBest: 45,
      party: [sampleMon()],
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

test("power leaderboard ranks by frozen party power", async () => {
  const weakParty = [sampleMon({ level: 2 })];
  const strongParty = [
    sampleMon({
      level: 40,
      rarity: "Mythic",
      ascensionStars: 3,
      stats: { spd: 140, crit: 70, dodge: 60, block: 60, hit: 60, pierce: 70 },
      skills: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}` })),
      equipment: { weapon: { bonuses: { atk: 40 } }, armor: { bonuses: { hp: 200 } } },
    }),
  ];
  const store = {
    "monex:save:1": JSON.stringify({
      xHandle: "weak",
      adventureGlobalBest: 99,
      party: weakParty,
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
    "monex:save:2": JSON.stringify({
      xHandle: "strong",
      adventureGlobalBest: 1,
      party: strongParty,
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
  };
  const result = await getLeaderboard(makeKv(store), "power", { limit: 5, bypassCache: true });
  assert.equal(result.ok, true);
  assert.equal(result.preview, false);
  assert.equal(result.entries[0].username, "strong");
  assert.equal(result.entries[0].score, getPartyPower(strongParty));
  assert.ok(result.entries[0].score > result.entries[1].score);
  assert.ok(result.entries[0].score > getMonPower(weakParty[0]));
});

test("leaderboard omits public-hidden test account", async () => {
  const store = {
    "monex:save:1": JSON.stringify({
      xHandle: "test",
      adventureGlobalBest: 999,
      party: [sampleMon({ level: 80, rarity: "Mythic" })],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
    "monex:save:2": JSON.stringify({
      xHandle: "alice",
      adventureGlobalBest: 10,
      party: [sampleMon()],
      updatedAt: "2026-07-24T00:00:00.000Z",
    }),
  };
  const campaign = await buildLeaderboard(makeKv(store), "campaign", { limit: 10 });
  assert.equal(campaign.entries.length, 1);
  assert.equal(campaign.entries[0].username, "alice");
  const power = await buildLeaderboard(makeKv(store), "power", { limit: 10 });
  assert.equal(power.entries.every((e) => e.username !== "test"), true);
});

test("getLeaderboard strips hidden users even from stale cache", async () => {
  const store = {
    "monex:leaderboard:v4:campaign": JSON.stringify({
      ok: true,
      board: "campaign",
      generatedAt: "2026-07-24T00:00:00.000Z",
      preview: false,
      entries: [
        { rank: 1, username: "test", score: 99, label: "Ch.3 Stage 19" },
        { rank: 2, username: "alice", score: 10, label: "Ch.1 Stage 10" },
      ],
    }),
  };
  const result = await getLeaderboard(makeKv(store), "campaign", { limit: 10 });
  assert.equal(result.cached, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].username, "alice");
  assert.equal(result.entries[0].rank, 1);
});

test("getLeaderboard rejects invalid board", async () => {
  const result = await getLeaderboard(makeKv({}), "nope");
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_board");
});
