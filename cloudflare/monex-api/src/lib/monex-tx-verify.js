/**
 * Server-side verification of $MONEX ERC-20 Transfer payments to the vault.
 */

import {
  createPublicClient,
  http,
  decodeEventLog,
  parseAbiItem,
  getAddress,
  isAddressEqual,
} from "viem";
import { monad } from "viem/chains";
import {
  getMonexPaymentConfig,
  monexPriceToWei,
  normalizeAddress,
  normalizeTxHash,
} from "./monex-payment-config.js";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

function buildClient(rpcUrl, chainId) {
  const chain =
    chainId === monad.id
      ? monad
      : {
          ...monad,
          id: chainId,
        };
  return createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 20_000 }),
  });
}

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

/**
 * Read whole-token $MONEX balance for a wallet (display helper).
 * @returns {{ ok: true, balanceWei: string, balance: string } | { ok: false, error: string }}
 */
export async function readMonexTokenBalance(env, walletAddress) {
  const cfg = getMonexPaymentConfig(env);
  const wallet = normalizeAddress(walletAddress);
  const token = normalizeAddress(cfg.tokenAddress);
  if (!wallet || !token) return { ok: false, error: "invalid_wallet" };

  const client = buildClient(cfg.rpcUrl, cfg.chainId);
  try {
    const balanceWei = await client.readContract({
      address: getAddress(token),
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [getAddress(wallet)],
    });
    const wei = BigInt(balanceWei);
    const whole = wei / 10n ** BigInt(cfg.decimals);
    return {
      ok: true,
      balanceWei: wei.toString(),
      balance: whole.toString(),
    };
  } catch {
    return { ok: false, error: "balance_read_failed" };
  }
}

/**
 * Verify a confirmed ERC-20 Transfer matches exact pack payment rules.
 * @returns {{ ok: true, from, to, valueWei, blockNumber, txHash } | { ok: false, error, message? }}
 */
export async function verifyMonexPackPayment(env, {
  txHash,
  expectedFrom,
  expectedMonexPrice,
} = {}) {
  const cfg = getMonexPaymentConfig(env);
  const hash = normalizeTxHash(txHash);
  if (!hash) {
    return { ok: false, error: "invalid_tx_hash", message: "Transaction hash is invalid." };
  }

  const fromExpected = normalizeAddress(expectedFrom);
  if (!fromExpected) {
    return { ok: false, error: "wallet_not_bound", message: "Bind a wallet before purchasing." };
  }

  const expectedWei = monexPriceToWei(expectedMonexPrice, cfg.decimals);
  if (!expectedWei) {
    return { ok: false, error: "invalid_package", message: "Package price is invalid." };
  }

  const token = normalizeAddress(cfg.tokenAddress);
  const vault = normalizeAddress(cfg.vaultAddress);
  if (!token || !vault) {
    return { ok: false, error: "payment_misconfigured" };
  }

  const client = buildClient(cfg.rpcUrl, cfg.chainId);

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash });
  } catch {
    return {
      ok: false,
      error: "tx_not_found",
      message: "Transaction not found yet. Wait for confirmation and try again.",
    };
  }

  if (!receipt) {
    return {
      ok: false,
      error: "tx_not_found",
      message: "Transaction not found yet. Wait for confirmation and try again.",
    };
  }

  if (receipt.status !== "success") {
    return {
      ok: false,
      error: "tx_failed",
      message: "On-chain transaction failed. No funds should have been taken.",
    };
  }

  const txChainId = Number(receipt.chainId || cfg.chainId);
  if (txChainId && txChainId !== cfg.chainId) {
    return {
      ok: false,
      error: "wrong_chain",
      message: `Wrong network. Expected Monad (chain ${cfg.chainId}).`,
    };
  }

  if (cfg.minConfirmations > 1) {
    try {
      const head = await client.getBlockNumber();
      const conf = Number(head - receipt.blockNumber) + 1;
      if (conf < cfg.minConfirmations) {
        return {
          ok: false,
          error: "tx_unconfirmed",
          message: `Waiting for confirmations (${conf}/${cfg.minConfirmations}).`,
        };
      }
    } catch {
      // If head fetch fails, still accept receipt success when minConfirmations === 1.
      if (cfg.minConfirmations > 1) {
        return { ok: false, error: "rpc_unavailable", message: "Could not check confirmations." };
      }
    }
  }

  const tokenAddr = getAddress(token);
  const vaultAddr = getAddress(vault);
  const fromAddr = getAddress(fromExpected);
  const expectedValue = BigInt(expectedWei);

  const matches = [];
  for (const log of receipt.logs || []) {
    if (!log?.address || !isAddressEqual(log.address, tokenAddr)) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Transfer") continue;
    const { from, to, value } = decoded.args || {};
    if (!from || !to || value == null) continue;
    if (!isAddressEqual(from, fromAddr)) continue;
    if (!isAddressEqual(to, vaultAddr)) continue;
    if (BigInt(value) !== expectedValue) continue;
    matches.push({
      from: normalizeAddress(from),
      to: normalizeAddress(to),
      valueWei: BigInt(value).toString(),
    });
  }

  if (!matches.length) {
    // Diagnose common mistakes for a clear client error (funds already moved or not).
    let sawTokenTransfer = false;
    let sawWrongAmount = false;
    let sawWrongTo = false;
    let sawWrongFrom = false;
    for (const log of receipt.logs || []) {
      if (!log?.address || !isAddressEqual(log.address, tokenAddr)) continue;
      sawTokenTransfer = true;
      let decoded;
      try {
        decoded = decodeEventLog({
          abi: [TRANSFER_EVENT],
          data: log.data,
          topics: log.topics,
        });
      } catch {
        continue;
      }
      const { from, to, value } = decoded.args || {};
      if (from && !isAddressEqual(from, fromAddr)) sawWrongFrom = true;
      if (to && !isAddressEqual(to, vaultAddr)) sawWrongTo = true;
      if (value != null && BigInt(value) !== expectedValue) sawWrongAmount = true;
    }

    if (!sawTokenTransfer) {
      return {
        ok: false,
        error: "wrong_token",
        message: "No $MONEX transfer found in this transaction. Use the official $MONEX token.",
      };
    }
    if (sawWrongFrom) {
      return {
        ok: false,
        error: "wrong_sender",
        message: "Payment must come from your currently bound wallet.",
      };
    }
    if (sawWrongTo) {
      return {
        ok: false,
        error: "wrong_vault",
        message: "Payment was not sent to the MonEx vault address.",
      };
    }
    if (sawWrongAmount) {
      return {
        ok: false,
        error: "wrong_amount",
        message: "Payment amount must match the exact package price in $MONEX.",
      };
    }
    return {
      ok: false,
      error: "payment_mismatch",
      message: "Transaction does not match this package payment.",
    };
  }

  return {
    ok: true,
    txHash: hash,
    from: matches[0].from,
    to: matches[0].to,
    valueWei: matches[0].valueWei,
    blockNumber: Number(receipt.blockNumber),
    monexPrice: Math.floor(Number(expectedMonexPrice)),
  };
}
