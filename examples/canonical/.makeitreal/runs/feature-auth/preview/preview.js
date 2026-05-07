(() => {
  const pollMs = 2000;
  const fileFallbackMs = 5000;
  let lastSnapshot = null;
  let pollTimer = null;
  let fileFallbackTimer = null;
  let reloadWhenVisible = false;

  function reloadDashboard() {
    if (document.visibilityState === "hidden") {
      reloadWhenVisible = true;
      return;
    }
    window.location.reload();
  }

  function startFileFallback() {
    if (window.location.protocol !== "file:" || fileFallbackTimer) {
      return;
    }
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    fileFallbackTimer = window.setInterval(reloadDashboard, fileFallbackMs);
  }


  function bindCommandCopy() {
    for (const button of document.querySelectorAll(".copy-command[data-copy]")) {
      button.addEventListener("click", async () => {
        const text = button.getAttribute("data-copy") ?? "";
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Copy failed";
        }
      });
    }
  }

  async function checkForDashboardUpdate() {
    try {
      const response = await fetch("./preview-model.json", { cache: "no-store" });
      if (!response.ok) {
        startFileFallback();
        return;
      }
      const snapshot = JSON.stringify(await response.json());
      if (lastSnapshot === null) {
        lastSnapshot = snapshot;
        return;
      }
      if (snapshot !== lastSnapshot) {
        reloadDashboard();
      }
    } catch {
      startFileFallback();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (reloadWhenVisible && document.visibilityState === "visible") {
      reloadDashboard();
    }
  });

  window.makeitrealAutoReload = { checkForDashboardUpdate };
  bindCommandCopy();
  checkForDashboardUpdate();
  pollTimer = window.setInterval(checkForDashboardUpdate, pollMs);
  console.info("makeitreal:auto-reload");
})();
