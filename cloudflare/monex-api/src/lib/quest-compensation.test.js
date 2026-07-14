import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPAIGN_C1_COMPENSATION_ID,
  CAMPAIGN_C1_GRANT_KEY,
  evaluateCampaignC1Compensation,
  compensateCampaignC1Monball,
} from "./quest-compensation.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
  };
}

function seedCatchUser(store, monballs = 0) {
  store["monex:catch-user:u1"] = JSON.stringify({
    username: "trainer",
    monballs,
    pendingMons: [],
    updatedAt: new Date(1000).toISOString(),
  });
}

test("evaluateCampaignC1Compensation requires claimed achievement", () => {
  const result = evaluateCampaignC1Compensation({
    questState: {
      grantedKeys: [],
      tasks: { campaign: [{ id: "c1", progress: 1, claimed: false }] },
    },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "achievement_not_claimed");
});

test("evaluateCampaignC1Compensation skips fully paid users", () => {
  const result = evaluateCampaignC1Compensation({
    questState: {
      grantedKeys: [CAMPAIGN_C1_GRANT_KEY],
      tasks: { campaign: [{ id: "c1", progress: 1, claimed: true }] },
    },
    questMonballPaidAmounts: { [CAMPAIGN_C1_GRANT_KEY]: 15 },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "reward_already_paid");
});

test("compensateCampaignC1Monball grants missing monballs once", async () => {
  const now = new Date();
  const store = {
    "monex:state": JSON.stringify({ processedTweetIds: [], users: {} }),
    "monex:save:u1": JSON.stringify({
      revision: 1,
      monballs: 3,
      party: [],
      box: [],
      questState: {
        grantedKeys: [CAMPAIGN_C1_GRANT_KEY],
        tasks: { campaign: [{ id: "c1", progress: 1, claimed: true }] },
      },
      updatedAt: now.toISOString(),
    }),
  };
  seedCatchUser(store, 3);
  const kv = makeKv(store);
  const session = { xUserId: "u1", username: "trainer" };
  const save = JSON.parse(store["monex:save:u1"]);

  const first = await compensateCampaignC1Monball(kv, session, save, 10, { now });
  assert.equal(first.applied, true);
  assert.equal(first.save.monballs, 18);
  assert.equal(first.save.questMonballPaidAmounts[CAMPAIGN_C1_GRANT_KEY], 15);
  assert.equal(first.save.accountCompensationsApplied[CAMPAIGN_C1_COMPENSATION_ID].amount, 15);

  const second = await compensateCampaignC1Monball(kv, session, first.save, 10, { now });
  assert.equal(second.applied, false);
  assert.equal(second.reason, "reward_already_paid");
});
