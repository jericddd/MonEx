import { test } from "node:test";
import assert from "node:assert/strict";
import { getDailyReplyLimitForUser, parseReplyLimitOverrides } from "./reply-limits.js";

test("default daily reply limit", () => {
  assert.equal(getDailyReplyLimitForUser("anyone", {}), 4);
  assert.equal(getDailyReplyLimitForUser("anyone", { DAILY_REPLY_LIMIT: "4" }), 4);
});

test("jericddd override to 100", () => {
  const env = { DAILY_REPLY_LIMIT: "4", REPLY_LIMIT_OVERRIDES: "jericddd:100" };
  assert.equal(getDailyReplyLimitForUser("jericddd", env), 100);
  assert.equal(getDailyReplyLimitForUser("@jericddd", env), 100);
  assert.equal(getDailyReplyLimitForUser("otherplayer", env), 4);
});

test("parse multiple overrides", () => {
  const map = parseReplyLimitOverrides({ REPLY_LIMIT_OVERRIDES: "jericddd:100,test:20" });
  assert.equal(map.get("jericddd"), 100);
  assert.equal(map.get("test"), 20);
});
