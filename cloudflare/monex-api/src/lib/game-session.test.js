import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claimGameSession,
  getGameSessionStatus,
  heartbeatGameSession,
  isGameSessionStale,
  releaseGameSession,
  requireGameplaySession,
  GAME_SESSION_STALE_MS,
} from "./game-session.js";

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

function makeRequest(gameSessionId, sessionOpenedAt = null) {
  return {
    headers: {
      get(name) {
        if (name === "X-Game-Session-Id") return gameSessionId;
        if (name === "X-Game-Session-Opened-At") return sessionOpenedAt != null ? String(sessionOpenedAt) : null;
        return null;
      },
    },
  };
}

describe("claimGameSession", () => {
  it("registers the first session as active", async () => {
    const kv = makeKv();
    const result = await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(result.active, true);
    assert.equal(result.gameSessionId, "tab_a");
  });

  it("transfers active ownership to a newer session id", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    const result = await claimGameSession(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    assert.equal(result.tookOver, true);
    const statusA = await getGameSessionStatus(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(statusA.active, false);
    assert.equal(statusA.reason, "superseded");
    const statusB = await getGameSessionStatus(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    assert.equal(statusB.active, true);
  });

  it("rejects stale claim responses from older tabs", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    await claimGameSession(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    const lateClaim = await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(lateClaim.active, false);
    assert.equal(lateClaim.reason, "superseded");
    const statusB = await getGameSessionStatus(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    assert.equal(statusB.active, true);
  });

  it("refreshes the same tab without displacing itself", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    const refreshed = await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(refreshed.refreshed, true);
    const status = await getGameSessionStatus(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(status.active, true);
  });
});

describe("heartbeatGameSession", () => {
  it("keeps the active session alive", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    const beat = await heartbeatGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(beat.active, true);
  });

  it("reports superseded for inactive tabs", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    await claimGameSession(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    const beat = await heartbeatGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(beat.active, false);
    assert.equal(beat.reason, "superseded");
  });

  it("allows takeover when the active session is stale", async () => {
    const kv = makeKv();
    const staleAt = new Date(Date.now() - GAME_SESSION_STALE_MS - 1000).toISOString();
    await kv.put(
      "monex:active-game-session:user_1",
      JSON.stringify({ gameSessionId: "tab_a", claimedAt: staleAt, lastSeenAt: staleAt, openedAt: 1000 })
    );
    const beat = await heartbeatGameSession(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    assert.equal(beat.active, true);
    assert.equal(beat.tookOver, true);
  });
});

describe("requireGameplaySession", () => {
  it("rejects gameplay requests without a session header", async () => {
    const kv = makeKv();
    const auth = await requireGameplaySession({ headers: { get: () => null } }, kv, {
      xUserId: "user_1",
    });
    assert.equal(auth.ok, false);
    assert.equal(auth.error, "game_session_required");
  });

  it("auto-claims unclaimed sessions on gameplay requests", async () => {
    const kv = makeKv();
    const auth = await requireGameplaySession(
      { headers: { get: () => null } },
      kv,
      { xUserId: "user_1" },
      { gameSessionId: "tab_a", sessionOpenedAt: 1000 }
    );
    assert.equal(auth.ok, true);
    assert.equal(auth.gameSessionId, "tab_a");
    const status = await getGameSessionStatus(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(status.active, true);
  });

  it("rejects inactive gameplay sessions", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    const auth = await requireGameplaySession(
      makeRequest("tab_a", 1000),
      kv,
      { xUserId: "user_1" }
    );
    assert.equal(auth.ok, false);
    assert.equal(auth.error, "game_session_inactive");
    assert.equal(auth.reason, "superseded");
  });

  it("does not auto-reclaim superseded sessions on gameplay requests", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    const auth = await requireGameplaySession(
      makeRequest("tab_a", 1000),
      kv,
      { xUserId: "user_1" },
      { gameSessionId: "tab_a", sessionOpenedAt: 1000 }
    );
    assert.equal(auth.ok, false);
    const status = await getGameSessionStatus(kv, "user_1", "tab_b", { sessionOpenedAt: 2000 });
    assert.equal(status.active, true);
  });

  it("accepts game session id from JSON body when header is missing", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    const auth = await requireGameplaySession(
      { headers: { get: () => null } },
      kv,
      { xUserId: "user_1" },
      { gameSessionId: "tab_a", sessionOpenedAt: 1000 }
    );
    assert.equal(auth.ok, true);
    assert.equal(auth.gameSessionId, "tab_a");
  });
});

describe("releaseGameSession", () => {
  it("clears active session only for the owning tab", async () => {
    const kv = makeKv();
    await claimGameSession(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    const released = await releaseGameSession(kv, "user_1", "tab_a");
    assert.equal(released.released, true);
    const status = await getGameSessionStatus(kv, "user_1", "tab_a", { sessionOpenedAt: 1000 });
    assert.equal(status.active, false);
    assert.equal(status.reason, "unclaimed");
  });
});

describe("isGameSessionStale", () => {
  it("detects expired heartbeats", () => {
    const stale = {
      lastSeenAt: new Date(Date.now() - GAME_SESSION_STALE_MS - 1).toISOString(),
    };
    assert.equal(isGameSessionStale(stale), true);
  });
});
