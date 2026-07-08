import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";

export const DAILY_LOGIN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
  const { save } = await loadCloudSave(kv, session.xUserId);
  const now = Date.now();
  const status = getDailyLoginStatus(save, now);
  if (!status.ready) {
    return { ok: false, error: "cooldown", nextClaimAt: status.nextClaimAt };
  }

  const item = {
    id: makeMailId(),
    type: "monballs",
    amount: 1,
    title: "Daily Login Reward",
    body: "1 Monball — open Mailbox in game to claim.",
    createdAt: new Date(now).toISOString(),
  };

  const nextSave = buildSavePayload(
    {
      ...save,
      mailbox: [item, ...(save.mailbox || [])],
      dailyLoginLastClaimAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    },
    session,
    { now }
  );

  await writeCloudSave(kv, session.xUserId, nextSave, { skipStaleCheck: true });

  return {
    ok: true,
    item,
    nextClaimAt: new Date(now + DAILY_LOGIN_COOLDOWN_MS).toISOString(),
    unclaimed: (nextSave.mailbox || []).filter((m) => !m.claimedAt).length,
  };
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
  let monballs = save.monballs || 0;

  if (item.type === "monballs") {
    monballs += item.amount || 1;
  } else {
    return { ok: false, error: "unsupported_reward" };
  }

  item.claimedAt = new Date(now).toISOString();
  mailbox[idx] = item;

  const nextSave = buildSavePayload(
    {
      ...save,
      monballs,
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
