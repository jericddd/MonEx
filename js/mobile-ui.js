/**
 * MonEx mobile UI — automatic device detection and touch-first helpers.
 * Desktop layout is unchanged; phones and touch tablets get layout-* classes on <html>.
 */
(function (global) {
  "use strict";

  const MQ_PHONE = "(max-width: 720px)";
  const MQ_TABLET = "(min-width: 721px) and (max-width: 1024px)";
  const MQ_TOUCH = "(hover: none) and (pointer: coarse)";
  const MQ_LANDSCAPE_PHONE =
    "(orientation: landscape) and (max-height: 520px) and (hover: none) and (pointer: coarse)";

  function readPlatform() {
    const ua = navigator.userAgent || "";
    const ios =
      /iPad|iPhone|iPod/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    if (ios) return "ios";
    if (android) return "android";
    return "unknown";
  }

  function isTouchCapable() {
    return (
      window.matchMedia(MQ_TOUCH).matches ||
      navigator.maxTouchPoints > 0 ||
      global.PointerEvent && matchMedia("(pointer: coarse)").matches
    );
  }

  /**
   * Resolve layout mode: desktop | tablet | mobile
   * Phones (incl. landscape) → mobile; touch tablets → tablet; mouse desktop → desktop.
   */
  function detectLayoutMode() {
    const w = global.innerWidth;
    const h = global.innerHeight;
    const touch = isTouchCapable();
    const platform = readPlatform();
    const mobileUA = platform === "ios" || platform === "android";

    if (window.matchMedia(MQ_PHONE).matches) {
      return { layout: "mobile", touch: true, platform };
    }
    if (window.matchMedia(MQ_LANDSCAPE_PHONE).matches) {
      return { layout: "mobile", touch: true, platform };
    }
    if (touch && mobileUA && Math.min(w, h) < 600) {
      return { layout: "mobile", touch: true, platform };
    }
    if (
      window.matchMedia(MQ_TABLET).matches &&
      (touch || mobileUA)
    ) {
      return { layout: "tablet", touch: touch || mobileUA, platform };
    }
    if (touch && mobileUA && Math.max(w, h) <= 1366) {
      return { layout: "tablet", touch: true, platform };
    }
    return { layout: "desktop", touch: false, platform: "desktop" };
  }

  let currentProfile = detectLayoutMode();
  const actionCooldown = new WeakMap();

  function applyLayoutClasses(profile) {
    const root = document.documentElement;
    const body = document.body;
    const layouts = ["layout-desktop", "layout-tablet", "layout-mobile"];
    layouts.forEach((c) => root.classList.remove(c));
    root.classList.add(`layout-${profile.layout}`);
    root.classList.toggle("touch-device", profile.touch);
    root.classList.toggle("platform-ios", profile.platform === "ios");
    root.classList.toggle("platform-android", profile.platform === "android");
    if (body) {
      layouts.forEach((c) => body.classList.remove(c));
      body.classList.add(`layout-${profile.layout}`);
      body.classList.toggle("touch-device", profile.touch);
    }
    root.style.setProperty(
      "--safe-top",
      "env(safe-area-inset-top, 0px)"
    );
    root.style.setProperty(
      "--safe-right",
      "env(safe-area-inset-right, 0px)"
    );
    root.style.setProperty(
      "--safe-bottom",
      "env(safe-area-inset-bottom, 0px)"
    );
    root.style.setProperty(
      "--safe-left",
      "env(safe-area-inset-left, 0px)"
    );
  }

  function syncLayout() {
    currentProfile = detectLayoutMode();
    applyLayoutClasses(currentProfile);
    global.dispatchEvent(
      new CustomEvent("monex:layout-change", { detail: { ...currentProfile } })
    );
  }

  function isMobileLayout() {
    return currentProfile.layout === "mobile";
  }

  function isTabletLayout() {
    return currentProfile.layout === "tablet";
  }

  function isTouchLayout() {
    return currentProfile.touch;
  }

  function isDesktopLayout() {
    return currentProfile.layout === "desktop";
  }

  /** Prevent duplicate rapid taps on critical action buttons. */
  function guardDoubleAction(el, handler, cooldownMs = 450) {
    if (!el || el.dataset.doubleGuardBound) return;
    el.dataset.doubleGuardBound = "1";
    el.addEventListener(
      "click",
      (e) => {
        if (!isTouchLayout()) return;
        const now = Date.now();
        const last = actionCooldown.get(el) || 0;
        if (now - last < cooldownMs) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        actionCooldown.set(el, now);
      },
      true
    );
    if (typeof handler === "function") handler(el);
  }

  function bindGlobalDoubleTapGuards() {
    const selectors = [
      ".adventure-start-btn",
      ".adventure-continue-btn",
      ".side-icon-btn",
      ".game-modal-close",
      ".hub-popup-qty-btn",
      ".hub-popup-confirm-btn",
      ".battle-pause-btn",
      ".catch-submit-btn",
    ];
    document.querySelectorAll(selectors.join(",")).forEach((el) => {
      guardDoubleAction(el);
    });
  }

  function closeAllFloatTips() {
    document.querySelectorAll(".has-hover-tip.tip-open").forEach((el) => {
      el.classList.remove("tip-open");
      if (typeof global.clearHoverFloatTip === "function") {
        global.clearHoverFloatTip(el);
      }
    });
  }

  /** Extend hover tooltips with tap-to-toggle on touch devices. */
  function enhanceHoverFloatTips(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const nodes =
      root && root.classList?.contains("has-hover-tip")
        ? [root]
        : scope.querySelectorAll(".has-hover-tip");

    nodes.forEach((el) => {
      if (el.dataset.touchTipBound) return;
      el.dataset.touchTipBound = "1";

      el.addEventListener(
        "click",
        (e) => {
          if (!isTouchLayout()) return;
          if (e.target.closest("button, a, input, select, textarea")) return;
          e.preventDefault();
          e.stopPropagation();
          const open = el.classList.contains("tip-open");
          closeAllFloatTips();
          if (!open && typeof global.showHoverFloatTip === "function") {
            global.showHoverFloatTip(el);
            el.classList.add("tip-open");
          }
        },
        { passive: false }
      );
    });
  }

  function onDocumentTouchTipDismiss(ev) {
    if (!isTouchLayout()) return;
    if (ev.target.closest(".has-hover-tip, .hover-tip-float")) return;
    closeAllFloatTips();
  }

  /** Tap-to-swap team arrangement for adventure (replaces unreliable HTML5 drag on touch). */
  let teamArrangeSelected = null;

  function resetTeamArrangeSelection() {
    teamArrangeSelected = null;
    document
      .querySelectorAll(".team-slot.team-slot-selected")
      .forEach((el) => el.classList.remove("team-slot-selected"));
  }

  function bindTeamArrangeTouchSlots(container) {
    if (!container || container.dataset.touchArrangeBound) return;
    container.dataset.touchArrangeBound = "1";

    container.addEventListener("click", (e) => {
      if (!isTouchLayout()) return;
      const slot = e.target.closest(".team-slot");
      if (!slot || !container.contains(slot)) return;
      if (e.target.closest("button")) return;

      const idx = parseInt(slot.dataset.index, 10);
      if (!Number.isFinite(idx)) return;

      if (teamArrangeSelected === null) {
        resetTeamArrangeSelection();
        teamArrangeSelected = idx;
        slot.classList.add("team-slot-selected");
        return;
      }
      if (teamArrangeSelected === idx) {
        resetTeamArrangeSelection();
        return;
      }

      const from = teamArrangeSelected;
      const to = idx;
      if (
        typeof global.party !== "undefined" &&
        Array.isArray(global.party) &&
        global.party[from] &&
        global.party[to]
      ) {
        [global.party[from], global.party[to]] = [
          global.party[to],
          global.party[from],
        ];
        if (typeof global.saveData === "function") global.saveData();
        if (typeof global.renderTeamArrangement === "function") {
          global.renderTeamArrangement();
        }
      }
      resetTeamArrangeSelection();
    });
  }

  function observeTeamArrange() {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => {
      const container = document.getElementById("team-arrange");
      if (container) bindTeamArrangeTouchSlots(container);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const existing = document.getElementById("team-arrange");
    if (existing) bindTeamArrangeTouchSlots(existing);
  }

  function patchBindHoverFloatTips() {
    if (typeof global.bindHoverFloatTips !== "function") return;
    if (global.bindHoverFloatTips.__mobilePatched) return;
    const original = global.bindHoverFloatTips;
    global.bindHoverFloatTips = function patchedBindHoverFloatTips(root) {
      original(root);
      enhanceHoverFloatTips(root);
    };
    global.bindHoverFloatTips.__mobilePatched = true;
  }

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncLayout, 120);
  }

  function initMobileUI() {
    syncLayout();
    patchBindHoverFloatTips();
    enhanceHoverFloatTips(document);
    bindGlobalDoubleTapGuards();
    observeTeamArrange();
    document.addEventListener("click", onDocumentTouchTipDismiss, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    if (window.matchMedia) {
      [MQ_PHONE, MQ_TABLET, MQ_TOUCH, MQ_LANDSCAPE_PHONE].forEach((q) => {
        try {
          window.matchMedia(q).addEventListener("change", syncLayout);
        } catch (_) {
          window.matchMedia(q).addListener(syncLayout);
        }
      });
    }
    global.dispatchEvent(new CustomEvent("monex:mobile-ready"));
  }

  const api = {
    initMobileUI,
    syncLayout,
    detectLayoutMode,
    isMobileLayout,
    isTabletLayout,
    isTouchLayout,
    isDesktopLayout,
    enhanceHoverFloatTips,
    guardDoubleAction,
    bindTeamArrangeTouchSlots,
    resetTeamArrangeSelection,
    getProfile: () => ({ ...currentProfile }),
  };

  global.MonExMobile = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMobileUI);
  } else {
    initMobileUI();
  }
})(typeof window !== "undefined" ? window : globalThis);
