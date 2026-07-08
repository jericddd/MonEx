/** Staging helpers — @test dev login (no effect on live monexmonad.xyz). */
(function () {
  function isStagingSite() {
    const host = location.hostname.toLowerCase();
    return host.endsWith(".pages.dev") || host === "localhost" || host === "127.0.0.1";
  }

  window.MonExStaging = {
    isStagingSite,
    async loginAsTest() {
      if (!isStagingSite()) {
        throw new Error("Test login is only available on staging.");
      }
      if (typeof MonExAuth === "undefined" || !MonExAuth.devLogin) {
        throw new Error("Auth client not loaded.");
      }
      return MonExAuth.devLogin("test");
    },
  };
})();
