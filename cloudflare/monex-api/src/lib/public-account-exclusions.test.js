import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicHiddenUsername,
  normalizePublicUsername,
  PUBLIC_HIDDEN_USERNAMES,
} from "./public-account-exclusions.js";

test("normalizes @handles", () => {
  assert.equal(normalizePublicUsername("@Test"), "test");
  assert.equal(normalizePublicUsername("  YESDRAKEN_ "), "yesdraken_");
});

test("hides test and legacy wild-log accounts", () => {
  assert.equal(isPublicHiddenUsername("test"), true);
  assert.equal(isPublicHiddenUsername("@TEST"), true);
  assert.equal(isPublicHiddenUsername("yesdraken_"), true);
  assert.equal(isPublicHiddenUsername("lucci_crypto"), false);
  assert.ok(PUBLIC_HIDDEN_USERNAMES.includes("test"));
});
