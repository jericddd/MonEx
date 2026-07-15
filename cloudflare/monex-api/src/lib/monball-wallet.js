import { lookupCatchUserKv, saveCatchUserRecord } from "./catch-user-store.js";
import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { clampMonballs } from "./grant-monballs.js";
import { appendMonballAudit } from "./monball-audit.js";
import { resolveMergedMonballs } from "./save-reconcile.js";

/**
 * Single in-game MonBall wallet — cloud save is authoritative; catch-user KV mirrors it.
 * On read, merges catch-user + save using existing reconcile rules so active players are not zeroed.
 */
export async function getWalletMonballs(kv, xUserId, username, startingMonballs = 10) {
  if (!xUserId) return clampMonballs(startingMonballs);
  const { save, found } = await loadCloudSave(kv, xUserId);
  const catchUser = await lookupCatchUserKv(kv, xUserId, username, startingMonballs);
  const catchVal = clampMonballs(catchUser?.monballs ?? startingMonballs);

  if (!found) {
    return catchVal;
  }

  const balance = resolveMergedMonballs(catchUser, save, catchVal);

  if (catchUser && clampMonballs(catchUser.monballs ?? 0) !== balance) {
    catchUser.monballs = balance;
    catchUser.updatedAt = new Date().toISOString();
    await saveCatchUserRecord(kv, xUserId, catchUser);
  }

  const saveVal = clampMonballs(save?.monballs ?? startingMonballs);
  if (saveVal !== balance) {
    const now = new Date().toISOString();
    const nextSave = buildSavePayload(
      {
        ...save,
        monballs: balance,
        xHandle: save?.xHandle || String(username || "").replace(/^@/, "").toLowerCase(),
        updatedAt: now,
      },
      { xUserId, username }
    );
    await writeCloudSave(kv, xUserId, nextSave, { skipStaleCheck: true });
  }

  return balance;
}

export async function writeWalletMonballs(kv, session, balance, startingMonballs = 10, auditMeta = {}) {
  if (!session?.xUserId) return clampMonballs(balance);
  const target = clampMonballs(balance);
  const { save, found } = await loadCloudSave(kv, session.xUserId);
  const catchUser = await lookupCatchUserKv(kv, session.xUserId, session.username, startingMonballs);
  const before = found
    ? clampMonballs(save?.monballs ?? 0)
    : clampMonballs(catchUser?.monballs ?? startingMonballs);

  const now = new Date().toISOString();
  const nextSave = buildSavePayload(
    {
      ...(found ? save : {}),
      monballs: target,
      xHandle: save?.xHandle || String(session.username || "").replace(/^@/, "").toLowerCase(),
      updatedAt: now,
    },
    session
  );
  await writeCloudSave(kv, session.xUserId, nextSave, { skipStaleCheck: true });

  if (catchUser) {
    catchUser.monballs = target;
    catchUser.updatedAt = now;
    await saveCatchUserRecord(kv, session.xUserId, catchUser);
  }

  if (before !== target) {
    await appendMonballAudit(kv, {
      xUserId: session.xUserId,
      username: session.username,
      source: auditMeta.source || "wallet_write",
      delta: target - before,
      balanceAfter: target,
      meta: { pool: "wallet", ...auditMeta.meta },
    });
  }

  return { balance: target, save: nextSave, before };
}

export async function debitWalletMonballs(kv, session, amount, startingMonballs = 10, auditMeta = {}) {
  const spend = clampMonballs(amount);
  if (!spend || !session?.xUserId) {
    return { ok: false, error: "invalid_amount" };
  }
  const before = await getWalletMonballs(kv, session.xUserId, session.username, startingMonballs);
  if (before < spend) {
    return { ok: false, error: "insufficient_monballs", before, required: spend };
  }
  const written = await writeWalletMonballs(kv, session, before - spend, startingMonballs, {
    source: auditMeta.source || "wallet_debit",
    meta: { spend, ...auditMeta.meta },
  });
  return { ok: true, before, after: written.balance, save: written.save };
}

export async function creditWalletMonballs(kv, session, amount, startingMonballs = 10, auditMeta = {}) {
  const credit = clampMonballs(amount);
  if (!credit || !session?.xUserId) return { ok: false, error: "invalid_amount" };
  const before = await getWalletMonballs(kv, session.xUserId, session.username, startingMonballs);
  const written = await writeWalletMonballs(kv, session, before + credit, startingMonballs, {
    source: auditMeta.source || "wallet_credit",
    meta: { credit, ...auditMeta.meta },
  });
  return { ok: true, before, after: written.balance, save: written.save };
}
