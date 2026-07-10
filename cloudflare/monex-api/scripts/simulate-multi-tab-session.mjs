/**
 * Simulates two /play tabs against in-memory KV to verify single-session enforcement.
 * Run: node cloudflare/monex-api/scripts/simulate-multi-tab-session.mjs
 */
import {
  claimGameSession,
  getGameSessionStatus,
  heartbeatGameSession,
  requireGameplaySession,
} from "../src/lib/game-session.js";

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

function makeRequest(tabId, openedAt) {
  return {
    headers: {
      get(name) {
        if (name === "X-Game-Session-Id") return tabId;
        if (name === "X-Game-Session-Opened-At") return String(openedAt);
        return null;
      },
    },
  };
}

async function tabState(kv, tabId, openedAt) {
  return getGameSessionStatus(kv, "user_1", tabId, { sessionOpenedAt: openedAt });
}

async function run() {
  const kv = makeKv();
  const tabA = { id: "tab_a", openedAt: 1000 };
  const tabB = { id: "tab_b", openedAt: 2000 };
  const session = { xUserId: "user_1" };

  console.log("1. Tab A opens and claims");
  await claimGameSession(kv, session.xUserId, tabA.id, { sessionOpenedAt: tabA.openedAt });
  assert((await tabState(kv, tabA.id, tabA.openedAt)).active, "Tab A should be active");

  console.log("2. Tab B opens and takes over");
  await claimGameSession(kv, session.xUserId, tabB.id, { sessionOpenedAt: tabB.openedAt });
  assert(!(await tabState(kv, tabA.id, tabA.openedAt)).active, "Tab A should be inactive");
  assert((await tabState(kv, tabA.id, tabA.openedAt)).reason === "superseded", "Tab A superseded");
  assert((await tabState(kv, tabB.id, tabB.openedAt)).active, "Tab B should be active");

  console.log("3. Tab A late claim response cannot steal");
  const late = await claimGameSession(kv, session.xUserId, tabA.id, { sessionOpenedAt: tabA.openedAt });
  assert(!late.active && late.reason === "superseded", "Late Tab A claim rejected");
  assert((await tabState(kv, tabB.id, tabB.openedAt)).active, "Tab B still active");

  console.log("4. Tab A gameplay API rejected");
  const blocked = await requireGameplaySession(makeRequest(tabA.id, tabA.openedAt), kv, session);
  assert(!blocked.ok && blocked.error === "game_session_inactive", "Tab A gameplay blocked");

  console.log("5. Tab B gameplay API accepted");
  const allowed = await requireGameplaySession(makeRequest(tabB.id, tabB.openedAt), kv, session);
  assert(allowed.ok, "Tab B gameplay allowed");

  console.log("6. Tab A heartbeat reports superseded");
  const beat = await heartbeatGameSession(kv, session.xUserId, tabA.id, { sessionOpenedAt: tabA.openedAt });
  assert(!beat.active && beat.reason === "superseded", "Tab A heartbeat superseded");

  console.log("7. Tab B heartbeat keeps active");
  const beatB = await heartbeatGameSession(kv, session.xUserId, tabB.id, { sessionOpenedAt: tabB.openedAt });
  assert(beatB.active, "Tab B heartbeat active");

  console.log("\nAll multi-tab simulation checks passed.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

run().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
