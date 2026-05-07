function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderList(values) {
  if (!values || values.length === 0) {
    return "<p class=\"empty\">None recorded.</p>";
  }
  return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function renderBlockers(blockers = []) {
  if (blockers.length === 0) {
    return "<p class=\"empty\">No active blockers.</p>";
  }
  return `<ul>${blockers.map((blocker) => `<li><strong>${escapeHtml(blocker.code)}</strong>: ${escapeHtml(blocker.message)} <code>${escapeHtml(blocker.nextAction ?? "")}</code></li>`).join("")}</ul>`;
}

function renderEvidenceSummary(evidence = []) {
  if (evidence.length === 0) {
    return "<p class=\"empty\">No evidence has been recorded yet.</p>";
  }
  return `<ul>${evidence.map((item) => `<li>${escapeHtml(item.kind)} ${item.workItemId ? `for ${escapeHtml(item.workItemId)}` : ""}: ${escapeHtml(item.summary)} <code>${escapeHtml(item.path)}</code></li>`).join("")}</ul>`;
}

function renderTags(values = []) {
  if (values.length === 0) {
    return "";
  }
  return `<div class=\"tags\">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>`;
}

function renderWorkItemCard(workItem) {
  const flags = [
    workItem.isBlocked ? "blocked" : null,
    workItem.isRetryReady ? "retry ready" : null,
    workItem.isRework ? "rework" : null,
    workItem.claim ? `claimed by ${workItem.claim.workerId}` : null
  ].filter(Boolean);
  return `<article class=\"work-card\" data-work-item-id=\"${escapeHtml(workItem.id)}\">
    <header>
      <strong>${escapeHtml(workItem.title ?? workItem.id)}</strong>
      <code>${escapeHtml(workItem.id)}</code>
    </header>
    <p>Owner: <code>${escapeHtml(workItem.responsibilityUnitId)}</code></p>
    ${renderTags(workItem.contractIds)}
    ${flags.length > 0 ? `<p class=\"flags\">${escapeHtml(flags.join(" | "))}</p>` : ""}
    ${workItem.dependsOn.length > 0 ? `<p>Depends on: ${escapeHtml(workItem.dependsOn.join(", "))}</p>` : ""}
  </article>`;
}

function renderLane(lane) {
  return `<section class=\"kanban-lane\" data-lane=\"${escapeHtml(lane.name)}\">
    <h3>${escapeHtml(lane.name)} <span>${lane.workItems.length}</span></h3>
    <div class=\"lane-items\">
      ${lane.workItems.length === 0 ? "<p class=\"empty\">No work items.</p>" : lane.workItems.map(renderWorkItemCard).join("")}
    </div>
  </section>`;
}

function renderBoard(board) {
  if (!board) {
    return "<p class=\"empty\">No launch board has been materialized for this run.</p>";
  }
  return `<div class=\"kanban-board\">${board.lanes.map(renderLane).join("")}</div>`;
}

function renderChecklistStep(step) {
  return `<li class="guide-step ${escapeHtml(step.status)}">
    <span>${escapeHtml(step.label)}</span>
    <strong>${escapeHtml(step.status)}</strong>
    <code>${escapeHtml(step.command)}</code>
  </li>`;
}

function renderEvidenceLinks(links = []) {
  if (links.length === 0) {
    return '<p class="empty">No evidence links yet.</p>';
  }
  return `<ul>${links.map((link) => {
    const label = `${link.kind}: ${link.summary || link.path}`;
    if (!link.href) {
      return `<li><code>${escapeHtml(link.path)}</code> ${escapeHtml(label)}</li>`;
    }
    return `<li><a href="${escapeHtml(link.href)}">${escapeHtml(label)}</a> <code>${escapeHtml(link.path)}</code></li>`;
  }).join("")}</ul>`;
}

function renderOperatorCockpit(cockpit) {
  if (!cockpit) {
    return "";
  }
  return `<section class="operator-cockpit" data-read-only-cockpit="${cockpit.readOnly ? "true" : "false"}">
    <h2>Operator Cockpit</h2>
    <p class="read-only">State changes happen in Claude Code. This dashboard only explains the run.</p>
    <div class="cockpit-grid">
      <article>
        <h3>First Run</h3>
        <ol class="guide-steps">${cockpit.firstRunChecklist.map(renderChecklistStep).join("")}</ol>
      </article>
      <article>
        <h3>Next Claude Code Action</h3>
        <p>${escapeHtml(cockpit.nextAction)}</p>
        <div class="command-copy">
          <code>${escapeHtml(cockpit.nextCommand)}</code>
          <button type="button" class="copy-command" data-copy="${escapeHtml(cockpit.nextCommand)}">Copy</button>
        </div>
      </article>
      <article>
        <h3>Evidence Links</h3>
        ${renderEvidenceLinks(cockpit.evidenceLinks)}
      </article>
    </div>
  </section>`;
}

export function renderDashboardHtml(model) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Make It Real Dashboard - ${escapeHtml(model.run.workItemId)}</title>
  <link rel="stylesheet" href="./preview.css">
</head>
<body>
  <main>
    <header class="topbar">
      <div>
        <p class="eyebrow">Make It Real</p>
        <h1>${escapeHtml(model.run.workItemId)}</h1>
      </div>
      <dl>
        <div><dt>Phase</dt><dd>${escapeHtml(model.status.phase ?? "unknown")}</dd></div>
        <div><dt>Blueprint</dt><dd>${escapeHtml(model.status.blueprintStatus ?? "unknown")}</dd></div>
        <div><dt>Next</dt><dd><code>${escapeHtml(model.status.nextAction ?? "none")}</code></dd></div>
      </dl>
    </header>

    <section class="summary">
      <h2>Operator Status</h2>
      <p><strong>${escapeHtml(model.status.headline ?? "Status unavailable.")}</strong></p>
      <p class="read-only">Read-only dashboard. Use Make It Real workflow commands for state changes.</p>
    </section>

    ${renderOperatorCockpit(model.operatorCockpit)}

    <section>
      <h2>Kanban Board</h2>
      ${renderBoard(model.board)}
    </section>

    <section>
      <h2>Blockers And Next Action</h2>
      ${renderBlockers(model.status.blockers)}
    </section>

    <section>
      <h2>Latest Evidence Summary</h2>
      ${renderEvidenceSummary(model.status.evidenceSummary)}
    </section>

    <section class="details">
      <h2>System Architecture</h2>${renderList(model.design.architectureEdges)}
      <h2>State Transition Flow</h2>${renderList(model.design.stateTransitions)}
      <h2>API / Interface Specs</h2>${renderList(model.design.apiSpecs)}
      <h2>Responsibility Boundaries</h2>${renderList(model.design.responsibilityBoundaries)}
      <h2>Call Stack</h2>${renderList(model.design.callStacks)}
      <h2>Sequence Diagrams</h2>${renderList(model.design.sequences)}
    </section>
  </main>
  <script src="./preview.js"></script>
</body>
</html>
`;
}

export function renderDashboardCss() {
  return `:root{color-scheme:light dark;--bg:#f7f8fa;--panel:#fff;--ink:#1d232a;--muted:#5f6875;--line:#d9dee7;--accent:#0f766e;--warn:#a16207;--bad:#b42318}@media (prefers-color-scheme:dark){:root{--bg:#111418;--panel:#181d23;--ink:#edf2f7;--muted:#aab3c0;--line:#303844;--accent:#5eead4;--warn:#facc15;--bad:#f87171}}body{font-family:Inter,ui-sans-serif,system-ui,sans-serif;margin:0;background:var(--bg);color:var(--ink);line-height:1.5}main{max-width:1280px;margin:0 auto;padding:24px}.topbar{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:18px}.eyebrow{margin:0 0 4px;color:var(--accent);font-size:12px;font-weight:700;text-transform:uppercase}h1{margin:0;font-size:28px;letter-spacing:0}h2{margin:24px 0 12px;font-size:18px}h3{display:flex;justify-content:space-between;gap:8px;margin:0 0 12px;font-size:14px}dl{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;margin:0}dt{color:var(--muted);font-size:12px}dd{margin:0;font-weight:700}.summary,.details,section{background:transparent}.read-only,.empty{color:var(--muted)}.kanban-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px}.kanban-lane{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;min-height:180px}.lane-items{display:grid;gap:10px}.work-card{background:color-mix(in srgb,var(--panel) 88%,var(--bg));border:1px solid var(--line);border-radius:8px;padding:10px}.work-card header{display:grid;gap:4px}.work-card p{margin:8px 0 0;color:var(--muted);font-size:13px}.work-card code,dd code,li code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.tags span{border:1px solid var(--line);border-radius:999px;padding:2px 8px;color:var(--muted);font-size:12px}.flags{color:var(--warn)!important;font-weight:700}.details{border-top:1px solid var(--line);margin-top:24px;padding-top:4px}ul{padding-left:20px}.operator-cockpit{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:4px 0 18px}.cockpit-grid{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px}.cockpit-grid article{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px}.guide-steps{display:grid;gap:8px;list-style:none;margin:0;padding:0}.guide-step{display:grid;grid-template-columns:1fr auto;gap:4px 8px;border-bottom:1px solid var(--line);padding-bottom:8px}.guide-step code{grid-column:1 / -1}.guide-step.complete strong{color:var(--accent)}.guide-step.current strong,.guide-step.blocked strong{color:var(--warn)}.command-copy{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.copy-command{border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);font:inherit;padding:4px 8px;cursor:pointer}@media (max-width:720px){main{padding:16px}.topbar{display:block}dl{grid-template-columns:1fr;margin-top:16px}.kanban-board{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:1fr}.cockpit-grid{grid-template-columns:1fr}}`;
}

export function renderDashboardJs() {
  return `(() => {
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
`;
}
