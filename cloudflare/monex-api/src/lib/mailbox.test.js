import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  claimDailyLoginReward,
  claimMailboxItem,
  getDailyLoginStatus,
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

describe("daily login mailbox delivery", () => {
  it("adds reward to mailbox only when claim is pressed (API claim endpoint)", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify({
        party: [],
        box: [],
        monballs: 10,
        mailbox: [],
        updatedAt: new Date(0).toISOString(),
      }),
    });

    const result = await claimDailyLoginReward(kv, session);
    assert.equal(result.ok, true);
    assert.equal(result.delivery, "mailbox");
    assert.equal(result.item.amount, DAILY_LOGIN_REWARD_MONBALLS);

    const saved = JSON.parse(kv.dump("monex:save:user_1"));
    assert.equal(saved.monballs, 10);
    assert.equal(saved.mailbox.length, 1);
    assert.equal(saved.mailbox[0].amount, DAILY_LOGIN_REWARD_MONBALLS);
    assert.equal(saved.mailbox[0].claimedAt, undefined);
  });

  it("does not add mailbox mail or monballs when on cooldown", async () => {
    const now = Date.now();
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify({
        party: [],
        box: [],
        monballs: 10,
        mailbox: [],
        dailyLoginLastClaimAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      }),
    });

    const result = await claimDailyLoginReward(kv, session);
    assert.equal(result.ok, false);
    assert.equal(result.error, "cooldown");

    const saved = JSON.parse(kv.dump("monex:save:user_1"));
    assert.equal(saved.monballs, 10);
    assert.equal(saved.mailbox.length, 0);
  });

  it("credits monballs only after mailbox item is claimed in game", async () => {
    const kv = makeMemoryKv({
      "monex:save:user_1": JSON.stringify({
        party: [],
        box: [],
        monballs: 10,
        mailbox: [
          {
            id: "mail_test",
            type: "monballs",
            amount: DAILY_LOGIN_REWARD_MONBALLS,
            title: "Daily Login Reward",
            body: "test",
            createdAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date(0).toISOString(),
      }),
      "monex:state": JSON.stringify({
        processedTweetIds: [],
        users: {
          user_1: { username: "trainer", monballs: 1, pendingMons: [] },
        },
      }),
    });

    const result = await claimMailboxItem(kv, session, "mail_test");
    assert.equal(result.ok, true);
    assert.equal(result.save.monballs, 10 + DAILY_LOGIN_REWARD_MONBALLS);
    assert.ok(result.save.mailbox[0].claimedAt);

    const catchState = JSON.parse(kv.dump("monex:state"));
    assert.equal(catchState.users.user_1.monballs, 1 + DAILY_LOGIN_REWARD_MONBALLS);
  });
});

describe("getDailyLoginStatus", () => {
  it("reports ready when user has never claimed", () => {
    const status = getDailyLoginStatus({ mailbox: [], monballs: 10 });
    assert.equal(status.ready, true);
    assert.equal(status.unclaimed, 0);
  });
});
