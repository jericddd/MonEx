import test from "node:test";
import assert from "node:assert/strict";
import {
  getMonexPaymentConfig,
  monexPriceToWei,
  normalizeAddress,
  normalizeTxHash,
  MONEX_VAULT_ADDRESS,
  MONEX_TOKEN_ADDRESS,
} from "./monex-payment-config.js";

test("getMonexPaymentConfig defaults to vault + official token on Monad 143", () => {
  const cfg = getMonexPaymentConfig({});
  assert.equal(cfg.chainId, 143);
  assert.equal(cfg.vaultAddress.toLowerCase(), MONEX_VAULT_ADDRESS.toLowerCase());
  assert.equal(cfg.tokenAddress.toLowerCase(), MONEX_TOKEN_ADDRESS.toLowerCase());
  assert.equal(cfg.decimals, 18);
  assert.equal(cfg.minConfirmations, 1);
});

test("monexPriceToWei converts whole tokens to exact wei", () => {
  assert.equal(monexPriceToWei(10_000, 18), (10_000n * 10n ** 18n).toString());
  assert.equal(monexPriceToWei(0, 18), null);
  assert.equal(monexPriceToWei(-1, 18), null);
});

test("normalize helpers reject malformed inputs", () => {
  assert.equal(normalizeAddress("0x449AeAc701C33D86e7533ef4b3c6DdBf76981667"), "0x449aeac701c33d86e7533ef4b3c6ddbf76981667");
  assert.equal(normalizeAddress("not-an-address"), null);
  assert.equal(normalizeTxHash("0x" + "ab".repeat(32)), "0x" + "ab".repeat(32));
  assert.equal(normalizeTxHash("0x1234"), null);
});
