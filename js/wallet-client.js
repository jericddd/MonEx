/**
 * Hot-wallet connect + $MONEX exact pack transfer for /play.
 * Uses injected EIP-1193 provider (MetaMask / Rabby / OKX / etc.).
 */
(function () {
  const ERC20_TRANSFER = "0xa9059cbb";
  const ERC20_APPROVE = "0x095ea7b3";
  const ERC20_ALLOWANCE = "0xdd62ed3e";
  const ERC20_BALANCE = "0x70a08231";

  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  function authHeaders(extra) {
    if (typeof MonExAuth !== "undefined" && MonExAuth.authHeaders) {
      return MonExAuth.authHeaders(extra || {});
    }
    return { ...(extra || {}) };
  }

  function getProvider() {
    return window.ethereum || null;
  }

  function padAddress(addr) {
    return String(addr || "").replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  }

  function toHexQuantity(value) {
    const bi = typeof value === "bigint" ? value : BigInt(value);
    return "0x" + bi.toString(16);
  }

  function monexPriceToWei(monexPrice, decimals) {
    const whole = Math.floor(Number(monexPrice));
    const dec = Math.max(0, Math.floor(Number(decimals) || 18));
    if (!Number.isFinite(whole) || whole <= 0) return null;
    return BigInt(whole) * (10n ** BigInt(dec));
  }

  function encodeTransfer(to, amountWei) {
    return (
      ERC20_TRANSFER
      + padAddress(to)
      + BigInt(amountWei).toString(16).padStart(64, "0")
    );
  }

  function encodeApprove(spender, amountWei) {
    return (
      ERC20_APPROVE
      + padAddress(spender)
      + BigInt(amountWei).toString(16).padStart(64, "0")
    );
  }

  function encodeBalanceOf(owner) {
    return ERC20_BALANCE + padAddress(owner);
  }

  function encodeAllowance(owner, spender) {
    return ERC20_ALLOWANCE + padAddress(owner) + padAddress(spender);
  }

  async function providerRequest(method, params = []) {
    const eth = getProvider();
    if (!eth?.request) {
      const err = new Error("No hot wallet found. Install MetaMask, Rabby, or another Monad wallet.");
      err.code = "no_provider";
      throw err;
    }
    return eth.request({ method, params });
  }

  async function connectHotWallet() {
    const accounts = await providerRequest("eth_requestAccounts");
    const address = String(accounts?.[0] || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      const err = new Error("Wallet did not return an address.");
      err.code = "no_account";
      throw err;
    }
    return address;
  }

  async function getConnectedAddress() {
    const accounts = await providerRequest("eth_accounts");
    const address = String(accounts?.[0] || "").toLowerCase();
    return /^0x[a-f0-9]{40}$/.test(address) ? address : null;
  }

  async function ensureMonadChain(payment) {
    const chainId = Math.floor(Number(payment?.chainId) || 143);
    const hexChain = "0x" + chainId.toString(16);
    const current = await providerRequest("eth_chainId");
    if (String(current).toLowerCase() === hexChain.toLowerCase()) return;
    try {
      await providerRequest("wallet_switchEthereumChain", [{ chainId: hexChain }]);
    } catch (err) {
      if (err?.code === 4902 || /unrecognized|unknown chain/i.test(String(err?.message || ""))) {
        await providerRequest("wallet_addEthereumChain", [{
          chainId: hexChain,
          chainName: "Monad",
          nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
          rpcUrls: ["https://rpc.monad.xyz"],
          blockExplorerUrls: ["https://monadvision.com"],
        }]);
        return;
      }
      throw err;
    }
  }

  async function personalSign(address, message) {
    return providerRequest("personal_sign", [
      `0x${Array.from(new TextEncoder().encode(message)).map((b) => b.toString(16).padStart(2, "0")).join("")}`,
      address,
    ]);
  }

  async function fetchPaymentConfig() {
    const res = await fetch(`${apiBase()}/api/shop/payment-config`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, payment: data.payment || null, ...data };
  }

  async function fetchWalletStatus() {
    const res = await fetch(`${apiBase()}/api/wallet/status`, {
      headers: authHeaders({ Accept: "application/json" }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, ...data };
  }

  async function fetchPurchases(limit = 50) {
    const res = await fetch(`${apiBase()}/api/wallet/purchases?limit=${limit}`, {
      headers: authHeaders({ Accept: "application/json" }),
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && data.ok,
      purchases: Array.isArray(data.purchases) ? data.purchases : [],
      ...data,
    };
  }

  async function requestNonce({ walletAddress, purpose }) {
    const res = await fetch(`${apiBase()}/api/wallet/nonce`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({ walletAddress, purpose }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  async function bindWallet(walletAddress, signature) {
    const res = await fetch(`${apiBase()}/api/wallet/bind`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({ walletAddress, signature }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  async function unbindWallet(signature) {
    const res = await fetch(`${apiBase()}/api/wallet/unbind`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(signature ? { signature } : {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  async function connectAndBind() {
    const status = await fetchWalletStatus();
    const payment = status.payment || (await fetchPaymentConfig()).payment;
    if (!payment) {
      return { ok: false, error: "payment_config_unavailable" };
    }
    await ensureMonadChain(payment);
    const address = await connectHotWallet();
    if (status.bound && status.wallet === address) {
      return { ok: true, alreadyBound: true, wallet: address, payment };
    }
    const nonce = await requestNonce({ walletAddress: address, purpose: "bind" });
    if (nonce.alreadyBound) {
      return { ok: true, alreadyBound: true, wallet: address, payment };
    }
    if (!nonce.ok) return nonce;
    const signature = await personalSign(address, nonce.message);
    const bound = await bindWallet(address, signature);
    if (!bound.ok) return bound;
    return { ok: true, wallet: bound.wallet || address, payment, boundAt: bound.boundAt };
  }

  async function requestUnbindAndSign() {
    const status = await fetchWalletStatus();
    if (!status.ok || !status.bound) {
      return { ok: false, error: "wallet_not_bound" };
    }
    const payment = status.payment || (await fetchPaymentConfig()).payment;
    await ensureMonadChain(payment || { chainId: 143 });
    const address = await connectHotWallet();
    if (address !== String(status.wallet || "").toLowerCase()) {
      return {
        ok: false,
        error: "wallet_mismatch",
        message: "Connected wallet must match your bound wallet to unbind.",
      };
    }
    const nonce = await unbindWallet(null);
    if (!nonce.ok || !nonce.message) return nonce;
    const signature = await personalSign(address, nonce.message);
    return unbindWallet(signature);
  }

  async function ethCall(to, data) {
    return providerRequest("eth_call", [{ to, data }, "latest"]);
  }

  async function readTokenBalance(payment, owner) {
    const raw = await ethCall(payment.tokenAddress, encodeBalanceOf(owner));
    return BigInt(raw || "0x0");
  }

  async function readAllowance(payment, owner, spender) {
    const raw = await ethCall(payment.tokenAddress, encodeAllowance(owner, spender));
    return BigInt(raw || "0x0");
  }

  async function waitForReceipt(txHash, { timeoutMs = 90_000 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = await providerRequest("eth_getTransactionReceipt", [txHash]);
      if (receipt && receipt.blockNumber) return receipt;
      await new Promise((r) => setTimeout(r, 1200));
    }
    const err = new Error("Timed out waiting for transaction confirmation.");
    err.code = "tx_timeout";
    throw err;
  }

  /**
   * Preflight + exact $MONEX transfer to vault.
   * Never opens a wallet confirm until amount/token/vault/sender checks pass.
   */
  async function payExactMonexForPack(payment, monexPrice, boundWallet) {
    if (!payment?.tokenAddress || !payment?.vaultAddress) {
      return { ok: false, error: "payment_misconfigured", message: "Payment config missing." };
    }
    const amountWei = monexPriceToWei(monexPrice, payment.decimals);
    if (amountWei == null) {
      return { ok: false, error: "invalid_amount", message: "Invalid package price." };
    }

    await ensureMonadChain(payment);
    const address = await connectHotWallet();
    const expected = String(boundWallet || "").toLowerCase();
    if (!expected || address !== expected) {
      return {
        ok: false,
        error: "wallet_mismatch",
        message: "Connected wallet must match your bound wallet before paying.",
      };
    }

    let balance;
    try {
      balance = await readTokenBalance(payment, address);
    } catch {
      return {
        ok: false,
        error: "balance_read_failed",
        message: "Could not read $MONEX balance. Check you are on Monad.",
      };
    }
    if (balance < amountWei) {
      return {
        ok: false,
        error: "insufficient_monex",
        message: `Not enough $MONEX. Need ${Number(monexPrice).toLocaleString()} $MONEX in the bound wallet.`,
      };
    }

    // Prefer direct transfer (no approve). If a wallet/token proxy requires allowance, approve exact amount first.
    const data = encodeTransfer(payment.vaultAddress, amountWei);
    let txHash;
    try {
      txHash = await providerRequest("eth_sendTransaction", [{
        from: address,
        to: payment.tokenAddress,
        data,
        value: "0x0",
      }]);
    } catch (err) {
      if (err?.code === 4001) {
        return { ok: false, error: "user_rejected", message: "Wallet confirmation was rejected." };
      }
      // Fallback: approve vault as spender then transferFrom is not used — retry transfer only.
      // Some wallets fail oddly; surface message.
      return {
        ok: false,
        error: "tx_send_failed",
        message: err?.message || "Wallet could not send the $MONEX transfer.",
      };
    }

    const receipt = await waitForReceipt(txHash);
    if (String(receipt.status || "").toLowerCase() === "0x0" || receipt.status === 0) {
      return {
        ok: false,
        error: "tx_failed",
        message: "On-chain transfer failed. No package will be granted.",
        txHash,
      };
    }
    return {
      ok: true,
      txHash,
      amountWei: amountWei.toString(),
      from: address,
      to: payment.vaultAddress,
      monexPrice: Math.floor(Number(monexPrice)),
    };
  }

  // Keep helpers referenced for future approve path / tooling.
  void encodeApprove;
  void readAllowance;
  void toHexQuantity;

  window.MonExWallet = {
    getProvider,
    connectHotWallet,
    getConnectedAddress,
    ensureMonadChain,
    fetchPaymentConfig,
    fetchWalletStatus,
    fetchPurchases,
    connectAndBind,
    requestUnbindAndSign,
    payExactMonexForPack,
    monexPriceToWei,
    readTokenBalance,
  };
})();
