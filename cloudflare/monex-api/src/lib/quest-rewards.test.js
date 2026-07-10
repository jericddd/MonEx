import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findUngrantedQuestRewards,
  questGrantKey,
  questChestGrantKey,
} from "./quest-rewards.js";
import { backfillQuestRewardsForSave } from "./backfill-quest-rewards.js";
import { claimMailboxItem } from "./mailbox.js";

describe("findUngrantedQuestRewards", () => {
  it("detects claimed daily without granted key", () => {
    const { grants, keys } = findUngrantedQuestRewards({
      tasks: {
        dailies: [{ id: "d1", progress: 2, claimed: true }],
        weeklies: [],
        campaign: [],
      },
      claimedChests: [],
      grantedKeys: [],
    });
    assert.equal(grants.gold, 100);
    assert.deepEqual(keys, [questGrantKey("dailies", "d1")]);
  });

  it("detects claimed milestone chest without granted key", () => {
    const { grants, keys } = findUngrantedQuestRewards({
      tasks: { dailies: [], weeklies: [], campaign: [] },
      claimedChests: [60],
      grantedKeys: [],
    });
    assert.equal(grants.monballs, 2);
    assert.equal(grants.trainerXp, 30);
    assert.deepEqual(keys, [questChestGrantKey(60)]);
  });

  it("ignores already granted keys", () => {
    const { grants, keys } = findUngrantedQuestRewards({
      tasks: {
        dailies: [{ id: "d1", progress: 2, claimed: true }],
        weeklies: [],
        campaign: [],
      },
      claimedChests: [20],
      grantedKeys: [questGrantKey("dailies", "d1"), questChestGrantKey(20)],
    });
    assert.equal(grants, null);
    assert.equal(keys.length, 0);
  });
});

describe("backfillQuestRewardsForSave", () => {
  it("adds recovery mail and marks granted keys", () => {
    const save = {
      party: [],
      box: [],
      monballs: 10,
      money: 1000,
      mailbox: [],
      questState: {
        tasks: {
          dailies: [{ id: "d1", progress: 2, claimed: true }],
          weeklies: [],
          campaign: [],
        },
        claimedChests: [],
        grantedKeys: [],
      },
      updatedAt: new Date(0).toISOString(),
    };
    const result = backfillQuestRewardsForSave(save);
    assert.equal(result.changed, true);
    assert.equal(result.save.mailbox.length, 1);
    assert.equal(result.save.mailbox[0].type, "resources");
    assert.equal(result.save.mailbox[0].grant.gold, 100);
    assert.ok(result.save.questState.grantedKeys.includes(questGrantKey("dailies", "d1")));
  });
});

describe("mailbox resources claim", () => {
  it("credits bundled quest recovery rewards", async () => {
    const kv = {
      data: new Map(),
      async get(key) {
        return this.data.get(key) || null;
      },
      async put(key, value) {
        this.data.set(key, value);
      },
    };
    kv.data.set(
      "monex:save:user_1",
      JSON.stringify({
        party: [],
        box: [],
        monballs: 10,
        money: 1000,
        essence: 0,
        monShards: 0,
        trainerXp: 0,
        mailbox: [
          {
            id: "mail_quest_1",
            type: "resources",
            grant: { gold: 150, essence: 20 },
            title: "Quest Reward Recovery",
            body: "test",
            createdAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date(0).toISOString(),
      })
    );
    const result = await claimMailboxItem(kv, { xUserId: "user_1", username: "trainer" }, "mail_quest_1");
    assert.equal(result.ok, true);
    assert.equal(result.save.money, 1150);
    assert.equal(result.save.essence, 20);
  });
});
