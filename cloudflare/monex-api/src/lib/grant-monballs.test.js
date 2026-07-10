import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeMonballBalances } from "./grant-monballs.js";

describe("mergeMonballBalances", () => {
  it("keeps the higher cloud save balance when mailbox added monballs", () => {
    assert.equal(mergeMonballBalances(1, 6), 6);
  });

  it("keeps the higher catch balance when X catches added monballs", () => {
    assert.equal(mergeMonballBalances(8, 3), 8);
  });
});
