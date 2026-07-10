import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { creditCatchMonballs } from "./grant-monballs.js";

export const DAILY_LOGIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DAILY_LOGIN_REWARD_MONBALLS = 5;

const claimLocks = globalThis.__monexDailyLoginLocks || (globalThis.__monexDailyLoginLocks = new Map());

async function withDailyLoginClaimLock(xUserId, fn) {
  const key = String(xUserId || "");
  while (claimLocks.get(key)) await claimLocks.get(key);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  claimLocks.set(key, gate);
  try {
    return await fn();
  } finally {
    claimLocks.delete(key);
    release();
  }
}

function makeMailId() {
  return `mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getDailyLoginStatus(save, now = Date.now()) {
  const last = save?.dailyLoginLastClaimAt ? Date.parse(save.dailyLoginLastClaimAt) : 0;
  const ready = !Number.isFinite(last) || now - last >= DAILY_LOGIN_COOLDOWN_MS;
  const nextClaimAt = ready
    ? null
    : new Date(last + DAILY_LOGIN_COOLDOWN_MS).toISOString();
  const unclaimed = (save?.mailbox || []).filter((m) => !m.claimedAt).length;
  return { ready, nextClaimAt, unclaimed };
}

export async function claimDailyLoginReward(kv, session) {
  return withDailyLoginClaimLock(session.xUserId, async () => {
    const { save } = await loadCloudSave(kv, session.xUserId);
    const now = Date.now();
    const status = getDailyLoginStatus(save, now);
    if (!status.ready) {
      return { ok: false, error: "cooldown", nextClaimAt: status.nextClaimAt };
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

    await writeCloudSave(kv, session.xUserId, nextSave, { skipStaleCheck: true });

    return {
      ok: true,
      delivery: "mailbox",
      item,
      nextClaimAt: new Date(now + DAILY_LOGIN_COOLDOWN_MS).toISOString(),
      unclaimed: (nextSave.mailbox || []).filter((m) => !m.claimedAt).length,
    };
  });
}

export async function claimMailboxItem(kv, session, mailId) {
  const id = String(mailId || "").trim();
  if (!id) return { ok: false, error: "mail_id_required" };

  const { save } = await loadCloudSave(kv, session.xUserId);
  const mailbox = [...(save.mailbox || [])];
  const idx = mailbox.findIndex((m) => m.id === id && !m.claimedAt);
  if (idx < 0) return { ok: false, error: "not_found" };

  const item = { ...mailbox[idx] };
  const now = Date.now();
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

  const monballsDelta = monballs - monballsBefore;
  if (monballsDelta > 0) {
    await creditCatchMonballs(kv, session, monballsDelta);
  }

  item.claimedAt = new Date(now).toISOString();
  mailbox[idx] = item;

  const nextSave = buildSavePayload(
    {
      ...save,
      monballs,
      money,
      essence,
      monShards,
      trainerXp,
      mailbox,
      updatedAt: new Date(now).toISOString(),
    },
    session,
    { now }
  );

  await writeCloudSave(kv, session.xUserId, nextSave, { skipStaleCheck: true });

  return {
    ok: true,
    item,
    save: nextSave,
    unclaimed: (nextSave.mailbox || []).filter((m) => !m.claimedAt).length,
  };
}
