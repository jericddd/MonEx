/**
 * Server-authoritative shop purchases.
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

  async function purchaseShopItem(itemId, qty) {
    const res = await fetch(`${apiBase()}/api/shop/purchase`, {
      method: "POST",
      headers: MonExAuth.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(purchaseBody({ itemId, qty })),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === "game_session_inactive") {
      window.MonExGameSession?.handleInactiveFromApi?.();
    }
    if (res.status === 409 && data.error === "purchase_conflict" && data.save && MonExAuth.handleCloudSaveConflict) {
      await MonExAuth.handleCloudSaveConflict(data.save);
    }
    if (data.save && MonExAuth.setSaveRevision) {
      MonExAuth.setSaveRevision(data.save.revision);
    }
    return { ok: res.ok && data.ok, status: res.status, ...data };
  }

  window.MonExShop = { purchaseShopItem };
})();
