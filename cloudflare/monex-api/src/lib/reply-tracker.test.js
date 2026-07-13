import test from "node:test";
import assert from "node:assert/strict";
import {
  getReplyCountToday,
  canSendReply,
  recordReplySent,
  wasLimitNoticeSentToday,
  markLimitNoticeSent,
  seedReplyCountFromUser,
  todayUtcDay,
} from "./reply-tracker.js";

function makeKv(store = new Map()) {
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

test("reply counter persists in dedicated KV keys", async () => {
  const kv = makeKv();
  const uid = "1603375900623605761";

  assert.equal(await getReplyCountToday(kv, uid), 0);
  assert.equal(await canSendReply(kv, uid, 4), true);

  await recordReplySent(kv, uid);
  assert.equal(await getReplyCountToday(kv, uid), 1);
  assert.equal(await canSendReply(kv, uid, 4), true);

  await recordReplySent(kv, uid);
  await recordReplySent(kv, uid);
  assert.equal(await getReplyCountToday(kv, uid), 3);
  assert.equal(await canSendReply(kv, uid, 4), true);

  await recordReplySent(kv, uid);
  assert.equal(await getReplyCountToday(kv, uid), 4);
  assert.equal(await canSendReply(kv, uid, 4), false);
});

test("seeds legacy state user replyCount into KV", async () => {
  const kv = makeKv();
  const uid = "42";
  const day = todayUtcDay();
  const user = { replyDay: day, replyCount: 2 };

  assert.equal(await seedReplyCountFromUser(kv, uid, user), 2);
  assert.equal(await getReplyCountToday(kv, uid), 2);
  await recordReplySent(kv, uid);
  assert.equal(await getReplyCountToday(kv, uid), 3);
});

test("limit notice flag uses dedicated KV key", async () => {
  const kv = makeKv();
  const uid = "99";

  assert.equal(await wasLimitNoticeSentToday(kv, uid), false);
  await markLimitNoticeSent(kv, uid);
  assert.equal(await wasLimitNoticeSentToday(kv, uid), true);
});
