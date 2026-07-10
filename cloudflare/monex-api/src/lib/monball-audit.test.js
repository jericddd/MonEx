import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendMonballAudit, listMonballAudit, monballAuditKey } from "./monball-audit.js";

function makeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

describe("monball-audit", () => {
  it("stores source, delta, balance, and timestamp", async () => {
    const kv = makeKv();
    const entry = await appendMonballAudit(kv, {
      xUserId: "user_1",
      username: "@Trainer",
      source: "mailbox_claim",
      delta: 5,
      balanceAfter: 15,
      meta: { mailId: "mail_1" },
    });

    assert.equal(entry.source, "mailbox_claim");
    assert.equal(entry.delta, 5);
    assert.equal(entry.balanceAfter, 15);
    assert.equal(entry.username, "trainer");
    assert.ok(entry.at);

    const list = await listMonballAudit(kv, "user_1");
    assert.equal(list.length, 1);
    assert.equal(list[0].meta.mailId, "mail_1");
  });

  it("prepends newest entries and caps history", async () => {
    const kv = makeKv();
    for (let i = 0; i < 105; i++) {
      await appendMonballAudit(kv, {
        xUserId: "user_2",
        source: "test",
        delta: 1,
        balanceAfter: i,
      });
    }
    const list = await listMonballAudit(kv, "user_2", 200);
    assert.equal(list.length, 100);
    assert.equal(list[0].balanceAfter, 104);
    assert.equal(list[99].balanceAfter, 5);
  });

  it("uses namespaced KV key", () => {
    assert.equal(monballAuditKey("abc"), "monex:monball-audit:abc");
  });
});
