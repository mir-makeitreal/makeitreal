(() => {
  const pollMs = 2000;
  let lastSnapshot = null;
  let lastBlueprintSnapshot = null;
  let pollTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setTextAll(selector, value) {
    for (const node of document.querySelectorAll(selector)) {
      node.textContent = String(value ?? "");
    }
  }

  function verificationLabel(status = {}) {
    if (status.phase === "done") {
      return "Verified and synced";
    }
    const verification = (status.evidenceSummary ?? []).find((item) => String(item.kind ?? "").includes("verification"));
    if (verification?.ok === true) {
      return "Verification passed";
    }
    return status.nextAction ?? "Pending review";
  }

  function verificationTileLabel(status = {}) {
    return status.phase === "done" || (status.evidenceSummary ?? []).some((item) => String(item.kind ?? "").includes("verification")) ? "Verification" : "Next Step";
  }

  function renderRailList(items, emptyText, renderer) {
    if (!items || items.length === 0) {
      return '<p class="empty">' + escapeHtml(emptyText) + '</p>';
    }
    return '<div class="rail-list">' + items.map(renderer).join("") + '</div>';
  }

  function renderBlockers(blockers = []) {
    return renderRailList(blockers, "No active blockers.", (blocker) => '<div><strong>' + escapeHtml(blocker.code) + '</strong><p>' + escapeHtml(blocker.message) + '</p>' + (blocker.nextAction ? '<code>' + escapeHtml(blocker.nextAction) + '</code>' : "") + '</div>');
  }

  function renderEvidenceLinks(links = []) {
    return renderRailList(links, "No evidence recorded yet.", (link) => {
      const label = String(link.kind ?? "") + ": " + String(link.summary || link.path || "");
      const target = link.href ? '<a href="' + escapeHtml(link.href) + '">' + escapeHtml(label) + '</a>' : '<strong>' + escapeHtml(label) + '</strong>';
      return '<div>' + target + '<code>' + escapeHtml(link.path ?? "") + '</code></div>';
    });
  }

  function operatorLaneFor(workItem) {
    if (workItem.isBlocked || workItem.isRetryReady || workItem.isRework || ["Failed Fast", "Rework"].includes(workItem.lane)) {
      return "Blocked";
    }
    if (["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen"].includes(workItem.lane)) {
      return "Planned";
    }
    if (["Ready", "Claimed"].includes(workItem.lane)) {
      return "Ready";
    }
    if (workItem.lane === "Running") {
      return "In Progress";
    }
    if (["Verifying", "Human Review"].includes(workItem.lane)) {
      return "Review";
    }
    if (workItem.lane === "Done") {
      return "Done";
    }
    return "Planned";
  }

  function renderWorkItemCard(workItem) {
    const flags = [
      workItem.isBlocked ? "blocked" : null,
      workItem.isRetryReady ? "retry ready" : null,
      workItem.isRework ? "rework" : null,
      workItem.claim ? "claimed by " + workItem.claim.workerId : null
    ].filter(Boolean);
    return '<article class="work-card" data-work-item-id="' + escapeHtml(workItem.id) + '"><strong>' + escapeHtml(workItem.title ?? workItem.id) + '</strong><code>' + escapeHtml(workItem.id) + '</code><span>' + escapeHtml(workItem.responsibilityUnitId) + '</span>' + (flags.length > 0 ? '<em>' + escapeHtml(flags.join(" | ")) + '</em>' : "") + '</article>';
  }

  function renderKanban(board) {
    if (!board) {
      return '<div class="compact-kanban" data-operator-kanban="true"><p class="empty">No launch board materialized yet.</p></div>';
    }
    const order = ["Planned", "Ready", "In Progress", "Review", "Done", "Blocked"];
    const groups = new Map(order.map((name) => [name, { name, workItems: [] }]));
    for (const lane of board.lanes ?? []) {
      for (const workItem of lane.workItems ?? []) {
        groups.get(operatorLaneFor(workItem)).workItems.push({ ...workItem, internalLane: lane.name });
      }
    }
    return '<div class="compact-kanban" data-operator-kanban="true">' + [...groups.values()].filter((group) => group.workItems.length > 0 || group.name !== "Blocked").map((group) => '<section class="kanban-lane" data-lane="' + escapeHtml(group.name) + '"><header><span>' + escapeHtml(group.name) + '</span><strong>' + group.workItems.length + '</strong></header>' + group.workItems.slice(0, 3).map(renderWorkItemCard).join("") + (group.workItems.length > 3 ? '<p class="muted">+' + (group.workItems.length - 3) + ' more</p>' : "") + '</section>').join("") + '</div>';
  }

  function updateRuntime(model) {
    const status = model.status ?? {};
    const dossier = model.blueprint?.systemDossier ?? {};
    const nextCommand = status.nextCommand ?? status.nextAction ?? "";

    setTextAll("[data-live-blueprint-status]", status.blueprintStatus ?? "unknown");
    setTextAll("[data-live-module-count]", (dossier.modules ?? []).length);
    setTextAll("[data-live-contract-count]", (dossier.contractMatrix ?? []).length);
    setTextAll("[data-live-edge-count]", (dossier.dependencyEdges ?? []).length);
    setTextAll("[data-live-verification-tile-label]", verificationTileLabel(status));
    setTextAll("[data-live-verification-label]", verificationLabel(status));
    setTextAll("[data-live-phase]", status.phase ?? "unknown");
    setTextAll("[data-live-headline]", status.headline ?? "Status unavailable.");
    setTextAll("[data-live-next-command]", nextCommand || "none");

    const copyButton = document.querySelector("[data-live-copy-command]");
    if (copyButton) {
      copyButton.setAttribute("data-copy", nextCommand);
      copyButton.textContent = "Copy";
    }
    const kanban = document.querySelector("[data-live-kanban]");
    if (kanban) {
      kanban.innerHTML = renderKanban(model.board);
    }
    const blockers = document.querySelector("[data-live-blockers]");
    if (blockers) {
      blockers.innerHTML = renderBlockers(status.blockers ?? []);
    }
    const evidenceLinks = document.querySelector("[data-live-evidence-links]");
    if (evidenceLinks) {
      evidenceLinks.innerHTML = renderEvidenceLinks(model.operatorCockpit?.evidenceLinks ?? []);
    }
    const blueprintSnapshot = JSON.stringify(model.blueprint ?? {});
    if (lastBlueprintSnapshot !== null && blueprintSnapshot !== lastBlueprintSnapshot) {
      document.documentElement.dataset.makeitrealBlueprintChanged = "true";
    }
    lastBlueprintSnapshot = blueprintSnapshot;
    bindCommandCopy();
  }

  function bindCommandCopy() {
    for (const button of document.querySelectorAll(".copy-command[data-copy]")) {
      if (button.dataset.copyBound === "true") {
        continue;
      }
      button.dataset.copyBound = "true";
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

  function markAutoRefreshUnavailable() {
    document.documentElement.dataset.makeitrealAutoRefresh = "unavailable";
    if (window.location.protocol === "file:") {
      console.info("makeitreal:auto-reload:file-url-no-refresh");
    }
  }

  async function checkForDashboardUpdate() {
    try {
      const response = await fetch("./preview-model.json", { cache: "no-store" });
      if (!response.ok) {
        markAutoRefreshUnavailable();
        return;
      }
      const model = await response.json();
      const snapshot = JSON.stringify(model);
      if (lastSnapshot === null) {
        lastSnapshot = snapshot;
        updateRuntime(model);
        return;
      }
      if (snapshot !== lastSnapshot) {
        updateRuntime(model);
        lastSnapshot = snapshot;
      }
    } catch {
      markAutoRefreshUnavailable();
    }
  }

  window.makeitrealAutoReload = { checkForDashboardUpdate };
  bindCommandCopy();
  checkForDashboardUpdate();
  pollTimer = window.setInterval(checkForDashboardUpdate, pollMs);
  console.info("makeitreal:auto-reload");
})();
