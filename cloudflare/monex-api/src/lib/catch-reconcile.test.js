import test from "node:test";
import assert from "node:assert/strict";
import { auditCatchSyncForUser } from "./catch-reconcile.js";

test("auditCatchSyncForUser flags log entries without matching inventory", () => {
  const report = auditCatchSyncForUser({
    username: "trainer",
    save: { party: [], box: [] },
    catchUser: { pendingMons: [] },
    activityEntries: [
      {
        id: "act1",
        tweetId: "tw1",
        xUsername: "trainer",
        status: "success",
        caughtCount: 1,
        mons: [{ name: "Chog", pendingId: "p_a" }],
      },
    ],
  });
  assert.equal(report.issueCount, 1);
  assert.equal(report.issues[0].type, "log_without_inventory");
});

test("auditCatchSyncForUser passes when pendingId is in party", () => {
  const report = auditCatchSyncForUser({
    username: "trainer",
    save: {
      party: [{ name: "Chog", wildPendingId: "p_a" }],
      box: [],
    },
    catchUser: { pendingMons: [] },
    activityEntries: [
      {
        id: "act1",
        tweetId: "tw1",
        xUsername: "trainer",
        status: "success",
        caughtCount: 1,
        mons: [{ name: "Chog", pendingId: "p_a" }],
      },
    ],
  });
  assert.equal(report.issueCount, 0);
});

test("auditCatchSyncForUser passes when recovery alias is in box", () => {
  const report = auditCatchSyncForUser({
    username: "trainer",
    save: {
      party: [],
      box: [{ name: "Chog", wildPendingId: "recovery_act1_0" }],
    },
    catchUser: { pendingMons: [] },
    activityEntries: [
      {
        id: "act1",
        tweetId: "tw1",
        xUsername: "trainer",
        status: "success",
        caughtCount: 1,
        mons: [{ name: "Chog", pendingId: "p_a" }],
      },
    ],
  });
  assert.equal(report.issueCount, 0);
});
