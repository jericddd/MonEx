import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  timingSafeEqual,
  sanitizeReturnTo,
  isAllowedOrigin,
  simulateAllowed,
} from "./security.js";

describe("security helpers", () => {
  it("timingSafeEqual compares secrets safely", () => {
    assert.equal(timingSafeEqual("abc", "abc"), true);
    assert.equal(timingSafeEqual("abc", "abd"), false);
    assert.equal(timingSafeEqual("abc", "ab"), false);
  });

  it("sanitizeReturnTo allows safe relative paths only", () => {
    assert.equal(sanitizeReturnTo("/home.html"), "/home.html");
    assert.equal(sanitizeReturnTo("https://evil.com"), "/home.html");
    assert.equal(sanitizeReturnTo("//evil.com"), "/home.html");
    assert.equal(sanitizeReturnTo("/../secret"), "/home.html");
    assert.equal(sanitizeReturnTo(null), "/home.html");
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
});
