import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { timingSafeEqual, parseBoundedInt } from "./security.js";
import { safeJsonParse, stripPrototypePollution } from "./safe-json.js";
import {
  mailboxHasCapacity,
  unclaimedMailboxCount,
  validateAndSanitizeSave,
} from "./save-validate.js";
import { sendMailboxRewardToSave } from "./send-mailbox-reward.js";
import { claimDailyLoginReward } from "./mailbox.js";

function makeMemoryKv(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

describe("P2 security helpers", () => {
  it("timingSafeEqual rejects mismatched secrets without length short-circuit", () => {
    assert.equal(timingSafeEqual("short", "much-longer-secret"), false);
    assert.equal(timingSafeEqual("same", "same"), true);
  });

  it("parseBoundedInt falls back when query params are NaN", () => {
    assert.equal(parseBoundedInt("foo", { fallback: 50, min: 1, max: 50 }), 50);
    assert.equal(parseBoundedInt("-3", { fallback: 1, min: 1, max: 50 }), 1);
    assert.equal(parseBoundedInt("999", { fallback: 1, min: 1, max: 50 }), 50);
  });
});

describe("P2 safe JSON parsing", () => {
  it("strips prototype pollution keys from parsed objects", () => {
    const parsed = safeJsonParse('{"ok":true,"__proto__":{"polluted":1}}', null);
    assert.equal(parsed.ok, true);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(parsed.__proto__, undefined);
  });

  it("stripPrototypePollution removes nested forbidden keys", () => {
    const cleaned = stripPrototypePollution({
      users: { a: 1 },
      constructor: { evil: true },
      nested: { prototype: { x: 1 }, keep: 2 },
    });
    assert.deepEqual(cleaned, { users: { a: 1 }, nested: { keep: 2 } });
  });
});

describe("P2 mailbox capacity", () => {
  it("reports mailbox_full when unclaimed mail is at capacity", () => {
    const mailbox = Array.from({ length: 50 }, (_, i) => ({
      id: `mail_${i}`,
      type: "monballs",
      amount: 1,
      title: "Reward",
      body: "",
      createdAt: new Date(0).toISOString(),
    }));
    assert.equal(unclaimedMailboxCount(mailbox), 50);
    assert.equal(mailboxHasCapacity(mailbox), false);

    const preview = sendMailboxRewardToSave(
      validateAndSanitizeSave({ mailbox, monballs: 10 }),
      { title: "Gift", resourceType: "gold", quantity: 5 }
    );
    assert.equal(preview.changed, false);
    assert.equal(preview.error, "mailbox_full");
  });

  it("daily login claim returns mailbox_full when mailbox is full", async () => {
    const mailbox = Array.from({ length: 50 }, (_, i) => ({
      id: `mail_${i}`,
      type: "monballs",
      amount: 1,
      title: "Reward",
      body: "",
      createdAt: new Date(0).toISOString(),
    }));
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify({
        party: [],
        box: [],
        monballs: 10,
        mailbox,
        updatedAt: new Date(0).toISOString(),
      }),
    });
    const result = await claimDailyLoginReward(kv, { xUserId: "user_1", username: "trainer" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "mailbox_full");
  });
});

describe("P2 skill buff sanitization", () => {
  it("strips arbitrary nested keys from selfBuff/enemyDebuff", () => {
    const save = validateAndSanitizeSave({
      party: [{
        name: "Chog",
        rarity: "Common",
        level: 1,
        max_hp: 100,
        current_hp: 100,
        skills: [{
          name: "Test",
          type: "attack",
          selfBuff: { id: "rage", turns: 2, statMods: { atk: 5 }, evil: true },
          enemyDebuff: { id: "weak", turns: 1, constructor: { x: 1 } },
        }],
      }],
    });
    const skill = save.party[0].skills[0];
    assert.equal(skill.selfBuff.id, "rage");
    assert.equal(skill.selfBuff.statMods.atk, 5);
    assert.equal(skill.selfBuff.evil, undefined);
    assert.equal(skill.enemyDebuff.constructor, undefined);
  });
});
