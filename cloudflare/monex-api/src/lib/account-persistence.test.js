import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requireGameplaySession } from "./game-session.js";
import { loadCloudSave } from "./save.js";

function makeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

describe("account persistence", () => {
  it("loads cloud save by xUserId regardless of game session", async () => {
    const kv = makeKv();
    const xUserId = "twitter_user_123";
    const save = {
      party: [{ name: "Chog", rarity: "Rare", level: 5 }],
      box: [],
      monballs: 7,
      money: 9000,
      updatedAt: "2026-06-01T00:00:00.000Z",
      saveVersion: 2,
    };
    await kv.put(`monex:save:${xUserId}`, JSON.stringify(save));

    const loaded = await loadCloudSave(kv, xUserId);
    assert.equal(loaded.found, true);
    assert.equal(loaded.save.monballs, 7);
    assert.equal(loaded.save.party.length, 1);
  });

  it("does not auto-create gameplay session when loading save fails validation", async () => {
    const kv = makeKv();
    await kv.put(
      "monex:active-game-session:user_1",
      JSON.stringify({
        gameSessionId: "tab_b",
        claimedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        openedAt: Date.now(),
      })
    );

    const auth = await requireGameplaySession(
      {
        headers: {
          get(name) {
            if (name === "X-Game-Session-Id") return "tab_a";
            if (name === "X-Game-Session-Opened-At") return "1000";
            return null;
          },
        },
      },
      kv,
      { xUserId: "user_1" }
    );
    assert.equal(auth.ok, false);
    assert.equal(auth.error, "game_session_inactive");
  });
});
