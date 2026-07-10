import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMergedMonballs } from "./save-reconcile.js";

describe("resolveMergedMonballs", () => {
  it("prefers catch monballs when catch state is newer (X spend)", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(2000).toISOString() },
      { monballs: 10, updatedAt: new Date(1000).toISOString() },
      4
    );
    assert.equal(merged, 4);
  });

  it("uses save monballs when save is newer (mailbox grant)", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(1000).toISOString() },
      { monballs: 6, updatedAt: new Date(2000).toISOString() },
      1
    );
    assert.equal(merged, 6);
  });

  it("uses save monballs when save is newer (in-game spend)", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(1000).toISOString() },
      { monballs: 3, updatedAt: new Date(2000).toISOString() },
      10
    );
    assert.equal(merged, 3);
  });

  it("prefers catch when only catch has a timestamp", () => {
    const merged = resolveMergedMonballs(
      { updatedAt: new Date(1000).toISOString() },
      { monballs: 10 },
      6
    );
    assert.equal(merged, 6);
  });

  it("falls back to max when timestamps are missing", () => {
    const merged = resolveMergedMonballs({}, { monballs: 4 }, 7);
    assert.equal(merged, 7);
  });
});
