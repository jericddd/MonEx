/**
 * Shared client-side claim protection: one in-flight claim per key,
 * immediate button disable + loading state, shared promise dedup.
 */

const claimInFlight = new Set();
const claimPromises = new Map();

function beginClaimButton(btn, loadingText = "...") {
  if (!btn || !btn.classList) return () => {};
  const prev = {
    disabled: btn.disabled,
    text: btn.textContent,
    hadLoading: btn.classList.contains("loading"),
  };
  btn.disabled = true;
  btn.classList.add("loading");
  btn.textContent = loadingText;
  return () => {
    btn.disabled = prev.disabled;
    btn.textContent = prev.text;
    if (!prev.hadLoading) btn.classList.remove("loading");
  };
}

async function runClaimOnce(key, fn, options = {}) {
  const id = String(key || "").trim();
  if (!id) return fn();

  if (claimPromises.has(id)) {
    return claimPromises.get(id);
  }
  if (claimInFlight.has(id)) {
    return claimPromises.get(id);
  }

  const resetButton = options.button ? beginClaimButton(options.button, options.loadingText) : () => {};
  claimInFlight.add(id);

  const promise = (async () => {
    try {
      return await fn();
    } catch (err) {
      if (options.rethrow !== false) throw err;
      return { ok: false, error: err?.message || String(err) };
    } finally {
      claimInFlight.delete(id);
      claimPromises.delete(id);
      // Always restore the button. Success paths that rebuild the DOM leave a
      // detached node (safe no-op); early returns need the control re-enabled.
      if (options.resetOnComplete !== false) resetButton();
    }
  })();

  claimPromises.set(id, promise);

  try {
    return await promise;
  } catch (err) {
    throw err;
  }
}

function isClaimInFlight(key) {
  return claimInFlight.has(String(key || "").trim());
}

window.MonExClaimGuard = {
  runClaimOnce,
  beginClaimButton,
  isClaimInFlight,
};
