/**
 * MonExGameAssets — centralized preload cache for /play.
 *
 * Manifest entries are deduplicated by normalized URL (query string stripped).
 * Images are decoded after load; failed loads retry up to MAX_RETRIES then optional fallback.
 * Audio uses fetch-only warm cache (no playback — safe before user gesture).
 */
(() => {
  "use strict";

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 350;
  const LOAD_CONCURRENCY = 8;

  /** @type {{ status: "idle"|"loading"|"ready"|"error", progress: number, loadedAssets: number, totalAssets: number, failedAssets: string[] }} */
  const state = {
    status: "idle",
    progress: 0,
    loadedAssets: 0,
    totalAssets: 0,
    failedAssets: [],
  };

  /** normalized path -> Promise<boolean> */
  const imageCache = new Map();
  const audioCache = new Map();

  function normalizeUrl(url) {
    return String(url || "").split("?")[0];
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function updateProgressUI() {
    const pct = Math.round(state.progress * 100);
    const fill = document.getElementById("game-loading-progress-fill");
    const meta = document.getElementById("game-loading-meta");
    const statusEl = document.getElementById("game-loading-status");
    if (fill) fill.style.width = `${pct}%`;
    if (meta) {
      meta.textContent = state.totalAssets
        ? `${pct}% · ${state.loadedAssets}/${state.totalAssets} assets`
        : `${pct}%`;
    }
    if (statusEl && state.status === "loading") {
      statusEl.textContent = state.failedAssets.length
        ? `Loading game assets (${state.failedAssets.length} failed, retrying fallbacks…)`
        : "Loading game assets…";
    }
  }

  function setProgress(done, total) {
    state.loadedAssets = done;
    state.totalAssets = total;
    state.progress = total > 0 ? Math.min(1, done / total) : 1;
    updateProgressUI();
  }

  async function decodeImage(img) {
    try {
      if (img.decode) await img.decode();
    } catch (_) {
      /* decoded or unsupported — still usable */
    }
  }

  async function preloadImageOnce(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      const finish = async (ok) => {
        if (ok) await decodeImage(img);
        resolve(!!ok);
      };
      img.onload = () => { void finish(true); };
      img.onerror = () => { void finish(false); };
      img.src = url;
    });
  }

  /**
   * Preload one image with cache + retry. Returns cached promise for duplicate paths.
   */
  async function preloadImage(url, fallbackUrl) {
    if (!url) return false;
    const key = normalizeUrl(url);
    if (imageCache.has(key)) return imageCache.get(key);

    const promise = (async () => {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const ok = await preloadImageOnce(url);
        if (ok) return true;
        console.warn(`[MonExGameAssets] Load failed (${attempt}/${MAX_RETRIES}): ${url}`);
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
      }
      const fb = fallbackUrl || null;
      if (fb && normalizeUrl(fb) !== key) {
        console.warn(`[MonExGameAssets] Trying fallback for ${url}: ${fb}`);
        const fbOk = await preloadImageOnce(fb);
        if (fbOk) return true;
      }
      if (!state.failedAssets.includes(url)) state.failedAssets.push(url);
      return false;
    })();

    imageCache.set(key, promise);
    return promise;
  }

  async function preloadImages(urls, fallbacks = {}) {
    const unique = [...new Set((urls || []).filter(Boolean))];
    return Promise.all(unique.map((url) => {
      const fb = fallbacks[normalizeUrl(url)] || fallbacks[url] || null;
      return preloadImage(url, fb);
    }));
  }

  async function preloadFonts() {
    if (!document.fonts?.load) return true;
    const specs = [
      "400 12px 'Press Start 2P'",
      "400 14px 'Lato'",
      "300 14px 'Lato'",
    ];
    await Promise.all(specs.map((spec) =>
      document.fonts.load(spec).catch(() => {
        console.warn("[MonExGameAssets] Font load failed:", spec);
        return null;
      })
    ));
    return true;
  }

  /** Fetch-only audio warm cache — does not call play() (autoplay policy safe). */
  async function preloadAudio(url) {
    if (!url) return false;
    const key = normalizeUrl(url);
    if (audioCache.has(key)) return audioCache.get(key);
    const promise = fetch(url)
      .then((res) => res.ok)
      .catch(() => {
        console.warn("[MonExGameAssets] Audio preload failed:", url);
        return false;
      });
    audioCache.set(key, promise);
    return promise;
  }

  async function runPool(tasks, concurrency, onTaskDone) {
    let index = 0;
    let done = 0;
    async function worker() {
      while (index < tasks.length) {
        const i = index++;
        await tasks[i]();
        done += 1;
        onTaskDone(done);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length || 1) }, () => worker());
    await Promise.all(workers);
  }

  /**
   * Load a manifest: { images: string[], fallbacks?: Record<string,string>, audio?: string[] }
   * Marks ready when all tasks finish (non-fatal failures still allow ready — avoids infinite boot).
   */
  async function loadManifest(manifest) {
    if (state.status === "ready") return state;

    state.status = "loading";
    state.failedAssets = [];
    state.progress = 0;
    state.loadedAssets = 0;

    const images = [...new Set((manifest?.images || []).filter(Boolean))];
    const fallbacks = manifest?.fallbacks || {};
    const audio = [...new Set((manifest?.audio || []).filter(Boolean))];
    const total = images.length + audio.length + 1;
    state.totalAssets = total;
    setProgress(0, total);

    await preloadFonts();
    setProgress(1, total);

    const imageTasks = images.map((url) => async () => {
      const fb = fallbacks[normalizeUrl(url)] || fallbacks[url];
      await preloadImage(url, fb);
    });

    let imageDone = 0;
    await runPool(imageTasks, LOAD_CONCURRENCY, (n) => {
      imageDone = n;
      setProgress(1 + imageDone, total);
    });

    let audioDone = 0;
    const audioTasks = audio.map((url) => async () => {
      await preloadAudio(url);
    });
    await runPool(audioTasks, LOAD_CONCURRENCY, (n) => {
      audioDone = n;
      setProgress(1 + images.length + audioDone, total);
    });

    state.progress = 1;
    state.status = "ready";
    if (state.failedAssets.length) {
      console.warn("[MonExGameAssets] Boot completed with failed assets:", state.failedAssets);
    }
    updateProgressUI();
    return state;
  }

  function isReady() {
    return state.status === "ready";
  }

  function isLoaded(url) {
    return imageCache.has(normalizeUrl(url));
  }

  function getImageLoadPromise(url, fallbackUrl) {
    return preloadImage(url, fallbackUrl);
  }

  function showLoadingScreen(show) {
    const screen = document.getElementById("game-loading-screen");
    const shell = document.querySelector(".game-shell");
    if (screen) {
      screen.hidden = !show;
      screen.classList.toggle("is-visible", !!show);
    }
    if (shell) shell.classList.toggle("game-shell--loading", !!show);
  }

  async function bootFromManifest(manifest) {
    showLoadingScreen(true);
    try {
      await loadManifest(manifest);
    } finally {
      showLoadingScreen(false);
    }
    return state;
  }

  const api = {
    state,
    MAX_RETRIES,
    normalizeUrl,
    preloadImage,
    preloadImages,
    preloadFonts,
    preloadAudio,
    loadManifest,
    bootFromManifest,
    isReady,
    isLoaded,
    getImageLoadPromise,
    showLoadingScreen,
  };

  window.MonExGameAssets = api;
  if (typeof globalThis !== "undefined") globalThis.MonExGameAssets = api;
})();
