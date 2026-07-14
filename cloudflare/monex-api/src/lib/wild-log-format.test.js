import test from "node:test";
import assert from "node:assert/strict";
import { describeWildLogCatch, describeWildLogBalance, resolveMonballsBefore } from "./wild-log-format.js";

test("describeWildLogCatch simplifies single-catch rows", () => {
  assert.equal(describeWildLogCatch({ spend: 1, throws: 1, caughtCount: 1 }), "1 caught");
});

test("describeWildLogCatch shows bulk catch summary", () => {
  assert.equal(
    describeWildLogCatch({ spend: 7, throws: 7, caughtCount: 7 }),
    "7 caught"
  );
  assert.equal(
    describeWildLogCatch({ spend: 7, throws: 7, caughtCount: 5, escapedCount: 2 }),
    "7 Monballs · 5/7 caught (2 escaped)"
  );
});

test("describeWildLogBalance shows before and after when recorded", () => {
  assert.equal(
    describeWildLogBalance({ monballsBefore: 13, monballsLeft: 12, spend: 1 }),
    "13 → 12"
  );
});

test("describeWildLogBalance infers before for legacy rows", () => {
  assert.equal(resolveMonballsBefore({ monballsLeft: 12, spend: 1 }), 13);
  assert.equal(describeWildLogBalance({ monballsLeft: 12, spend: 1 }), "13 → 12");
});
