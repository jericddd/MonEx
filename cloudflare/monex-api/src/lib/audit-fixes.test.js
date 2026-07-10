import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { devAuthAllowed } from "./auth.js";
import { buildCorsHeaders } from "./security.js";
import {
  loadCloudSave,
  writeCloudSave,
  preserveServerAuthoritativeFields,
} from "./save.js";
import { validateAndSanitizeSave } from "./save-validate.js";

function makeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
  };
}

function req(origin) {
  return { headers: { get: (n) => (n === "Origin" ? origin : null) } };
}

describe("devAuthAllowed (dev-auth hardening)", () => {
  it("denies when no flags set", () => {
    assert.equal(devAuthAllowed({}, req("https://x.pages.dev")), false);
  });
  it("denies staging dev-auth without a request (default-deny)", () => {
    assert.equal(devAuthAllowed({ ENABLE_STAGING_DEV_AUTH: "1" }), false);
  });
  it("denies staging dev-auth for a non-staging origin", () => {
    assert.equal(devAuthAllowed({ ENABLE_STAGING_DEV_AUTH: "1" }, req("https://evil.com")), false);
  });
  it("denies staging dev-auth when the flag is off even with staging origin", () => {
    assert.equal(devAuthAllowed({ ENABLE_STAGING_DEV_AUTH: "0" }, req("https://x.pages.dev")), false);
  });
  it("allows global dev-auth only when explicitly enabled", () => {
    assert.equal(devAuthAllowed({ ENABLE_DEV_AUTH: "1" }), true);
  });
});

describe("CORS hardening", () => {
  it("omits Access-Control-Allow-Origin for a disallowed origin (no * fallback)", () => {
    const headers = buildCorsHeaders(req("https://evil.example"), { FRONTEND_ORIGIN: "https://monexmonad.xyz" });
    assert.equal(headers["Access-Control-Allow-Origin"], undefined);
  });
  it("echoes the allowed frontend origin", () => {
    const headers = buildCorsHeaders(req("https://monexmonad.xyz"), { FRONTEND_ORIGIN: "https://monexmonad.xyz" });
    assert.equal(headers["Access-Control-Allow-Origin"], "https://monexmonad.xyz");
  });
});

describe("corrupt cloud save handling", () => {
  it("flags a present-but-unparseable save as corrupt (not a new account)", async () => {
    const kv = makeKv({ "monex:save:u1": "{not valid json" });
    const result = await loadCloudSave(kv, "u1");
    assert.equal(result.found, false);
    assert.equal(result.corrupt, true);
  });
  it("returns found:false without corrupt flag for a genuinely missing save", async () => {
    const kv = makeKv();
    const result = await loadCloudSave(kv, "u1");
    assert.equal(result.found, false);
    assert.notEqual(result.corrupt, true);
  });
});

describe("server-authoritative save fields", () => {
  it("ignores client-supplied mailbox and daily-login timestamp on PUT", () => {
    const existing = validateAndSanitizeSave({
      mailbox: [{ id: "mail_real", type: "monballs", amount: 5, createdAt: new Date().toISOString() }],
      dailyLoginLastClaimAt: "2026-07-10T00:00:00.000Z",
    });
    const clientPayload = validateAndSanitizeSave({
      mailbox: [{ id: "mail_evil", type: "monballs", amount: 9999, createdAt: new Date().toISOString() }],
      dailyLoginLastClaimAt: null,
    });
    preserveServerAuthoritativeFields(clientPayload, existing);
    assert.equal(clientPayload.mailbox.length, 1);
    assert.equal(clientPayload.mailbox[0].id, "mail_real");
    assert.equal(clientPayload.dailyLoginLastClaimAt, "2026-07-10T00:00:00.000Z");
  });

  it("defaults to empty mailbox when there is no existing save", () => {
    const clientPayload = validateAndSanitizeSave({
      mailbox: [{ id: "mail_evil", type: "monballs", amount: 9999, createdAt: new Date().toISOString() }],
    });
    preserveServerAuthoritativeFields(clientPayload, null);
    assert.deepEqual(clientPayload.mailbox, []);
    assert.equal(clientPayload.dailyLoginLastClaimAt, null);
  });
});

describe("save string sanitization (XSS defense-in-depth)", () => {
  it("strips angle brackets from skill name/desc", () => {
    const save = validateAndSanitizeSave({
      party: [{
        name: "Chog",
        rarity: "Rare",
        level: 5,
        max_hp: 100,
        skills: [{ name: "<img src=x onerror=alert(1)>", desc: "<script>bad</script>hi", type: "active" }],
      }],
    });
    const skill = save.party[0].skills[0];
    assert.ok(!skill.name.includes("<"));
    assert.ok(!skill.name.includes(">"));
    assert.ok(!skill.desc.includes("<"));
    assert.ok(!skill.desc.includes(">"));
  });

  it("strips angle brackets from xHandle", () => {
    const save = validateAndSanitizeSave({ xHandle: "<b>evil</b>" });
    assert.ok(!save.xHandle.includes("<"));
  });
});

describe("revision persistence unaffected by field preservation", () => {
  it("still increments revision on write", async () => {
    const kv = makeKv();
    const payload = validateAndSanitizeSave({ money: 100, updatedAt: new Date().toISOString() });
    const saved = await writeCloudSave(kv, "u1", payload);
    assert.equal(saved.revision, 1);
  });
});
