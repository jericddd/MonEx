import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claimDailyLoginReward,
  claimMailboxItem,
  DAILY_LOGIN_REWARD_MONBALLS,
} from "./mailbox.js";

function makeMemoryKv(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, value) {
      data.set(key, value);
    },
    dump(key) {
      return data.get(key);
    },
  };
}

const session = { xUserId: "user_1", username: "trainer" };

function baseSave(mailbox, extra = {}) {
  return {
    party: [],
    box: [],
    monballs: 10,
    money: 1000,
    essence: 0,
    monShards: 0,
    trainerXp: 0,
    mailbox,
    updatedAt: new Date(0).toISOString(),
    revision: 1,
    ...extra,
  };
}

describe("daily login claim idempotency", () => {
  it("returns alreadyClaimed on duplicate daily login spam", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify({
        party: [],
        box: [],
        monballs: 10,
        mailbox: [],
        updatedAt: new Date(0).toISOString(),
        revision: 1,
      }),
    });

    const first = await claimDailyLoginReward(kv, session);
    assert.equal(first.ok, true);
    assert.equal(first.alreadyClaimed, undefined);

    const second = await claimDailyLoginReward(kv, session);
    assert.equal(second.ok, true);
    assert.equal(second.alreadyClaimed, true);

    const saved = JSON.parse(kv.dump("monex:save:user_1"));
    assert.equal(saved.mailbox.length, 1);
    assert.equal(saved.monballs, 10);
  });

  it("serializes concurrent daily login claims into one mailbox mail", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify({
        party: [],
        box: [],
        monballs: 10,
        mailbox: [],
        updatedAt: new Date(0).toISOString(),
        revision: 2,
      }),
    });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => claimDailyLoginReward(kv, session))
    );
    const successes = results.filter((r) => r.ok && !r.alreadyClaimed);
    const duplicates = results.filter((r) => r.ok && r.alreadyClaimed);
    assert.equal(successes.length, 1);
    assert.equal(duplicates.length, 5);
    const saved = JSON.parse(kv.dump("monex:save:user_1"));
    assert.equal(saved.mailbox.length, 1);
  });
});

describe("mailbox claim idempotency", () => {
  it("returns alreadyClaimed without granting rewards on duplicate claim", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify(
        baseSave([
          {
            id: "mail_dup",
            type: "monballs",
            amount: 5,
            title: "Daily Login Reward",
            body: "test",
            createdAt: new Date().toISOString(),
          },
        ])
      ),
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: { user_1: { username: "trainer", monballs: 10, pendingMons: [] } },
      }),
    });

    const first = await claimMailboxItem(kv, session, "mail_dup");
    assert.equal(first.ok, true);
    assert.equal(first.alreadyClaimed, undefined);

    const second = await claimMailboxItem(kv, session, "mail_dup");
    assert.equal(second.ok, true);
    assert.equal(second.alreadyClaimed, true);

    const saved = JSON.parse(kv.dump("monex:save:user_1"));
    assert.equal(saved.monballs, 10 + 5);
    const catchState = JSON.parse(kv.dump("monex:state"));
    assert.equal(catchState.users.user_1.monballs, 10 + 5);
  });

  it("serializes concurrent spam clicks into one grant", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify(
        baseSave([
          {
            id: "mail_spam",
            type: "monballs",
            amount: DAILY_LOGIN_REWARD_MONBALLS,
            title: "Daily Login Reward",
            body: "test",
            createdAt: new Date().toISOString(),
          },
        ])
      ),
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: { user_1: { username: "trainer", monballs: 0, pendingMons: [] } },
      }),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimMailboxItem(kv, session, "mail_spam"))
    );

    const successes = results.filter((r) => r.ok && !r.alreadyClaimed);
    const duplicates = results.filter((r) => r.ok && r.alreadyClaimed);
    assert.equal(successes.length, 1);
    assert.equal(duplicates.length, 7);

    const saved = JSON.parse(kv.dump("monex:save:user_1"));
    assert.equal(saved.monballs, 10 + DAILY_LOGIN_REWARD_MONBALLS);
    assert.ok(saved.mailbox[0].claimedAt);
    const catchState = JSON.parse(kv.dump("monex:state"));
    assert.equal(catchState.users.user_1.monballs, DAILY_LOGIN_REWARD_MONBALLS);
  });

  it("grants bundled resource rewards only once", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify(
        baseSave([
          {
            id: "mail_resources",
            type: "resources",
            grant: { gold: 200, essence: 15, monballs: 3, monShards: 2, trainerXp: 50 },
            title: "Quest Reward",
            body: "test",
            createdAt: new Date().toISOString(),
          },
        ])
      ),
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: { user_1: { username: "trainer", monballs: 10, pendingMons: [] } },
      }),
    });

    await claimMailboxItem(kv, session, "mail_resources");
    const dup = await claimMailboxItem(kv, session, "mail_resources");
    assert.equal(dup.alreadyClaimed, true);

    const saved = JSON.parse(kv.dump("monex:save:user_1"));
    assert.equal(saved.money, 1200);
    assert.equal(saved.essence, 15);
    assert.equal(saved.monballs, 13);
    assert.equal(saved.monShards, 2);
    assert.equal(saved.trainerXp, 50);
  });

  it("writes a claim receipt key for cross-request idempotency", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify(
        baseSave([
          {
            id: "mail_receipt",
            type: "monballs",
            amount: 2,
            title: "Compensation",
            body: "test",
            createdAt: new Date().toISOString(),
          },
        ])
      ),
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: { user_1: { username: "trainer", monballs: 5, pendingMons: [] } },
      }),
    });

    await claimMailboxItem(kv, session, "mail_receipt");
    assert.ok(kv.dump("monex:mailbox-claim:user_1:mail_receipt"));
  });

  it("marks mail claimed before catch monballs are credited", async () => {
    const events = [];
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify(
        baseSave([
          {
            id: "mail_order",
            type: "monballs",
            amount: 4,
            title: "Promo",
            body: "test",
            createdAt: new Date().toISOString(),
          },
        ])
      ),
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: { user_1: { username: "trainer", monballs: 1, pendingMons: [] } },
      }),
    });
    const originalPut = kv.put.bind(kv);
    kv.put = async (key, value) => {
      if (String(key).startsWith("monex:save:")) {
        const parsed = JSON.parse(value);
        const mail = parsed.mailbox?.find((m) => m.id === "mail_order");
        events.push({ step: "save_write", claimedAt: mail?.claimedAt || null });
      }
      if (String(key) === "monex:state") {
        const parsed = JSON.parse(value);
        events.push({
          step: "catch_credit",
          monballs: parsed.users?.user_1?.monballs ?? null,
        });
      }
      return originalPut(key, value);
    };

    await claimMailboxItem(kv, session, "mail_order");
    const saveIdx = events.findIndex((e) => e.step === "save_write");
    const catchIdx = events.findIndex((e) => e.step === "catch_credit");
    assert.ok(saveIdx >= 0);
    assert.ok(catchIdx >= 0);
    assert.ok(events[saveIdx].claimedAt);
    assert.ok(saveIdx < catchIdx);
  });
});
