/**
 * Configurable MonBall purchase packages (MONEX-priced).
 * Catalog is server-authoritative — frontend must load via API, not hardcode prices.
 *
 * Optional env override:
 *   MONBALL_PACKAGES_JSON='[{"id":"mb_10","amount":10,"monexPrice":10000,"active":true,"displayOrder":1},...]'
 *
 * Optional purchase grant (staging / until on-chain MONEX settle is live):
 *   ENABLE_MONBALL_PACKAGE_PURCHASE=1
 */

import { loadCloudSave, writeCloudSave, buildSavePayload } from "./save.js";
import { creditCatchMonballs, clampMonballs } from "./grant-monballs.js";
import { reconcileMonballsForCloudSave } from "./save-reconcile.js";
import { QUEST_TASK_GOALS } from "./save-economy-guard.js";
import {
  prepareVerifiedPackPayment,
  buildPurchaseRecord,
  finalizePurchaseTx,
  releasePurchaseTxClaim,
  appendUserPurchase,
} from "./monex-purchases.js";
import { getMonexPaymentConfig } from "./monex-payment-config.js";
import {
  resolveCatchUserKv,
  saveCatchUserRecord,
} from "./catch-user-store.js";
import { appendMonballAudit } from "./monball-audit.js";
import { withUserSyncLock, userSyncLockKey } from "../kv-store.js";

const MAX_CLAIM_RETRIES = 3;

/** Default packages — prices editable here or via MONBALL_PACKAGES_JSON. */
export const DEFAULT_MONBALL_PACKAGES = Object.freeze([
  Object.freeze({
    id: "mb_10",
    amount: 10,
    monexPrice: 10_000,
    active: true,
    displayOrder: 1,
    featured: false,
  }),
  Object.freeze({
    id: "mb_50",
    amount: 50,
    monexPrice: 50_000,
    active: true,
    displayOrder: 2,
    featured: false,
  }),
  Object.freeze({
    id: "mb_100",
    amount: 100,
    monexPrice: 100_000,
    active: true,
    displayOrder: 3,
    featured: true,
  }),
]);

const SHOP_BUY_TASKS = Object.freeze([
  { tab: "dailies", id: "d3" },
  { tab: "dailies", id: "d10" },
  { tab: "weeklies", id: "w9" },
]);

function bumpShopBuyQuestProgress(questState, qty) {
  const qs = questState && typeof questState === "object" ? { ...questState } : {};
  const tasks = {
    dailies: Array.isArray(qs.tasks?.dailies) ? qs.tasks.dailies.map((t) => ({ ...t })) : [],
    weeklies: Array.isArray(qs.tasks?.weeklies) ? qs.tasks.weeklies.map((t) => ({ ...t })) : [],
    campaign: Array.isArray(qs.tasks?.campaign) ? qs.tasks.campaign.map((t) => ({ ...t })) : [],
  };
  const add = Math.max(1, Math.floor(Number(qty) || 1));
  for (const { tab, id } of SHOP_BUY_TASKS) {
    const goal = QUEST_TASK_GOALS[tab]?.[id] ?? 1;
    const list = tasks[tab];
    const idx = list.findIndex((t) => t?.id === id);
    if (idx >= 0) {
      const task = list[idx];
      list[idx] = {
        ...task,
        progress: Math.min(goal, (task.progress || 0) + add),
      };
    } else {
      list.push({ id, progress: Math.min(goal, add), claimed: false });
    }
  }
  return { ...qs, tasks };
}

function normalizePackage(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  const amount = Math.floor(Number(raw.amount));
  const monexPrice = Number(raw.monexPrice);
  if (!id || !Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(monexPrice) || monexPrice < 0) return null;
  const displayOrder = Number.isFinite(Number(raw.displayOrder))
    ? Math.floor(Number(raw.displayOrder))
    : index + 1;
  return {
    id,
    amount,
    monexPrice,
    active: raw.active !== false,
    displayOrder,
    featured: raw.featured === true,
  };
}

function parsePackagesFromEnv(env) {
  const raw = env?.MONBALL_PACKAGES_JSON;
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const packages = parsed
      .map((p, i) => normalizePackage(p, i))
      .filter(Boolean);
    return packages.length ? packages : null;
  } catch {
    return null;
  }
}

/**
 * Resolve active package catalog (sorted by displayOrder).
 * @param {object} [env]
 */
export function listMonballPackages(env = {}) {
  const fromEnv = parsePackagesFromEnv(env);
  const all = fromEnv || DEFAULT_MONBALL_PACKAGES.map((p) => ({ ...p }));
  return all
    .filter((p) => p.active)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.amount - b.amount);
}

/**
 * Find a package by id (active only unless includeInactive).
 */
export function findMonballPackage(env, packageId, { includeInactive = false } = {}) {
  const id = String(packageId || "").trim();
  if (!id) return null;
  const fromEnv = parsePackagesFromEnv(env);
  const all = fromEnv || DEFAULT_MONBALL_PACKAGES.map((p) => ({ ...p }));
  const found = all.find((p) => p.id === id) || null;
  if (!found) return null;
  if (!includeInactive && !found.active) return null;
  return found;
}

export function publicPackageView(pkg) {
  if (!pkg) return null;
  return {
    id: pkg.id,
    amount: pkg.amount,
    monexPrice: pkg.monexPrice,
    displayOrder: pkg.displayOrder,
    featured: pkg.featured === true,
  };
}

function monballPackagePurchaseEnabled(env) {
  return String(env?.ENABLE_MONBALL_PACKAGE_PURCHASE || "") === "1";
}

/** Roll back catch-pool credit if cloud-save persist fails after payment claim. */
async function debitCatchMonballs(kv, session, delta, startingMonballs = 10, auditSource = "monball_package_rollback") {
  const amount = clampMonballs(delta);
  if (!amount || !session?.xUserId) return null;
  return withUserSyncLock(userSyncLockKey(session.xUserId, session.username), async () => {
    const user = await resolveCatchUserKv(kv, session.xUserId, session.username, startingMonballs);
    if (!user) return null;
    const before = clampMonballs(user.monballs ?? 0);
    user.monballs = clampMonballs(before - amount);
    user.updatedAt = new Date().toISOString();
    await saveCatchUserRecord(kv, session.xUserId, user);
    await appendMonballAudit(kv, {
      xUserId: session.xUserId,
      username: session.username,
      source: auditSource,
      delta: -amount,
      balanceAfter: user.monballs,
      meta: { pool: "catch" },
    });
    return user.monballs;
  });
}

async function persistPackageSave(kv, session, save, expectedRevision, startingMonballs, attempt = 0) {
  const now = Date.now();
  let payload = buildSavePayload(
    { ...save, updatedAt: new Date(now).toISOString() },
    session,
    { now }
  );
  await reconcileMonballsForCloudSave(kv, session, payload, startingMonballs);
  try {
    const written = await writeCloudSave(kv, session.xUserId, payload, { expectedRevision });
    return { ok: true, save: written };
  } catch (err) {
    if (err?.code === "revision_conflict" && attempt < MAX_CLAIM_RETRIES) {
      const { save: latest } = await loadCloudSave(kv, session.xUserId);
      return persistPackageSave(kv, session, latest, latest.revision, startingMonballs, attempt + 1);
    }
    if (err?.code === "revision_conflict") {
      return { ok: false, error: "purchase_conflict", save: err.existingSave };
    }
    throw err;
  }
}

/**
 * Purchase a MonBall package by id.
 * Production: requires verified on-chain $MONEX payment (paymentProof.txHash).
 * Staging: ENABLE_MONBALL_PACKAGE_PURCHASE=1 grants without payment.
 */
export async function purchaseMonballPackage(
  kv,
  session,
  { packageId, expectedRevision, paymentProof } = {},
  startingMonballs = 10,
  env = {}
) {
  const pkg = findMonballPackage(env, packageId);
  if (!pkg) return { ok: false, error: "invalid_package" };

  const view = publicPackageView(pkg);
  const stagingGrant = monballPackagePurchaseEnabled(env);
  const hasPaymentProof = !!(paymentProof && typeof paymentProof === "object" && paymentProof.txHash);

  let paymentMeta = null;
  if (!stagingGrant) {
    const prepared = await prepareVerifiedPackPayment(kv, session, env, {
      packageId: pkg.id,
      packageKind: "monball",
      monexPrice: pkg.monexPrice,
      paymentProof,
    });
    if (!prepared.ok) {
      return {
        ...prepared,
        package: view,
        currency: "MONEX",
        payment: getMonexPaymentConfig(env),
      };
    }
    if (prepared.alreadyGranted) {
      const { save } = await loadCloudSave(kv, session.xUserId);
      return {
        ok: true,
        alreadyGranted: true,
        package: view,
        currency: "MONEX",
        monexPrice: pkg.monexPrice,
        grantedMonballs: pkg.amount,
        txHash: prepared.txHash,
        save,
      };
    }
    paymentMeta = prepared;
  } else if (!hasPaymentProof && !stagingGrant) {
    return {
      ok: false,
      error: "monex_payment_required",
      package: view,
      currency: "MONEX",
      message: "Send exact $MONEX to the vault, then submit the transaction hash.",
      payment: getMonexPaymentConfig(env),
    };
  }

  let catchCredited = false;
  try {
    const { save } = await loadCloudSave(kv, session.xUserId);

    // Credit catch pool first so reconcile won't clamp large package grants
    // under MAX_SAVE_DELTA.monballs.
    const catchBalance = await creditCatchMonballs(
      kv,
      session,
      pkg.amount,
      startingMonballs,
      "monball_package_purchase"
    );
    catchCredited = true;
    const grantedBalance = clampMonballs(
      catchBalance != null ? catchBalance : (save.monballs || 0) + pkg.amount
    );

    let nextSave = {
      ...save,
      monballs: grantedBalance,
    };
    nextSave.questState = bumpShopBuyQuestProgress(nextSave.questState, 1);

    const result = await persistPackageSave(kv, session, nextSave, expectedRevision, startingMonballs);
    if (!result.ok) {
      if (catchCredited) {
        try {
          await debitCatchMonballs(kv, session, pkg.amount, startingMonballs);
        } catch (_) {
          /* best-effort rollback */
        }
      }
      if (paymentMeta?.txHash) await releasePurchaseTxClaim(kv, paymentMeta.txHash);
      return result;
    }

    if (paymentMeta?.txHash) {
      const record = buildPurchaseRecord({
        session,
        packageId: pkg.id,
        packageKind: "monball",
        monexPrice: pkg.monexPrice,
        grant: { monballs: pkg.amount },
        txHash: paymentMeta.txHash,
        wallet: paymentMeta.wallet,
        verified: paymentMeta.verified,
      });
      await finalizePurchaseTx(kv, paymentMeta.txHash, record);
      await appendUserPurchase(kv, session.xUserId, {
        ...record,
        explorerTxUrl: paymentMeta.explorerTxUrl,
      });
    }

    return {
      ok: true,
      package: view,
      currency: "MONEX",
      monexPrice: pkg.monexPrice,
      grantedMonballs: pkg.amount,
      txHash: paymentMeta?.txHash || null,
      save: result.save,
    };
  } catch (err) {
    if (catchCredited) {
      try {
        await debitCatchMonballs(kv, session, pkg.amount, startingMonballs);
      } catch (_) {
        /* best-effort rollback */
      }
    }
    if (paymentMeta?.txHash) await releasePurchaseTxClaim(kv, paymentMeta.txHash);
    throw err;
  }
}
