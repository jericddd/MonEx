import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  issueWalletNonce,
  confirmWalletBind,
  confirmWalletUnbind,
  getBoundWallet,
  getWalletOwner,
} from "./wallet-bind.js";

function makeKv(store = {}) {
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    },
    async delete(key) {
      delete store[key];
    },
  };
}

const ACCOUNT_A = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
);
const ACCOUNT_B = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
);

test("bind requires signature and enforces one wallet per account", async () => {
  const kv = makeKv();
  const session = { xUserId: "u1", username: "trainer" };
  const wallet = ACCOUNT_A.address.toLowerCase();

  const nonce = await issueWalletNonce(kv, session, { walletAddress: wallet, purpose: "bind" });
  assert.equal(nonce.ok, true);
  assert.match(nonce.message, /MonEx — Wallet Verification/);

  const signature = await ACCOUNT_A.signMessage({ message: nonce.message });
  const bound = await confirmWalletBind(kv, session, { walletAddress: wallet, signature });
  assert.equal(bound.ok, true);
  assert.equal(bound.wallet, wallet);

  const status = await getBoundWallet(kv, "u1");
  assert.equal(status.wallet, wallet);

  const other = await issueWalletNonce(kv, { xUserId: "u2", username: "other" }, {
    walletAddress: wallet,
    purpose: "bind",
  });
  assert.equal(other.ok, false);
  assert.equal(other.error, "wallet_taken");
});

test("unbind requires signature from bound wallet then frees address", async () => {
  const kv = makeKv();
  const session = { xUserId: "u1", username: "trainer" };
  const wallet = ACCOUNT_B.address.toLowerCase();

  const nonce = await issueWalletNonce(kv, session, { walletAddress: wallet, purpose: "bind" });
  const signature = await ACCOUNT_B.signMessage({ message: nonce.message });
  await confirmWalletBind(kv, session, { walletAddress: wallet, signature });

  const unbindNonce = await issueWalletNonce(kv, session, { purpose: "unbind" });
  assert.equal(unbindNonce.ok, true);
  const unbindSig = await ACCOUNT_B.signMessage({ message: unbindNonce.message });
  const unbound = await confirmWalletUnbind(kv, session, { signature: unbindSig });
  assert.equal(unbound.ok, true);
  assert.equal(await getBoundWallet(kv, "u1"), null);
  assert.equal(await getWalletOwner(kv, wallet), null);
});
