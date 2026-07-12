import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { creditCatchMonballs } from "./grant-monballs.js";
import { appendMonballAudit } from "./monball-audit.js";
import { mailboxHasCapacity } from "./save-validate.js";

import {
  isDailyLoginReady,
  getDailyLoginNextClaimAt,
  getDailyDayKey,
  getDailyLoginDayKeyFromTimestamp,
} from "./daily-reset.js";

export const DAILY_LOGIN_REWARD_MONBALLS = 5;

const MAIL_CLAIM_RECEIPT_PREFIX = "monex:mailbox-claim:";
const DAILY_LOGIN_RECEIPT_PREFIX = "monex:daily-login-claim:";
const MAX_CLAIM_RETRIES = 4;

const claimLocks = globalThis.__monexDailyLoginLocks || (globalThis.__monexDailyLoginLocks = new Map());
const mailClaimLocks = globalThis.__monexMailClaimLocks || (globalThis.__monexMailClaimLocks = new Map());

async function acquireKeyedLock(lockMap, key) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  while (true) {
    if (!lockMap.has(key)) {
      lockMap.set(key, gate);
      break;
    }
    await lockMap.get(key);
  }
  return () => {
    if (lockMap.get(key) === gate) lockMap.delete(key);
    release();
  };
}

async function withUserMailboxLock(xUserId, fn) {
  const key = String(xUserId || "");
  const release = await acquireKeyedLock(claimLocks, key);
  try {
    return await fn();
  } finally {
    release();
  }
}

async function withMailClaimLock(xUserId, mailId, fn) {
  const key = `${String(xUserId || "")}:${String(mailId || "")}`;
  const release = await acquireKeyedLock(mailClaimLocks, key);
  try {
    return await fn();
  } finally {
    release();
  }
}

function mailClaimReceiptKey(xUserId, mailId) {
  return `${MAIL_CLAIM_RECEIPT_PREFIX}${String(xUserId || "")}:${String(mailId || "")}`;
}

function makeMailId() {
  return `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function findMailboxItem(mailbox, mailId) {
  return (mailbox || []).find((m) => m?.id === mailId) || null;
}

function computeMailboxRewardDeltas(save, item) {
  const monballsBefore = save.monballs || 0;
  let monballs = monballsBefore;
  let money = save.money || 0;
  let essence = save.essence || 0;
  let monShards = save.monShards || 0;
  let trainerXp = save.trainerXp || 0;

  if (item.type === "monballs") {
    monballs += item.amount || 1;
  } else if (item.type === "resources" && item.grant && typeof item.grant === "object") {
    if (item.grant.gold) money += item.grant.gold;
    if (item.grant.essence) essence += item.grant.essence;
    if (item.grant.monballs) monballs += item.grant.monballs;
    if (item.grant.monShards) monShards += item.grant.monShards;
    if (item.grant.trainerXp) trainerXp += item.grant.trainerXp;
  } else {
    return { ok: false, error: "unsupported_reward" };
  }

  return {
    ok: true,
    monballs,
    money,
    essence,
    monShards,
    trainerXp,
    monballsDelta: monballs - monballsBefore,
  };
}

function buildAlreadyClaimedResult(save, item) {
  return {
    ok: true,
    alreadyClaimed: true,
    item,
    save,
    unclaimed: (save.mailbox || []).filter((m) => !m.claimedAt).length,
  };
}

export function getDailyLoginStatus(save, now = Date.now()) {
  const ready = isDailyLoginReady(save, now);
  const nextClaimAt = ready ? null : getDailyLoginNextClaimAt(now);
  const unclaimed = (save?.mailbox || []).filter((m) => !m.claimedAt).length;
  return { ready, nextClaimAt, unclaimed };
}

function dailyLoginReceiptKey(xUserId, dayKey) {
  return `${DAILY_LOGIN_RECEIPT_PREFIX}${String(xUserId || "")}:${String(dayKey || "")}`;
}

function findDailyLoginMailForDay(mailbox, dayKey) {
  return (mailbox || []).find(
    (m) =>
      m?.title === "Daily Login Reward"
      && getDailyLoginDayKeyFromTimestamp(m.createdAt) === dayKey
  ) || null;
}

function buildDailyLoginAlreadyClaimed(save, dayKey, now = Date.now()) {
  const mail = findDailyLoginMailForDay(save.mailbox, dayKey);
  return {
    ok: true,
    alreadyClaimed: true,
    delivery: "mailbox",
    item: mail || null,
    nextClaimAt: getDailyLoginNextClaimAt(now),
    unclaimed: (save.mailbox || []).filter((m) => !m.claimedAt).length,
  };
}

export async function claimDailyLoginReward(kv, session) {
  return withUserMailboxLock(session.xUserId, async () => {
    const now = Date.now();
    const dayKey = getDailyDayKey(new Date(now));
    const receiptRaw = await kv.get(dailyLoginReceiptKey(session.xUserId, dayKey));
    if (receiptRaw) {
      const { save } = await loadCloudSave(kv, session.xUserId);
      return buildDailyLoginAlreadyClaimed(save, dayKey, now);
    }

    return persistDailyLoginClaim(kv, session, dayKey, now);
  });
}

async function persistDailyLoginClaim(kv, session, dayKey, now, attempt = 0) {
  const { save } = await loadCloudSave(kv, session.xUserId);
  const expectedRevision = Number.isFinite(Number(save.revision)) ? Number(save.revision) : 0;
  const status = getDailyLoginStatus(save, now);

  if (!status.ready) {
    const existing = findDailyLoginMailForDay(save.mailbox, dayKey);
    if (existing) return buildDailyLoginAlreadyClaimed(save, dayKey, now);
    return { ok: false, error: "cooldown", nextClaimAt: status.nextClaimAt };
  }
  if (!mailboxHasCapacity(save.mailbox)) {
    return { ok: false, error: "mailbox_full" };
  }

  const monballsBefore = save.monballs ?? 0;
  const item = {
    id: makeMailId(),
    type: "monballs",
    amount: DAILY_LOGIN_REWARD_MONBALLS,
    title: "Daily Login Reward",
    body: `${DAILY_LOGIN_REWARD_MONBALLS} Monballs — open Mailbox in game to claim.`,
    createdAt: new Date(now).toISOString(),
  };

  const nextSave = buildSavePayload(
    {
      ...save,
      monballs: monballsBefore,
      mailbox: [item, ...(save.mailbox || [])],
      dailyLoginLastClaimAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    session,
    { now }
  );

  const delivered = (nextSave.mailbox || []).some(
    (mail) => mail.id === item.id && !mail.claimedAt && mail.type === "monballs"
  );
  if (!delivered || nextSave.monballs !== monballsBefore) {
    return { ok: false, error: "mailbox_delivery_failed" };
  }

  try {
    await writeCloudSave(kv, session.xUserId, nextSave, { expectedRevision });
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      return persistDailyLoginClaim(kv, session, dayKey, now, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      const existing = findDailyLoginMailForDay(latest.mailbox, dayKey);
      if (existing || !isDailyLoginReady(latest, now)) {
        return buildDailyLoginAlreadyClaimed(latest, dayKey, now);
      }
      return { ok: false, error: "claim_conflict" };
    }
    throw err;
  }

  await kv.put(dailyLoginReceiptKey(session.xUserId, dayKey), item.createdAt);

  return {
    ok: true,
    delivery: "mailbox",
    item,
    nextClaimAt: getDailyLoginNextClaimAt(now),
    unclaimed: (nextSave.mailbox || []).filter((m) => !m.claimedAt).length,
  };
}

async function persistMailboxClaim(kv, session, mailId, attempt = 0) {
  const id = String(mailId || "").trim();
  const { save } = await loadCloudSave(kv, session.xUserId);
  const expectedRevision = Number.isFinite(Number(save.revision)) ? Number(save.revision) : 0;
  const mailbox = [...(save.mailbox || [])];
  const existing = findMailboxItem(mailbox, id);

  if (!existing) {
    return { ok: false, error: "not_found" };
  }
  if (existing.claimedAt) {
    return buildAlreadyClaimedResult(save, existing);
  }

  const receiptRaw = await kv.get(mailClaimReceiptKey(session.xUserId, id));
  if (receiptRaw) {
    const claimedItem = { ...existing, claimedAt: existing.claimedAt || receiptRaw };
    return buildAlreadyClaimedResult(save, claimedItem);
  }

  const idx = mailbox.findIndex((m) => m.id === id && !m.claimedAt);
  if (idx < 0) {
    return buildAlreadyClaimedResult(save, existing);
  }

  const item = { ...mailbox[idx] };
  const now = Date.now();
  const reward = computeMailboxRewardDeltas(save, item);
  if (!reward.ok) return reward;

  item.claimedAt = new Date(now).toISOString();
  mailbox[idx] = item;

  const nextSave = buildSavePayload(
    {
      ...save,
      monballs: reward.monballs,
      money: reward.money,
      essence: reward.essence,
      monShards: reward.monShards,
      trainerXp: reward.trainerXp,
      mailbox,
      updatedAt: new Date(now).toISOString(),
    },
    session,
    { now }
  );

  try {
    await writeCloudSave(kv, session.xUserId, nextSave, { expectedRevision });
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      return persistMailboxClaim(kv, session, mailId, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      const claimed = findMailboxItem(latest.mailbox, id);
      if (claimed?.claimedAt) {
        return buildAlreadyClaimedResult(latest, claimed);
      }
      return { ok: false, error: "claim_conflict" };
    }
    throw err;
  }

  await kv.put(mailClaimReceiptKey(session.xUserId, id), item.claimedAt);

  if (reward.monballsDelta > 0) {
    await creditCatchMonballs(kv, session, reward.monballsDelta, 10, "mailbox_claim");
    await appendMonballAudit(kv, {
      xUserId: session.xUserId,
      username: session.username,
      source: "mailbox_claim",
      delta: reward.monballsDelta,
      balanceBefore: save.monballs || 0,
      balanceAfter: reward.monballs,
      meta: { mailId: id, mailType: item.type, pool: "cloud_save" },
    });
  }

  return {
    ok: true,
    item,
    save: nextSave,
    unclaimed: (nextSave.mailbox || []).filter((m) => !m.claimedAt).length,
  };
}

export async function claimMailboxItem(kv, session, mailId) {
  const id = String(mailId || "").trim();
  if (!id) return { ok: false, error: "mail_id_required" };

  return withUserMailboxLock(session.xUserId, async () =>
    withMailClaimLock(session.xUserId, id, async () => persistMailboxClaim(kv, session, id))
  );
}
