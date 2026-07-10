/**
 * End-to-end two-tab simulation.
 *
 * Loads the REAL client scripts (auth-client.js + game-session-client.js) into
 * two isolated "browser tab" VM contexts, wired to the REAL server modules
 * (game-session.js, save.js) through a fetch stub over shared in-memory KV.
 *
 * Verifies:
 *  1. Tab A boots, claims the session, becomes active, can save.
 *  2. Tab B boots later, takes over; Tab A's next poll marks it superseded
 *     and fires the blocking-modal callback.
 *  3. Superseded Tab A cannot push cloud saves (client gate).
 *  4. Even bypassing the client gate, the server rejects Tab A's write (403).
 *  5. Tab B's saves persist with incrementing revisions; a stale-revision
 *     write is rejected with 409 revision_conflict (no rollback).
 *
 * Run: node scripts/e2e-two-tabs.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import {
  claimGameSession,
  getGameSessionStatus,
  heartbeatGameSession,
  requireGameplaySession,
  getGameSessionIdFromRequest,
  getSessionOpenedAtFromRequest,
} from "../src/lib/game-session.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "../src/lib/save.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const XUSER = "e2e_user_1";
const SESSION = { xUserId: XUSER, username: "e2etester" };

function makeKv() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

const kv = makeKv();

function headersGetter(init) {
  const h = init?.headers || {};
  return { headers: { get: (name) => h[name] ?? null } };
}

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, clone() { return this; } };
}

/** Minimal server router backed by real modules. */
async function serverFetch(url, init = {}) {
  const u = new URL(url, "https://api.test");
  const path = u.pathname;
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  const reqLike = headersGetter(init);

  if (path === "/api/game-session/claim" && method === "POST") {
    const result = await claimGameSession(kv, XUSER, body.gameSessionId, {
      sessionOpenedAt: body.sessionOpenedAt,
    });
    return jsonResponse(result, result.ok ? 200 : 400);
  }
  if (path === "/api/game-session/status" && method === "GET") {
    const result = await getGameSessionStatus(kv, XUSER, u.searchParams.get("gameSessionId"), {
      sessionOpenedAt: Number(u.searchParams.get("sessionOpenedAt")) || 0,
    });
    return jsonResponse(result, result.ok ? 200 : 400);
  }
  if (path === "/api/game-session/heartbeat" && method === "POST") {
    const result = await heartbeatGameSession(kv, XUSER, body.gameSessionId, {
      sessionOpenedAt: body.sessionOpenedAt,
    });
    return jsonResponse(result, result.ok ? 200 : 400);
  }
  if (path === "/api/save" && method === "GET") {
    const { found, save } = await loadCloudSave(kv, XUSER);
    return jsonResponse({ ok: true, found, save, user: { username: SESSION.username, xUserId: XUSER } });
  }
  if (path === "/api/save" && method === "PUT") {
    const gs = await requireGameplaySession(reqLike, kv, SESSION, body);
    if (!gs.ok) {
      return jsonResponse({ ok: false, error: gs.error, reason: gs.reason }, gs.status || 403);
    }
    const payload = buildSavePayload(body?.save || body, SESSION);
    const baseRevision = body?.baseRevision != null ? Number(body.baseRevision) : null;
    try {
      const saved = await writeCloudSave(kv, XUSER, payload, { expectedRevision: baseRevision });
      return jsonResponse({ ok: true, savedAt: saved.updatedAt, save: saved, revision: saved.revision });
    } catch (err) {
      if (err?.code === "stale_save" || err?.code === "revision_conflict") {
        return jsonResponse(
          { ok: false, error: err.code, save: err.existingSave, revision: err.currentRevision ?? err.existingSave?.revision },
          409
        );
      }
      throw err;
    }
  }
  if (path === "/api/auth/me") {
    return jsonResponse({ ok: true, user: { xUserId: XUSER, username: SESSION.username } });
  }
  return jsonResponse({ ok: false, error: "not_found" }, 404);
}

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

function makeTab(name, openedAt) {
  const flags = { supersededFired: 0, activeFired: 0 };
  const windowStub = {
    addEventListener: () => {},
    location: { hash: "", search: "", pathname: "/play/", hostname: "localhost" },
  };
  const sandbox = {
    window: windowStub,
    document: {
      hidden: false,
      visibilityState: "visible",
      addEventListener: () => {},
      getElementById: () => null,
      body: { classList: { add: () => {}, remove: () => {} } },
      documentElement: { appendChild: () => {} },
      head: { appendChild: () => {} },
    },
    localStorage: makeStorage({ monex_session_token: "tok_e2e", monex_user: JSON.stringify({ xUserId: XUSER, username: SESSION.username }) }),
    sessionStorage: makeStorage({
      monex_game_session_id: `tab_${name}`,
      monex_game_session_opened_at: String(openedAt),
    }),
    location: windowStub.location,
    history: { replaceState: () => {} },
    console,
    crypto: webcrypto,
    URL,
    URLSearchParams,
    fetch: serverFetch,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    BroadcastChannel: undefined,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const rel of ["js/auth-client.js", "js/game-session-client.js"]) {
    vm.runInContext(readFileSync(join(repoRoot, rel), "utf8"), ctx, { filename: `${name}:${rel}` });
    // In browsers, window properties are bare globals; mirror that in the VM.
    for (const key of ["MonExAuth", "MonExGameSession"]) {
      if (windowStub[key]) sandbox[key] = windowStub[key];
    }
  }
  const gs = windowStub.MonExGameSession;
  const auth = windowStub.MonExAuth;
  gs.startSessionGuard({
    onSuperseded: () => { flags.supersededFired++; },
    onActive: () => { flags.activeFired++; },
  });
  return { name, gs, auth, flags, window: windowStub };
}

function assert(cond, msg) {
  if (!cond) {
    console.error("FAILED:", msg);
    process.exit(1);
  }
  console.log("  ✓", msg);
}

async function main() {
  console.log("1. Tab A opens and claims the session");
  const tabA = makeTab("A", 1000);
  await tabA.gs.claimActiveSession();
  assert(tabA.gs.isActive(), "Tab A is active after claim");

  console.log("2. Tab A loads + saves (revision 1)");
  const loadA = await tabA.auth.loadCloudSave();
  assert(loadA.found === false, "no cloud save yet (new account)");
  const saveA1 = await tabA.auth.flushCloudSave({ money: 5000, monballs: 10, updatedAt: new Date().toISOString() });
  assert(saveA1 && !saveA1.conflict && saveA1.save.revision === 1, "Tab A save accepted at revision 1");

  console.log("3. Tab B opens later and takes over");
  const tabB = makeTab("B", 2000);
  await tabB.gs.claimActiveSession();
  assert(tabB.gs.isActive(), "Tab B is active after claim");

  console.log("4. Tab A polls and becomes superseded (blocking modal)");
  await tabA.gs.pollSessionStatus();
  assert(tabA.gs.isSuperseded(), "Tab A marked superseded via poll");
  assert(tabA.flags.supersededFired >= 1, "Tab A onSuperseded (modal) callback fired");
  assert(tabA.gs.isGameplayAllowed() === false, "Tab A gameplay blocked");

  console.log("5. Superseded Tab A cannot push saves (client gate)");
  const blockedPush = await tabA.auth.flushCloudSave({ money: 99999, monballs: 99, updatedAt: new Date().toISOString() });
  assert(blockedPush?.skipped === "game_session_inactive", "Tab A push skipped client-side");

  console.log("6. Even bypassing the client, the server rejects Tab A's write");
  const rawRes = await serverFetch("https://api.test/api/save", {
    method: "PUT",
    headers: { "X-Game-Session-Id": "tab_A", "X-Game-Session-Opened-At": "1000" },
    body: JSON.stringify({ save: { money: 99999 }, gameSessionId: "tab_A", sessionOpenedAt: 1000 }),
  });
  assert(rawRes.status === 403, "server returns 403 for inactive session write");

  console.log("7. Tab B loads latest state and saves; revision increments");
  const loadB = await tabB.auth.loadCloudSave();
  assert(loadB.found === true && loadB.save.money === 5000, "Tab B sees Tab A's persisted progress");
  const saveB1 = await tabB.auth.flushCloudSave({ money: 2000, monballs: 10, updatedAt: new Date().toISOString() });
  assert(saveB1 && !saveB1.conflict && saveB1.save.revision === 2, "Tab B save accepted at revision 2 (spent money)");

  console.log("8. Stale-revision write is rejected (rollback prevention)");
  const staleRes = await serverFetch("https://api.test/api/save", {
    method: "PUT",
    headers: { "X-Game-Session-Id": "tab_B", "X-Game-Session-Opened-At": "2000" },
    body: JSON.stringify({
      save: { money: 5000, updatedAt: new Date(Date.now() + 60000).toISOString() },
      gameSessionId: "tab_B",
      sessionOpenedAt: 2000,
      baseRevision: 1,
    }),
  });
  const staleData = await staleRes.json();
  assert(staleRes.status === 409 && staleData.error === "revision_conflict", "stale write rejected with revision_conflict");
  const { save: finalSave } = await loadCloudSave(kv, XUSER);
  assert(finalSave.money === 2000 && finalSave.revision === 2, "server state not rolled back (money=2000, rev=2)");

  console.log("9. Tab A heartbeat stays superseded; Tab B stays active");
  const beatA = await tabA.gs.sendHeartbeat();
  assert(beatA.active === false || beatA.reason === "superseded", "Tab A heartbeat superseded");
  await tabB.gs.pollSessionStatus();
  assert(tabB.gs.isActive(), "Tab B remains active");

  console.log("\nAll end-to-end two-tab checks passed.");
}

main().catch((err) => {
  console.error("E2E FAILED:", err);
  process.exit(1);
});
