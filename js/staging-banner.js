(function () {
  var host = location.hostname.toLowerCase();
  var isStaging =
    host.endsWith(".pages.dev") ||
    host === "localhost" ||
    host === "127.0.0.1";
  if (!isStaging) return;

  var bar = document.createElement("div");
  bar.setAttribute("role", "status");
  bar.textContent = "STAGING — not live on monexmonad.xyz until you promote to main";
  bar.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:99999;" +
    "background:#b45309;color:#fff;text-align:center;padding:8px 12px;" +
    "font:bold 10px/1.5 'Press Start 2P',monospace;letter-spacing:0.02em;";
  document.documentElement.insertBefore(bar, document.body);
  document.body.style.marginTop = "36px";
})();
