/**
 * Server-authoritative shop purchases + MonBall packages.
 */
(function () {
  function apiBase() {
    return (typeof getMonexApiBase === "function"
      ? getMonexApiBase()
      : (window.MONEX_API || "https://monex-api.0xjericd.workers.dev")
    ).replace(/\/$/, "");
  }

  function purchaseBody(extra) {
    const body = { ...extra };
    if (typeof MonExAuth !== "undefined" && MonExAuth.getSaveRevision) {
      const rev = MonExAuth.getSaveRevision();
      if (rev != null) body.baseRevision = rev;
    }
    return body;
  }

  function applyPurchaseConflict(res, data) {
    if (res.status !== 409 || !data?.save) return false;
    if (data.error !== "purchase_conflict") return false;
    if (typeof window.handleCloudSaveConflict === "function") {
      window.handleCloudSaveConflict(data.save);
      return true;
    }
    if (typeof MonExAuth !== "undefined" && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
    return true;
  }

  function syncPurchaseRevision(res, data, conflictHandled) {
    if (conflictHandled) return;
    if (data.ok && data.save && typeof MonExAuth !== "undefined" && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
  }

  async function purchaseShopItem(itemId, qty) {
    if (typeof MonExAuth !== "undefined" && MonExAuth.awaitCloudSaveIdle) {
      await MonExAuth.awaitCloudSaveIdle();
    }
    const res = await fetch(`${apiBase()}/api/shop/purchase`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(purchaseBody({ itemId, qty })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    const conflictHandled = applyPurchaseConflict(res, data);
    syncPurchaseRevision(res, data, conflictHandled);
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  async function listMonballPackages() {
    const headers = { Accept: "application/json" };
    if (typeof MonExAuth !== "undefined" && MonExAuth.authHeaders) {
      Object.assign(headers, MonExAuth.authHeaders());
    }
    const res = await fetch(`${apiBase()}/api/shop/monball-packages`, {
      method: "GET",
      headers,
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && data.ok,
      status: res.status,
      currency: data.currency || "MONEX",
      packages: Array.isArray(data.packages) ? data.packages : [],
      ...data,
    };
  }

  async function purchaseMonballPackage(packageId, paymentProof) {
    if (typeof MonExAuth !== "undefined" && MonExAuth.awaitCloudSaveIdle) {
      await MonExAuth.awaitCloudSaveIdle();
    }
    const payload = purchaseBody({ packageId });
    if (paymentProof) payload.paymentProof = paymentProof;
    const res = await fetch(`${apiBase()}/api/shop/monball-packages/purchase`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    const conflictHandled = applyPurchaseConflict(res, data);
    syncPurchaseRevision(res, data, conflictHandled);
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  window.MonExShop = {
    purchaseShopItem,
    listMonballPackages,
    purchaseMonballPackage,
  };
})();
