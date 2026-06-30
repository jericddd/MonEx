(function () {
  var host = location.hostname.toLowerCase();
  var isStaging =
    host.endsWith(".pages.dev") ||
    host === "localhost" ||
    host === "127.0.0.1";
  if (!isStaging) return;

  var bar = document.createElement("div");
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-label", "Staging environment");
  bar.textContent = "STAGING — not live on monexmonad.xyz until you promote to main";
  bar.style.cssText =
    "position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:99999;" +
    "background:#b45309;color:#fff;padding:10px 5px;" +
    "font:bold 7px/1.45 'Press Start 2P',monospace;letter-spacing:0.04em;" +
    "writing-mode:vertical-rl;text-orientation:mixed;" +
    "border-radius:0 8px 8px 0;box-shadow:2px 0 10px rgba(0,0,0,0.18);" +
    "max-height:min(92vh,640px);overflow:hidden;pointer-events:none;";
  document.documentElement.appendChild(bar);
})();
