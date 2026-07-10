import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  timingSafeEqual,
  sanitizeReturnTo,
  isAllowedOrigin,
  isStagingOrigin,
  simulateAllowed,
} from "./security.js";
import { devAuthAllowed, stagingDevAuthEnabled } from "./auth.js";

describe("security helpers", () => {
  it("timingSafeEqual compares secrets safely", () => {
    assert.equal(timingSafeEqual("abc", "abc"), true);
    assert.equal(timingSafeEqual("abc", "abd"), false);
    assert.equal(timingSafeEqual("abc", "ab"), false);
  });

  it("sanitizeReturnTo allows safe relative paths only", () => {
    assert.equal(sanitizeReturnTo("/"), "/");
    assert.equal(sanitizeReturnTo("/home.html"), "/home.html");
    assert.equal(sanitizeReturnTo("https://evil.com"), "/");
    assert.equal(sanitizeReturnTo("//evil.com"), "/");
    assert.equal(sanitizeReturnTo("/../secret"), "/");
    assert.equal(sanitizeReturnTo(null), "/");
  });

  it("isAllowedOrigin permits production and staging hosts", () => {
    const env = { FRONTEND_ORIGIN: "https://monexmonad.xyz" };
    assert.equal(isAllowedOrigin("https://monexmonad.xyz", env), true);
    assert.equal(isAllowedOrigin("https://monex.pages.dev", env), true);
    assert.equal(isAllowedOrigin("http://localhost:8788", env), true);
    assert.equal(isAllowedOrigin("https://evil.com", env), false);
  });

  it("simulateAllowed is off unless explicitly enabled", () => {
    assert.equal(simulateAllowed({}), false);
    assert.equal(simulateAllowed({ ENABLE_SIMULATE: "0" }), false);
    assert.equal(simulateAllowed({ ENABLE_SIMULATE: "1" }), true);
  });

  it("isStagingOrigin detects preview hosts only", () => {
    assert.equal(isStagingOrigin("https://monex-staging.pages.dev"), true);
    assert.equal(isStagingOrigin("http://localhost:3000"), true);
    assert.equal(isStagingOrigin("https://monexmonad.xyz"), false);
  });

  it("devAuthAllowed gates staging dev login by Origin", () => {
    const env = { ENABLE_STAGING_DEV_AUTH: "1" };
    const stagingReq = { headers: { get: (k) => (k === "Origin" ? "https://monex-staging.pages.dev" : null) } };
    const liveReq = { headers: { get: (k) => (k === "Origin" ? "https://monexmonad.xyz" : null) } };
    assert.equal(devAuthAllowed(env), false); // default-deny without a request
    assert.equal(devAuthAllowed(env, stagingReq), true);
    assert.equal(devAuthAllowed(env, liveReq), false);
    assert.equal(stagingDevAuthEnabled(env), true);
  });
});
