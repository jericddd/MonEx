/**
 * Regression test: execute every classic <script> file loaded by play/index.html
 * and index.html in ONE shared global scope, exactly like a browser does.
 *
 * Classic scripts share the global lexical scope. A top-level const/let name
 * collision between two files (or an ESM `export` statement) is a parse-time
 * SyntaxError that silently kills the entire file. This exact bug shipped to
 * production: auth-client.js and game-session-client.js both declared
 * `const GAME_SESSION_STORAGE_KEY`, so game-session-client.js never executed,
 * window.MonExGameSession was undefined, session enforcement never ran, and
 * every cloud save 403'd (progress rollback).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

// Load order mirrors play/index.html <script> tags.
const PLAY_SCRIPTS = [
  "js/daily-reset.js",
  "js/patrol-reset.js",
  "js/mana-system.js",
  "js/equipment-unlock.js",
  "js/staging-banner.js",
  "js/monex-config.js",
  "js/escape-html.js",
  "js/activity-client.js",
  "js/auth-client.js",
  "js/game-session-client.js",
  "js/claim-guard.js",
  "js/quest-client.js",
  "js/shop-client.js",
  "js/resource-chest-client.js",
  "js/battle-reward-client.js",
  "js/mailbox-client.js",
];

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function makeBrowserContext() {
  const listeners = {};
  const documentStub = {
    hidden: false,
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    body: { classList: { add: () => {}, remove: () => {}, toggle: () => {} }, appendChild: () => {} },
    documentElement: { appendChild: () => {} },
    head: { appendChild: () => {} },
  };
  const windowStub = {
    addEventListener: (type, fn) => {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener: () => {},
    location: { hash: "", search: "", pathname: "/play/", href: "", hostname: "localhost" },
  };
  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    location: windowStub.location,
    history: { replaceState: () => {} },
    navigator: { userAgent: "node-test" },
    console,
    crypto: webcrypto,
    URL,
    URLSearchParams,
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    alert: () => {},
    BroadcastChannel: undefined,
  };
  // Scripts reference bare `window.X = ...` and also bare globals.
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  return { ctx, windowStub };
}

describe("play page scripts (shared browser global scope)", () => {
  it("all scripts parse and execute together without global collisions", () => {
    const { ctx, windowStub } = makeBrowserContext();
    const failures = [];
    for (const rel of PLAY_SCRIPTS) {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      try {
        vm.runInContext(src, ctx, { filename: rel });
      } catch (err) {
        failures.push(`${rel}: ${err.constructor.name}: ${err.message}`);
      }
    }
    assert.deepEqual(failures, [], `Script files failed in shared scope:\n${failures.join("\n")}`);

    assert.ok(windowStub.MonExAuth, "window.MonExAuth must be defined");
    assert.ok(windowStub.MonExGameSession, "window.MonExGameSession must be defined");
    assert.ok(windowStub.MonExPatrolReset, "window.MonExPatrolReset must be defined");
    assert.ok(windowStub.MonExClaimGuard, "window.MonExClaimGuard must be defined");
    assert.equal(typeof windowStub.MonExClaimGuard.runClaimOnce, "function");
    assert.ok(windowStub.MonExQuest, "window.MonExQuest must be defined");
    assert.ok(windowStub.MonExShop, "window.MonExShop must be defined");
    assert.ok(windowStub.MonExResourceChest, "window.MonExResourceChest must be defined");
    assert.ok(windowStub.MonExBattle, "window.MonExBattle must be defined");

    // Session guard API surface used by play/index.html.
    for (const fn of [
      "claimActiveSession",
      "startSessionGuard",
      "isGameplayAllowed",
      "isSuperseded",
      "getGameSessionId",
      "getSessionOpenedAt",
    ]) {
      assert.equal(typeof windowStub.MonExGameSession[fn], "function", `MonExGameSession.${fn}`);
    }
    // Save revision API used for optimistic locking.
    for (const fn of ["setSaveRevision", "getSaveRevision", "loadCloudSave", "hydrateCloudSave", "scheduleCloudSave"]) {
      assert.equal(typeof windowStub.MonExAuth[fn], "function", `MonExAuth.${fn}`);
    }
  });

  it("no duplicate top-level const/let across script files", () => {
    const decls = new Map();
    const dupes = [];
    for (const rel of PLAY_SCRIPTS) {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      // IIFE-wrapped files keep their declarations out of the global scope.
      const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const firstCode = withoutComments.trimStart();
      if (firstCode.startsWith("(() => {") || firstCode.startsWith("(function")) continue;
      const re = /^(?:const|let)\s+([A-Za-z_$][\w$]*)/gm;
      let m;
      while ((m = re.exec(src))) {
        const lineStart = src.lastIndexOf("\n", m.index - 1) + 1;
        if (m.index !== lineStart) continue;
        if (decls.has(m[1])) dupes.push(`${m[1]} in ${decls.get(m[1])} and ${rel}`);
        else decls.set(m[1], rel);
      }
    }
    assert.deepEqual(dupes, [], `Top-level const/let collisions:\n${dupes.join("\n")}`);
  });

  it("no ESM export statements in classic script files", () => {
    const offenders = [];
    for (const rel of PLAY_SCRIPTS) {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      if (/^export\s/m.test(src)) offenders.push(rel);
    }
    assert.deepEqual(offenders, [], `Classic scripts with ESM exports: ${offenders.join(", ")}`);
  });
});
