import test from "node:test";
import assert from "node:assert/strict";
import { validateAndSanitizeSave, sanitizeReleaseLog } from "./save-validate.js";
import { mergeReleaseLog, mergeReleasedRecoveryIds } from "./save-economy-guard.js";
import { listReleaseLog, nextReleaseLogNumber } from "./release-log.js";

test("sanitizeReleaseLog keeps valid release entries", () => {
  const rows = sanitizeReleaseLog([
    {
      id: "rel_1",
      at: "2026-07-13T00:00:00.000Z",
      name: "Mouch",
      rarity: "Common",
      level: 5,
      gold: 120,
      essence: 5,
      shards: 0,
      source: "box",
    },
    { id: "rel_1", name: "Dup" },
    { name: "Hacker" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Mouch");
  assert.equal(rows[0].level, 5);
});

test("mergeReleaseLog is append-only and dedupes by id", () => {
  const existing = {
    releaseLog: [
      {
        id: "rel_a",
        at: "2026-07-12T00:00:00.000Z",
        name: "Chog",
        rarity: "Common",
        level: 1,
        gold: 0,
        essence: 5,
        shards: 0,
        source: "box",
      },
    ],
  };
  const incoming = {
    releaseLog: [
      {
        id: "rel_a",
        at: "2026-07-13T00:00:00.000Z",
        name: "Chog",
        rarity: "Common",
        level: 1,
        gold: 0,
        essence: 5,
        shards: 0,
        source: "box",
      },
      {
        id: "rel_b",
        at: "2026-07-13T01:00:00.000Z",
        name: "Anago",
        rarity: "Uncommon",
        level: 3,
        gold: 40,
        essence: 12,
        shards: 1,
        source: "box",
      },
    ],
  };
  const merged = mergeReleaseLog(existing, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "rel_b");
  assert.equal(merged[1].id, "rel_a");
});

test("validateAndSanitizeSave persists releaseLog", () => {
  const save = validateAndSanitizeSave({
    releaseLog: [
      {
        id: "rel_1",
        at: "2026-07-13T00:00:00.000Z",
        name: "Molandak",
        rarity: "Rare",
        level: 10,
        gold: 0,
        essence: 25,
        shards: 2,
        source: "party",
      },
    ],
  });
  assert.equal(save.releaseLog.length, 1);
  assert.equal(save.releaseLog[0].source, "party");
});

test("mergeReleasedRecoveryIds is append-only", () => {
  const merged = mergeReleasedRecoveryIds(
    { releasedRecoveryIds: ["recovery_act_1_0"] },
    { releasedRecoveryIds: ["recovery_act_1_0", "recovery_act_2_0"] }
  );
  assert.deepEqual(merged, ["recovery_act_1_0", "recovery_act_2_0"]);
});

test("validateAndSanitizeSave persists releasedRecoveryIds", () => {
  const save = validateAndSanitizeSave({
    releasedRecoveryIds: ["recovery_act_1_0", "", "recovery_act_1_0", "recovery_act_2_0"],
  });
  assert.deepEqual(save.releasedRecoveryIds, ["recovery_act_1_0", "recovery_act_2_0"]);
});

test("listReleaseLog paginates newest first", () => {
  const save = validateAndSanitizeSave({
    releaseLog: [
      { id: "rel_1", at: "2026-07-10T00:00:00.000Z", name: "Chog", rarity: "Common", level: 1 },
      { id: "rel_2", at: "2026-07-12T00:00:00.000Z", name: "Anago", rarity: "Common", level: 2 },
      { id: "rel_3", at: "2026-07-13T00:00:00.000Z", name: "Mouch", rarity: "Common", level: 3 },
    ],
  });
  const page1 = listReleaseLog(save, { limit: 2, page: 1 });
  assert.equal(page1.total, 3);
  assert.equal(page1.entries[0].id, "rel_3");
  assert.equal(page1.entries[0].releaseLogNumber, 3);
  assert.equal(page1.entries[1].releaseLogNumber, 2);
  assert.equal(page1.entries.length, 2);
});

test("nextReleaseLogNumber increments from stored seq and rows", () => {
  const save = validateAndSanitizeSave({
    releaseLogSeq: 2,
    releaseLog: [
      {
        id: "rel_1",
        at: "2026-07-10T00:00:00.000Z",
        name: "Chog",
        rarity: "Common",
        level: 1,
        releaseLogNumber: 1,
      },
      {
        id: "rel_2",
        at: "2026-07-12T00:00:00.000Z",
        name: "Anago",
        rarity: "Common",
        level: 2,
        releaseLogNumber: 2,
      },
    ],
  });
  assert.equal(nextReleaseLogNumber(save), 3);
});
