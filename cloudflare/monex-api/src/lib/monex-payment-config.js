/**
 * Shared $MONEX on-chain payment constants (Monad mainnet).
 * Vault is receive-only — never store a private key in the Worker.
 */

export const MONAD_CHAIN_ID = 143;

/** Official $MONEX ERC-20 on Monad. */
export const MONEX_TOKEN_ADDRESS = "0x978Ae7298D48Cf0f8d1fdB26abC12bfACFcC7777";

/** Single shop vault — all pack purchases send here. */
export const MONEX_VAULT_ADDRESS = "0x449AeAc701C33D86e7533ef4b3c6DdBf76981667";

/** Confirmed on-chain via decimals() — 18. */
export const MONEX_TOKEN_DECIMALS = 18;

export const DEFAULT_MONAD_RPC_URL = "https://rpc.monad.xyz";

export const DEFAULT_EXPLORER_TX_URL = "https://monadvision.com/tx/";

/** Receipt success = 1 confirmation (default). Override via env. */
export const DEFAULT_MIN_CONFIRMATIONS = 1;

export function getMonexPaymentConfig(env = {}) {
  const chainId = Math.floor(Number(env.MONAD_CHAIN_ID) || MONAD_CHAIN_ID);
  const tokenAddress = String(env.MONEX_TOKEN_ADDRESS || MONEX_TOKEN_ADDRESS).trim();
  const vaultAddress = String(env.MONEX_VAULT_ADDRESS || MONEX_VAULT_ADDRESS).trim();
  const decimals = Math.floor(Number(env.MONEX_TOKEN_DECIMALS) || MONEX_TOKEN_DECIMALS);
  const rpcUrl = String(env.MONAD_RPC_URL || DEFAULT_MONAD_RPC_URL).trim() || DEFAULT_MONAD_RPC_URL;
  const explorerTxUrl = String(env.MONAD_EXPLORER_TX_URL || DEFAULT_EXPLORER_TX_URL).trim();
  const minConfirmations = Math.max(
    1,
    Math.floor(Number(env.MONEX_PAYMENT_MIN_CONFIRMATIONS) || DEFAULT_MIN_CONFIRMATIONS)
  );
  return {
    chainId,
    tokenAddress,
    vaultAddress,
    decimals,
    rpcUrl,
    explorerTxUrl,
    minConfirmations,
    currency: "MONEX",
  };
}

export function publicPaymentConfigView(env = {}) {
  const cfg = getMonexPaymentConfig(env);
  return {
    chainId: cfg.chainId,
    tokenAddress: cfg.tokenAddress,
    vaultAddress: cfg.vaultAddress,
    decimals: cfg.decimals,
    explorerTxUrl: cfg.explorerTxUrl,
    minConfirmations: cfg.minConfirmations,
    currency: cfg.currency,
  };
}

/** Whole-token pack price → wei string (exact). */
export function monexPriceToWei(monexPrice, decimals = MONEX_TOKEN_DECIMALS) {
  const whole = Math.floor(Number(monexPrice));
  if (!Number.isFinite(whole) || whole <= 0) return null;
  const dec = Math.max(0, Math.floor(Number(decimals) || 0));
  return (BigInt(whole) * 10n ** BigInt(dec)).toString();
}

export function normalizeAddress(addr) {
  if (typeof addr !== "string") return null;
  const s = addr.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(s)) return null;
  return s;
}

export function normalizeTxHash(hash) {
  if (typeof hash !== "string") return null;
  const s = hash.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(s)) return null;
  return s;
}
