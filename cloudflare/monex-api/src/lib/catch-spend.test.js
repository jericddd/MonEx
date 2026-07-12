import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { trySpendCatchMonballs } from "./catch-spend.js";

describe("trySpendCatchMonballs", () => {
  it("deducts monballs when balance is sufficient", () => {
    const user = { monballs: 10, pendingMons: [] };
    const result = trySpendCatchMonballs(user, 5);
    assert.equal(result.ok, true);
    assert.equal(result.before, 10);
    assert.equal(result.after, 5);
    assert.equal(user.monballs, 5);
    assert.ok(user.updatedAt);
  });

  it("rejects spend when balance is insufficient", () => {
    const user = { monballs: 3, pendingMons: [] };
    const result = trySpendCatchMonballs(user, 5);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient");
    assert.equal(user.monballs, 3);
  });

  it("rejects spend when balance is zero", () => {
    const user = { monballs: 0, pendingMons: [] };
    const result = trySpendCatchMonballs(user, 1);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "insufficient");
    assert.equal(user.monballs, 0);
  });
});
