import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findUngrantedQuestRewards,
  questGrantKey,
  questChestGrantKey,
  DAILY_QUEST_CHEST_REWARDS,
  WEEKLY_QUEST_CHEST_REWARDS,
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
      dailyClaimedChests: [],
      weeklyClaimedChests: [],
      grantedKeys: [],
    });
    assert.equal(grants.gold, 100);
    assert.deepEqual(keys, [questGrantKey("dailies", "d1")]);
  });

  it("detects claimed daily milestone chest without granted key", () => {
    const { grants, keys } = findUngrantedQuestRewards({
      tasks: { dailies: [], weeklies: [], campaign: [] },
      dailyClaimedChests: [60],
      weeklyClaimedChests: [],
      grantedKeys: [],
    });
    assert.equal(grants.monballs, DAILY_QUEST_CHEST_REWARDS[60].grant.monballs);
    assert.equal(grants.gold, DAILY_QUEST_CHEST_REWARDS[60].grant.gold);
    assert.deepEqual(keys, [questChestGrantKey("dailies", 60)]);
  });

  it("detects claimed weekly milestone chest without granted key", () => {
    const { grants, keys } = findUngrantedQuestRewards({
      tasks: { dailies: [], weeklies: [], campaign: [] },
      dailyClaimedChests: [],
      weeklyClaimedChests: [60],
      grantedKeys: [],
    });
    assert.equal(grants.monballs, WEEKLY_QUEST_CHEST_REWARDS[60].grant.monballs);
    assert.equal(grants.gold, WEEKLY_QUEST_CHEST_REWARDS[60].grant.gold);
    assert.deepEqual(keys, [questChestGrantKey("weeklies", 60)]);
  });

  it("migrates legacy claimedChests to daily track", () => {
    const { grants, keys } = findUngrantedQuestRewards({
      tasks: { dailies: [], weeklies: [], campaign: [] },
      claimedChests: [20],
      grantedKeys: [],
    });
    assert.equal(grants.gold, DAILY_QUEST_CHEST_REWARDS[20].grant.gold);
    assert.deepEqual(keys, [questChestGrantKey("dailies", 20)]);
  });

  it("ignores already granted keys", () => {
    const { grants, keys } = findUngrantedQuestRewards({
      tasks: {
        dailies: [{ id: "d1", progress: 2, claimed: true }],
        weeklies: [],
        campaign: [],
      },
      dailyClaimedChests: [20],
      weeklyClaimedChests: [],
      grantedKeys: [questGrantKey("dailies", "d1"), questChestGrantKey("dailies", 20)],
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
        dailyClaimedChests: [],
        weeklyClaimedChests: [],
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
