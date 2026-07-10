/**
 * Duplicate-tab regression test.
 *
 * Browsers COPY sessionStorage when a tab is duplicated, so a duplicated
 * /play tab inherits the original's game session ID and both tabs would look
 * like one session to the server (no takeover, no modal, both playable).
 *
 * This test loads the REAL js/game-session-client.js into VM "tabs" that
 * share localStorage + a fake BroadcastChannel (same browser profile), copies
 * sessionStorage to simulate duplication, and drives the REAL server modules.
 *
 * Verifies:
 *  - duplicated tab mints a brand-new session ID and takes over
 *  - the original tab is superseded (blocking modal callback fires)
 *  - refresh keeps the same session ID (no false takeover)
 *  - duplicating an inactive tab also mints a new ID and becomes active
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import {
  claimGameSession,
  getGameSessionStatus,
  heartbeatGameSession,
} from "./game-session.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const CLIENT_SRC = readFileSync(join(repoRoot, "js", "game-session-client.js"), "utf8");

const XUSER = "dup_user_1";

function makeKv() {
  const store = new Map();
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

function makeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _snapshot: () => Object.fromEntries(map),
  };
}

/** Fake BroadcastChannel hub shared across tab contexts (one browser profile). */
function makeBroadcastHub() {
  const instances = new Set();
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this._listeners = [];
      this._closed = false;
      instances.add(this);
    }
    addEventListener(type, fn) {
      if (type === "message") this._listeners.push(fn);
    }
    postMessage(data) {
      if (this._closed) return;
      for (const other of instances) {
        if (other === this || other._closed || other.name !== this.name) continue;
        queueMicrotask(() => {
          if (!other._closed) other._listeners.forEach((fn) => fn({ data }));
        });
      }
    }
    close() {
      this._closed = true;
      instances.delete(this);
    }
  }
  return { FakeBroadcastChannel, instances };
}

function makeServer(kv) {
  return async function serverFetch(url, init = {}) {
    const u = new URL(url, "https://api.test");
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : {};
    const respond = (data, status = 200) => ({
      ok: status < 300,
      status,
      json: async () => data,
      clone() { return this; },
    });
    if (u.pathname === "/api/game-session/claim" && method === "POST") {
      const r = await claimGameSession(kv, XUSER, body.gameSessionId, { sessionOpenedAt: body.sessionOpenedAt });
      return respond(r, r.ok ? 200 : 400);
    }
    if (u.pathname === "/api/game-session/status" && method === "GET") {
      const r = await getGameSessionStatus(kv, XUSER, u.searchParams.get("gameSessionId"), {
        sessionOpenedAt: Number(u.searchParams.get("sessionOpenedAt")) || 0,
      });
      return respond(r, r.ok ? 200 : 400);
    }
    if (u.pathname === "/api/game-session/heartbeat" && method === "POST") {
      const r = await heartbeatGameSession(kv, XUSER, body.gameSessionId, { sessionOpenedAt: body.sessionOpenedAt });
      return respond(r, r.ok ? 200 : 400);
    }
    return respond({ ok: false, error: "not_found" }, 404);
  };
}

function makeBrowserProfile() {
  const kv = makeKv();
  const localStorage = makeStorage({
    monex_session_token: "tok_dup",
    monex_user: JSON.stringify({ xUserId: XUSER, username: "duptester" }),
  });
  const hub = makeBroadcastHub();
  const serverFetch = makeServer(kv);
  return { kv, localStorage, hub, serverFetch };
}

function openTab(profile, { sessionStorageSeed = {}, name }) {
  const flags = { superseded: 0, active: 0 };
  const pagehideListeners = [];
  const windowStub = {
    addEventListener: (type, fn) => {
      if (type === "pagehide") pagehideListeners.push(fn);
    },
    location: { hash: "", search: "", pathname: "/play/", hostname: "localhost" },
    MONEX_API: "https://api.test",
  };
  const sessionStorage = makeStorage(sessionStorageSeed);
  const sandbox = {
    window: windowStub,
    document: {
      hidden: false,
      visibilityState: "visible",
      addEventListener: () => {},
      getElementById: () => null,
      body: { classList: { add: () => {}, remove: () => {} } },
    },
    localStorage: profile.localStorage,
    sessionStorage,
    location: windowStub.location,
    console: { info: () => {}, warn: () => {}, error: () => {}, log: () => {} },
    crypto: webcrypto,
    URL,
    URLSearchParams,
    fetch: profile.serverFetch,
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    BroadcastChannel: profile.hub.FakeBroadcastChannel,
    MonExAuth: { isLoggedIn: () => true, getUsername: () => "duptester", authHeaders: () => ({}) },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, ctx, { filename: `${name}:game-session-client.js` });
  const gs = windowStub.MonExGameSession;
  gs.startSessionGuard({
    onSuperseded: () => { flags.superseded++; },
    onActive: () => { flags.active++; },
  });
  const tab = {
    name,
    gs,
    flags,
    sessionStorage,
    firePagehide: () => pagehideListeners.forEach((fn) => fn()),
    kill: () => {
      // Simulate the document being destroyed: its channels stop responding.
      for (const inst of [...profile.hub.instances]) {
        if (inst._ownerTab === tab) inst.close();
      }
      tab._dead = true;
    },
  };
  // Tag hub instances created by this tab for kill().
  for (const inst of profile.hub.instances) {
    if (!inst._ownerTab) inst._ownerTab = tab;
  }
  return tab;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("duplicate tab detection", () => {
  it("duplicated tab mints a new session and supersedes the original", async () => {
    const profile = makeBrowserProfile();

    const tabA = openTab(profile, { name: "A" });
    await tabA.gs.claimActiveSession();
    assert.equal(tabA.gs.isActive(), true, "tab A active after boot");
    const idA = tabA.gs.getGameSessionId();
    assert.ok(idA, "tab A has a session id");

    // Duplicate: browser copies sessionStorage while tab A is still alive.
    const tabB = openTab(profile, {
      name: "B",
      sessionStorageSeed: tabA.sessionStorage._snapshot(),
    });
    await tabB.gs.claimActiveSession();
    await settle();

    const idB = tabB.gs.getGameSessionId();
    assert.notEqual(idB, idA, "duplicated tab minted a brand-new session id");
    assert.equal(tabB.gs.isActive(), true, "duplicated tab is the active session");
    assert.equal(tabA.gs.isSuperseded(), true, "original tab superseded");
    assert.ok(tabA.flags.superseded >= 1, "original tab modal callback fired");
    assert.equal(tabA.gs.isGameplayAllowed(), false, "original tab gameplay blocked");

    // Server agrees.
    const statusA = await getGameSessionStatus(profile.kv, XUSER, idA, {});
    assert.equal(statusA.active, false);
    const statusB = await getGameSessionStatus(profile.kv, XUSER, idB, {});
    assert.equal(statusB.active, true);
  });

  it("multiple duplicates: each mints a unique id, newest wins", async () => {
    const profile = makeBrowserProfile();
    const tabA = openTab(profile, { name: "A" });
    await tabA.gs.claimActiveSession();

    const tabB = openTab(profile, { name: "B", sessionStorageSeed: tabA.sessionStorage._snapshot() });
    await tabB.gs.claimActiveSession();
    await settle();

    const tabC = openTab(profile, { name: "C", sessionStorageSeed: tabB.sessionStorage._snapshot() });
    await tabC.gs.claimActiveSession();
    await settle();

    const ids = [tabA.gs.getGameSessionId(), tabB.gs.getGameSessionId(), tabC.gs.getGameSessionId()];
    assert.equal(new Set(ids).size, 3, "three distinct session ids");
    assert.equal(tabC.gs.isActive(), true, "newest duplicate active");
    assert.equal(tabB.gs.isSuperseded(), true, "middle tab superseded");
    assert.equal(tabA.gs.isSuperseded(), true, "oldest tab superseded");
  });

  it("refresh keeps the same session id (no false takeover)", async () => {
    const profile = makeBrowserProfile();
    const tabA = openTab(profile, { name: "A" });
    await tabA.gs.claimActiveSession();
    const idBefore = tabA.gs.getGameSessionId();

    // Refresh: pagehide releases the lock, document dies, new document boots
    // with the SAME sessionStorage.
    tabA.firePagehide();
    tabA.kill();
    const tabA2 = openTab(profile, {
      name: "A2",
      sessionStorageSeed: tabA.sessionStorage._snapshot(),
    });
    await tabA2.gs.claimActiveSession();

    assert.equal(tabA2.gs.getGameSessionId(), idBefore, "refresh adopted the same session id");
    assert.equal(tabA2.gs.isActive(), true, "refreshed tab active");
  });

  it("duplicating an inactive (superseded) tab creates a new ACTIVE session", async () => {
    const profile = makeBrowserProfile();
    const tabA = openTab(profile, { name: "A" });
    await tabA.gs.claimActiveSession();

    const tabB = openTab(profile, { name: "B", sessionStorageSeed: tabA.sessionStorage._snapshot() });
    await tabB.gs.claimActiveSession();
    await settle();
    assert.equal(tabA.gs.isSuperseded(), true, "tab A inactive before duplication");

    // Duplicate the INACTIVE tab A.
    const tabD = openTab(profile, { name: "D", sessionStorageSeed: tabA.sessionStorage._snapshot() });
    await tabD.gs.claimActiveSession();
    await settle();

    assert.notEqual(tabD.gs.getGameSessionId(), tabA.gs.getGameSessionId(), "new id minted");
    assert.equal(tabD.gs.isActive(), true, "duplicate of inactive tab becomes active");
    assert.equal(tabB.gs.isSuperseded(), true, "previously active tab superseded");
  });

  it("refresh of a duplicated tab keeps its own id", async () => {
    const profile = makeBrowserProfile();
    const tabA = openTab(profile, { name: "A" });
    await tabA.gs.claimActiveSession();
    const tabB = openTab(profile, { name: "B", sessionStorageSeed: tabA.sessionStorage._snapshot() });
    await tabB.gs.claimActiveSession();
    await settle();
    const idB = tabB.gs.getGameSessionId();

    tabB.firePagehide();
    tabB.kill();
    const tabB2 = openTab(profile, { name: "B2", sessionStorageSeed: tabB.sessionStorage._snapshot() });
    await tabB2.gs.claimActiveSession();

    assert.equal(tabB2.gs.getGameSessionId(), idB, "refreshed duplicate keeps its minted id");
    assert.equal(tabB2.gs.isActive(), true, "refreshed duplicate stays active");
  });
});
