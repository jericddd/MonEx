import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMailboxRewardItem,
  normalizeMailResourceType,
  sendMailboxRewardToSave,
} from "./send-mailbox-reward.js";

describe("normalizeMailResourceType", () => {
  it("accepts dropdown aliases", () => {
    assert.equal(normalizeMailResourceType("gold"), "gold");
    assert.equal(normalizeMailResourceType("kbs_onion"), "essence");
    assert.equal(normalizeMailResourceType("monball"), "monballs");
  });
});

describe("buildMailboxRewardItem", () => {
  it("builds monball mail", () => {
    const item = buildMailboxRewardItem({
      title: "Sorry for the bug",
      resourceType: "monball",
      quantity: 5,
      now: 1,
    });
    assert.equal(item.type, "monballs");
    assert.equal(item.amount, 5);
    assert.equal(item.title, "Sorry for the bug");
  });

  it("builds gold resources mail", () => {
    const item = buildMailboxRewardItem({
      title: "Event reward",
      resourceType: "gold",
      quantity: 250,
      now: 1,
    });
    assert.equal(item.type, "resources");
    assert.deepEqual(item.grant, { gold: 250 });
  });
});

describe("sendMailboxRewardToSave", () => {
  it("prepends mail to mailbox without changing balances", () => {
    const save = {
      party: [],
      box: [],
      monballs: 3,
      money: 100,
      mailbox: [],
      updatedAt: new Date(0).toISOString(),
    };
    const result = sendMailboxRewardToSave(save, {
      title: "Compensation",
      resourceType: "monball",
      quantity: 5,
      now: 2,
    });
    assert.equal(result.changed, true);
    assert.equal(result.save.monballs, 3);
    assert.equal(result.save.mailbox.length, 1);
    assert.equal(result.save.mailbox[0].amount, 5);
  });
});
