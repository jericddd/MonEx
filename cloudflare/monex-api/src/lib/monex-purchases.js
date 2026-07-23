/**
 * On-chain pack purchase ledger + used-tx replay protection.
 */

import { normalizeTxHash } from "./monex-payment-config.js";
import { getBoundWallet } from "./wallet-bind.js";
import { verifyMonexPackPayment } from "./monex-tx-verify.js";
import { getMonexPaymentConfig } from "./monex-payment-config.js";

const USED_TX_PREFIX = "monex:tx-used:";
const USER_PURCHASES_PREFIX = "monex:purchases:user:";
const USED_TX_TTL_SEC = 60 * 60 * 24 * 365 * 3; // 3 years
const MAX_USER_PURCHASES = 100;
const CLAIM_PREFIX = "claim:";

function usedTxKey(txHash) {
  return `${USED_TX_PREFIX}${normalizeTxHash(txHash) || ""}`;
}

function userPurchasesKey(xUserId) {
  return `${USER_PURCHASES_PREFIX}${String(xUserId)}`;
}

async function readJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isCompletedUsedMarker(value) {
  if (!value || typeof value !== "string") return false;
  if (value.startsWith(CLAIM_PREFIX)) return false;
  try {
    const parsed = JSON.parse(value);
    return !!parsed?.grantedAt;
  } catch {
    return true;
  }
}

/**
 * Claim a txHash for granting. Losers of the race must not grant.
 */
export async function tryClaimPurchaseTx(kv, txHash) {
  const hash = normalizeTxHash(txHash);
  if (!kv || !hash) return { claimed: false, reason: "invalid_tx_hash" };
  const key = usedTxKey(hash);
  const existing = await kv.get(key);
  if (existing) {
    if (isCompletedUsedMarker(existing)) {
      let record = null;
      try {
        record = JSON.parse(existing);
      } catch {
        record = null;
      }
      return { claimed: false, reason: "already_used", record };
    }
    return { claimed: false, reason: "in_progress" };
  }
  const claimId = `${CLAIM_PREFIX}${crypto.randomUUID()}`;
  await kv.put(key, claimId, { expirationTtl: USED_TX_TTL_SEC });
  const verify = await kv.get(key);
  if (verify !== claimId) {
    return { claimed: false, reason: "lost_race" };
  }
  return { claimed: true, claimId, txHash: hash };
}

export async function finalizePurchaseTx(kv, txHash, record) {
  const hash = normalizeTxHash(txHash);
  if (!kv || !hash || !record) return;
  await kv.put(usedTxKey(hash), JSON.stringify(record), { expirationTtl: USED_TX_TTL_SEC });
}

export async function releasePurchaseTxClaim(kv, txHash) {
  const hash = normalizeTxHash(txHash);
  if (!kv || !hash) return;
  const key = usedTxKey(hash);
  const existing = await kv.get(key);
  if (typeof existing === "string" && existing.startsWith(CLAIM_PREFIX)) {
    await kv.delete(key);
  }
}

export async function appendUserPurchase(kv, xUserId, entry) {
  if (!kv || !xUserId || !entry) return;
  const key = userPurchasesKey(xUserId);
  const list = (await readJson(kv, key)) || [];
  const next = [entry, ...(Array.isArray(list) ? list : [])].slice(0, MAX_USER_PURCHASES);
  await kv.put(key, JSON.stringify(next));
}

export async function listUserPurchases(kv, xUserId, { limit = 50 } = {}) {
  if (!kv || !xUserId) return [];
  const list = (await readJson(kv, userPurchasesKey(xUserId))) || [];
  const lim = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  return (Array.isArray(list) ? list : []).slice(0, lim);
}

/**
 * Verify payment + claim tx for a pack. Caller grants items then finalizePurchaseTx.
 * Idempotent: if same user already granted this tx for same package, returns alreadyGranted.
 */
export async function prepareVerifiedPackPayment(kv, session, env, {
  packageId,
  packageKind,
  monexPrice,
  paymentProof,
} = {}) {
  const txHash = normalizeTxHash(paymentProof?.txHash);
  if (!txHash) {
    return {
      ok: false,
      error: "monex_payment_required",
      message: "Send exact $MONEX to the vault, then submit the transaction hash.",
    };
  }

  const bound = await getBoundWallet(kv, session.xUserId);
  if (!bound?.wallet) {
    return {
      ok: false,
      error: "wallet_not_bound",
      message: "Bind a hot wallet in Profile before buying with $MONEX.",
    };
  }

  // Fast path: already finalized for this user
  const existingRaw = await kv.get(usedTxKey(txHash));
  if (existingRaw && isCompletedUsedMarker(existingRaw)) {
    let record = null;
    try {
      record = JSON.parse(existingRaw);
    } catch {
      record = null;
    }
    if (
      record
      && String(record.xUserId) === String(session.xUserId)
      && String(record.packageId) === String(packageId)
      && String(record.packageKind) === String(packageKind)
    ) {
      return {
        ok: true,
        alreadyGranted: true,
        txHash,
        wallet: bound.wallet,
        record,
      };
    }
    return {
      ok: false,
      error: "tx_already_used",
      message: "This transaction was already used for a purchase.",
    };
  }

  const verified = await verifyMonexPackPayment(env, {
    txHash,
    expectedFrom: bound.wallet,
    expectedMonexPrice: monexPrice,
  });
  if (!verified.ok) return verified;

  const claim = await tryClaimPurchaseTx(kv, txHash);
  if (!claim.claimed) {
    if (claim.reason === "already_used") {
      const record = claim.record;
      if (
        record
        && String(record.xUserId) === String(session.xUserId)
        && String(record.packageId) === String(packageId)
        && String(record.packageKind) === String(packageKind)
      ) {
        return {
          ok: true,
          alreadyGranted: true,
          txHash,
          wallet: bound.wallet,
          record,
        };
      }
      return {
        ok: false,
        error: "tx_already_used",
        message: "This transaction was already used for a purchase.",
      };
    }
    return {
      ok: false,
      error: "purchase_in_progress",
      message: "Purchase is already being processed. Try again in a moment.",
    };
  }

  const cfg = getMonexPaymentConfig(env);
  return {
    ok: true,
    alreadyGranted: false,
    txHash,
    wallet: bound.wallet,
    claimId: claim.claimId,
    verified,
    explorerTxUrl: `${cfg.explorerTxUrl}${txHash}`,
  };
}

export function buildPurchaseRecord({
  session,
  packageId,
  packageKind,
  monexPrice,
  grant,
  txHash,
  wallet,
  verified,
}) {
  return {
    txHash,
    xUserId: String(session.xUserId),
    username: session.username || null,
    packageId: String(packageId),
    packageKind: String(packageKind),
    monexPrice: Math.floor(Number(monexPrice) || 0),
    grant: grant || {},
    wallet,
    from: verified?.from || wallet,
    to: verified?.to || null,
    valueWei: verified?.valueWei || null,
    blockNumber: verified?.blockNumber ?? null,
    grantedAt: new Date().toISOString(),
    status: "confirmed",
  };
}
