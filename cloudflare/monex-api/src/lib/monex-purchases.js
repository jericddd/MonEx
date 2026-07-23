/**
 * On-chain pack purchase ledger + used-tx replay protection.
 *
 * Claim locks are SHORT-lived. Finalized purchase records keep a long TTL.
 * Stale/abandoned claims can be reclaimed so a Worker crash cannot permanently
 * strand a paid txHash (the noajolouis mb_50 incident).
 */

import { normalizeTxHash } from "./monex-payment-config.js";
import { getBoundWallet } from "./wallet-bind.js";
import { verifyMonexPackPayment } from "./monex-tx-verify.js";
import { getMonexPaymentConfig } from "./monex-payment-config.js";

const USED_TX_PREFIX = "monex:tx-used:";
const USER_PURCHASES_PREFIX = "monex:purchases:user:";
/** Finalized purchase receipts stay for years (replay protection). */
const USED_TX_TTL_SEC = 60 * 60 * 24 * 365 * 3;
/**
 * In-progress claim locks must expire quickly.
 * A Worker crash/timeout after claim + before finalize previously wrote a
 * 3-year claim lock and permanently blocked retries.
 */
const CLAIM_TTL_SEC = 120;
/** Claims older than this may be taken over by a retry. */
const CLAIM_STALE_MS = 90_000;
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

function parseUsedTxValue(value) {
  if (!value || typeof value !== "string") return { kind: "empty" };
  if (value.startsWith(CLAIM_PREFIX)) {
    // Legacy plain claim:<uuid> — no timestamp → treat as immediately stale.
    return {
      kind: "claim",
      claimId: value,
      at: null,
      stale: true,
      legacy: true,
    };
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed?.status === "claim" || parsed?.kind === "claim") {
      const atMs = parsed.at ? Date.parse(parsed.at) : NaN;
      const age = Number.isFinite(atMs) ? Date.now() - atMs : Number.POSITIVE_INFINITY;
      return {
        kind: "claim",
        claimId: parsed.claimId || null,
        at: parsed.at || null,
        xUserId: parsed.xUserId || null,
        packageId: parsed.packageId || null,
        packageKind: parsed.packageKind || null,
        stale: age > CLAIM_STALE_MS,
        ageMs: age,
        legacy: false,
      };
    }
    if (parsed?.grantedAt || parsed?.status === "confirmed") {
      return { kind: "finalized", record: parsed };
    }
    // Unknown JSON — treat as finalized to avoid replay.
    return { kind: "finalized", record: parsed };
  } catch {
    return { kind: "finalized", record: null };
  }
}

function isCompletedUsedMarker(value) {
  return parseUsedTxValue(value).kind === "finalized";
}

function buildClaimPayload({ claimId, xUserId, packageId, packageKind }) {
  return JSON.stringify({
    status: "claim",
    claimId,
    at: new Date().toISOString(),
    xUserId: xUserId != null ? String(xUserId) : null,
    packageId: packageId != null ? String(packageId) : null,
    packageKind: packageKind != null ? String(packageKind) : null,
  });
}

/**
 * Claim a txHash for granting. Losers of the race must not grant.
 * Stale / legacy long-lived claims are reclaimed.
 */
export async function tryClaimPurchaseTx(kv, txHash, meta = {}) {
  const hash = normalizeTxHash(txHash);
  if (!kv || !hash) return { claimed: false, reason: "invalid_tx_hash" };
  const key = usedTxKey(hash);

  const existing = await kv.get(key);
  if (existing) {
    const parsed = parseUsedTxValue(existing);
    if (parsed.kind === "finalized") {
      return { claimed: false, reason: "already_used", record: parsed.record };
    }
    if (parsed.kind === "claim" && !parsed.stale) {
      return { claimed: false, reason: "in_progress", claim: parsed };
    }
    // Stale claim — delete then fall through to reclaim.
    if (parsed.kind === "claim" && parsed.stale) {
      await kv.delete(key);
    }
  }

  const claimId = `${CLAIM_PREFIX}${crypto.randomUUID()}`;
  const payload = buildClaimPayload({
    claimId,
    xUserId: meta.xUserId,
    packageId: meta.packageId,
    packageKind: meta.packageKind,
  });
  await kv.put(key, payload, { expirationTtl: CLAIM_TTL_SEC });
  const verify = await kv.get(key);
  if (verify !== payload) {
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
  const parsed = parseUsedTxValue(existing);
  if (parsed.kind === "claim") {
    await kv.delete(key);
  }
}

export async function appendUserPurchase(kv, xUserId, entry) {
  if (!kv || !xUserId || !entry) return;
  const key = userPurchasesKey(xUserId);
  const list = (await readJson(kv, key)) || [];
  const txHash = normalizeTxHash(entry.txHash);
  const filtered = (Array.isArray(list) ? list : []).filter(
    (row) => normalizeTxHash(row?.txHash) !== txHash
  );
  const next = [entry, ...filtered].slice(0, MAX_USER_PURCHASES);
  await kv.put(key, JSON.stringify(next));
}

export async function listUserPurchases(kv, xUserId, { limit = 50 } = {}) {
  if (!kv || !xUserId) return [];
  const list = (await readJson(kv, userPurchasesKey(xUserId))) || [];
  const lim = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  return (Array.isArray(list) ? list : []).slice(0, lim);
}

export async function findUserPurchaseByTx(kv, xUserId, txHash) {
  const hash = normalizeTxHash(txHash);
  if (!kv || !xUserId || !hash) return null;
  const list = await listUserPurchases(kv, xUserId, { limit: 100 });
  return list.find((row) => normalizeTxHash(row?.txHash) === hash) || null;
}

function sameGrantTarget(record, session, packageId, packageKind) {
  return (
    record
    && String(record.xUserId) === String(session.xUserId)
    && String(record.packageId) === String(packageId)
    && String(record.packageKind) === String(packageKind)
  );
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

  // Ledger fast path (survives stuck used-tx claim bugs).
  const ledgerHit = await findUserPurchaseByTx(kv, session.xUserId, txHash);
  if (ledgerHit && sameGrantTarget(ledgerHit, session, packageId, packageKind)) {
    return {
      ok: true,
      alreadyGranted: true,
      txHash,
      wallet: bound.wallet,
      record: ledgerHit,
    };
  }

  // Fast path: already finalized for this user
  const existingRaw = await kv.get(usedTxKey(txHash));
  if (existingRaw) {
    const parsed = parseUsedTxValue(existingRaw);
    if (parsed.kind === "finalized") {
      if (sameGrantTarget(parsed.record, session, packageId, packageKind)) {
        return {
          ok: true,
          alreadyGranted: true,
          txHash,
          wallet: bound.wallet,
          record: parsed.record,
        };
      }
      return {
        ok: false,
        error: "tx_already_used",
        message: "This transaction was already used for a purchase.",
      };
    }
  }

  const verified = await verifyMonexPackPayment(env, {
    txHash,
    expectedFrom: bound.wallet,
    expectedMonexPrice: monexPrice,
  });
  if (!verified.ok) return verified;

  const claim = await tryClaimPurchaseTx(kv, txHash, {
    xUserId: session.xUserId,
    packageId,
    packageKind,
  });
  if (!claim.claimed) {
    if (claim.reason === "already_used") {
      const record = claim.record;
      if (sameGrantTarget(record, session, packageId, packageKind)) {
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

export {
  CLAIM_TTL_SEC,
  CLAIM_STALE_MS,
  USED_TX_TTL_SEC,
  parseUsedTxValue,
  isCompletedUsedMarker,
};
