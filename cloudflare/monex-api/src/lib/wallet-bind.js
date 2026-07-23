/**
 * X account ↔ hot wallet bind / unbind (sign-message ownership proof).
 * One wallet may bind to only one xUserId.
 */

import { verifyMessage } from "viem";
import { normalizeAddress } from "./monex-payment-config.js";

const USER_KEY_PREFIX = "monex:wallet-bind:user:";
const ADDR_KEY_PREFIX = "monex:wallet-bind:addr:";
const NONCE_KEY_PREFIX = "monex:wallet-nonce:user:";
const NONCE_TTL_SEC = 10 * 60;

function userBindKey(xUserId) {
  return `${USER_KEY_PREFIX}${String(xUserId)}`;
}

function addrBindKey(wallet) {
  return `${ADDR_KEY_PREFIX}${normalizeAddress(wallet) || ""}`;
}

function nonceKey(xUserId) {
  return `${NONCE_KEY_PREFIX}${String(xUserId)}`;
}

export function buildWalletBindMessage({ purpose, nonce, walletAddress, xUsername }) {
  const action =
    purpose === "unbind"
      ? "Unbind this wallet from your MonEx account"
      : "Bind this wallet to your MonEx account";
  return [
    "MonEx — Wallet Verification",
    "",
    action,
    `X: @${xUsername || "trainer"}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    "",
    "This signature does not send a transaction or spend funds.",
  ].join("\n");
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

export async function getBoundWallet(kv, xUserId) {
  if (!kv || !xUserId) return null;
  const row = await readJson(kv, userBindKey(xUserId));
  if (!row?.wallet || !row?.boundAt) return null;
  const wallet = normalizeAddress(row.wallet);
  if (!wallet) return null;
  return {
    wallet,
    boundAt: row.boundAt,
    username: row.username || null,
  };
}

export async function getWalletOwner(kv, walletAddress) {
  const wallet = normalizeAddress(walletAddress);
  if (!kv || !wallet) return null;
  const row = await readJson(kv, addrBindKey(wallet));
  if (!row?.xUserId) return null;
  return { xUserId: String(row.xUserId), username: row.username || null };
}

/**
 * Issue a bind or unbind nonce. Client must sign the returned message.
 */
export async function issueWalletNonce(kv, session, { walletAddress, purpose = "bind" } = {}) {
  const xUserId = session?.xUserId;
  if (!kv || !xUserId) return { ok: false, error: "unauthorized" };

  const purposeKey = purpose === "unbind" ? "unbind" : "bind";
  const current = await getBoundWallet(kv, xUserId);

  if (purposeKey === "unbind") {
    if (!current) return { ok: false, error: "wallet_not_bound" };
    const wallet = current.wallet;
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString();
    const message = buildWalletBindMessage({
      purpose: "unbind",
      nonce,
      walletAddress: wallet,
      xUsername: session.username,
    });
    await kv.put(
      nonceKey(xUserId),
      JSON.stringify({ nonce, wallet, purpose: "unbind", expiresAt }),
      { expirationTtl: NONCE_TTL_SEC }
    );
    return { ok: true, purpose: "unbind", wallet, message, nonce, expiresAt };
  }

  const wallet = normalizeAddress(walletAddress);
  if (!wallet) return { ok: false, error: "invalid_wallet" };

  if (current?.wallet === wallet) {
    return {
      ok: true,
      alreadyBound: true,
      wallet,
      boundAt: current.boundAt,
    };
  }

  if (current?.wallet && current.wallet !== wallet) {
    return {
      ok: false,
      error: "wallet_already_bound",
      message: "Unbind your current wallet before linking a different one.",
      wallet: current.wallet,
    };
  }

  const owner = await getWalletOwner(kv, wallet);
  if (owner && owner.xUserId !== String(xUserId)) {
    return {
      ok: false,
      error: "wallet_taken",
      message: "This wallet is already linked to another MonEx account.",
    };
  }

  const nonce = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + NONCE_TTL_SEC * 1000).toISOString();
  const message = buildWalletBindMessage({
    purpose: "bind",
    nonce,
    walletAddress: wallet,
    xUsername: session.username,
  });
  await kv.put(
    nonceKey(xUserId),
    JSON.stringify({ nonce, wallet, purpose: "bind", expiresAt }),
    { expirationTtl: NONCE_TTL_SEC }
  );
  return { ok: true, purpose: "bind", wallet, message, nonce, expiresAt, alreadyBound: false };
}

export async function confirmWalletBind(kv, session, { walletAddress, signature } = {}) {
  const xUserId = session?.xUserId;
  if (!kv || !xUserId) return { ok: false, error: "unauthorized" };
  const wallet = normalizeAddress(walletAddress);
  if (!wallet) return { ok: false, error: "invalid_wallet" };
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    return { ok: false, error: "invalid_signature" };
  }

  const pending = await readJson(kv, nonceKey(xUserId));
  if (!pending?.nonce || pending.purpose !== "bind") {
    return { ok: false, error: "nonce_required" };
  }
  if (normalizeAddress(pending.wallet) !== wallet) {
    return { ok: false, error: "wallet_mismatch" };
  }
  if (pending.expiresAt && Date.parse(pending.expiresAt) < Date.now()) {
    return { ok: false, error: "nonce_expired" };
  }

  const message = buildWalletBindMessage({
    purpose: "bind",
    nonce: pending.nonce,
    walletAddress: wallet,
    xUsername: session.username,
  });

  let valid = false;
  try {
    valid = await verifyMessage({
      address: wallet,
      message,
      signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "invalid_signature" };

  const current = await getBoundWallet(kv, xUserId);
  if (current?.wallet && current.wallet !== wallet) {
    return { ok: false, error: "wallet_already_bound", wallet: current.wallet };
  }

  const owner = await getWalletOwner(kv, wallet);
  if (owner && owner.xUserId !== String(xUserId)) {
    return { ok: false, error: "wallet_taken" };
  }

  const boundAt = new Date().toISOString();
  const row = {
    wallet,
    boundAt,
    username: session.username || null,
    xUserId: String(xUserId),
  };
  await kv.put(userBindKey(xUserId), JSON.stringify(row));
  await kv.put(addrBindKey(wallet), JSON.stringify({ xUserId: String(xUserId), username: session.username || null }));
  await kv.delete(nonceKey(xUserId));

  return { ok: true, wallet, boundAt };
}

export async function confirmWalletUnbind(kv, session, { signature } = {}) {
  const xUserId = session?.xUserId;
  if (!kv || !xUserId) return { ok: false, error: "unauthorized" };
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    return { ok: false, error: "invalid_signature" };
  }

  const current = await getBoundWallet(kv, xUserId);
  if (!current) return { ok: false, error: "wallet_not_bound" };

  const pending = await readJson(kv, nonceKey(xUserId));
  if (!pending?.nonce || pending.purpose !== "unbind") {
    return { ok: false, error: "nonce_required" };
  }
  const wallet = normalizeAddress(pending.wallet);
  if (!wallet || wallet !== current.wallet) {
    return { ok: false, error: "wallet_mismatch" };
  }
  if (pending.expiresAt && Date.parse(pending.expiresAt) < Date.now()) {
    return { ok: false, error: "nonce_expired" };
  }

  const message = buildWalletBindMessage({
    purpose: "unbind",
    nonce: pending.nonce,
    walletAddress: wallet,
    xUsername: session.username,
  });

  let valid = false;
  try {
    valid = await verifyMessage({
      address: wallet,
      message,
      signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "invalid_signature" };

  await kv.delete(userBindKey(xUserId));
  const owner = await getWalletOwner(kv, wallet);
  if (owner?.xUserId === String(xUserId)) {
    await kv.delete(addrBindKey(wallet));
  }
  await kv.delete(nonceKey(xUserId));

  return { ok: true, unbound: true, wallet };
}

export async function getWalletStatus(kv, session, env = null) {
  const bound = await getBoundWallet(kv, session?.xUserId);
  const out = {
    ok: true,
    bound: !!bound,
    wallet: bound?.wallet || null,
    boundAt: bound?.boundAt || null,
    monexBalance: null,
  };
  if (bound?.wallet && env) {
    try {
      const { readMonexTokenBalance } = await import("./monex-tx-verify.js");
      const bal = await readMonexTokenBalance(env, bound.wallet);
      if (bal.ok) {
        out.monexBalance = bal.balance;
        out.monexBalanceWei = bal.balanceWei;
      }
    } catch {
      // Balance is display-only; bind status still returns.
    }
  }
  return out;
}
