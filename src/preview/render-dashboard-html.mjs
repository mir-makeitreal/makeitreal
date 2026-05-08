function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTextList(values = []) {
  if (!values || values.length === 0) {
    return '<p class="empty">None recorded.</p>';
  }
  return `<ul class="clean-list">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function renderAcceptance(criteria = []) {
  if (criteria.length === 0) {
    return '<p class="empty">No acceptance criteria recorded.</p>';
  }
  return `<div class="criteria-list">${criteria.map((criterion) => `<div class="criterion">
    <strong>${escapeHtml(criterion.id ?? "AC")}</strong>
    <span>${escapeHtml(criterion.statement ?? criterion)}</span>
  </div>`).join("")}</div>`;
}

function renderContract(contract) {
  if (!contract) {
    return '<p class="empty">No API or IO contract declared.</p>';
  }
  if (contract.kind === "none") {
    return `<div class="contract-card">
      <span class="method neutral">NO API</span>
      <div>
        <strong>Contract evidence is non-API</strong>
        <p>${escapeHtml(contract.reason ?? "No external API surface for this work.")}</p>
      </div>
    </div>`;
  }
  return `<div class="contract-card">
    <span class="method">${escapeHtml(contract.kind ?? "contract")}</span>
    <div>
      <strong>${escapeHtml(contract.contractId ?? "Unnamed contract")}</strong>
      <p>${escapeHtml(contract.path ?? "No contract path recorded.")}</p>
    </div>
    ${contract.path ? `<code>${escapeHtml(contract.path)}</code>` : ""}
  </div>`;
}

function renderContracts(contracts = []) {
  if (contracts.length === 0) {
    return '<p class="empty">No contracts declared.</p>';
  }
  return contracts.map(renderContract).join("");
}

function renderBoundaries(boundaries = []) {
  if (boundaries.length === 0) {
    return '<p class="empty">No responsibility boundaries declared.</p>';
  }
  return `<div class="boundary-grid">${boundaries.map((boundary) => `<article class="boundary-card">
    <strong>${escapeHtml(boundary.responsibilityUnitId)}</strong>
    <div class="path-list">${(boundary.owns ?? []).map((path) => `<code>${escapeHtml(path)}</code>`).join("")}</div>
    ${(boundary.mayUseContracts ?? []).length > 0
      ? `<p>May use: ${boundary.mayUseContracts.map((contract) => `<code>${escapeHtml(contract)}</code>`).join(" ")}</p>`
      : '<p class="muted">No cross-boundary contract dependencies.</p>'}
  </article>`).join("")}</div>`;
}

function renderArchitecture(architecture = {}) {
  const edges = architecture.edges ?? [];
  if (edges.length === 0) {
    return '<p class="empty">No architecture edges declared.</p>';
  }
  return `<div class="flow-line">${edges.map((edge) => `<span>${escapeHtml(edge.from)}</span>
    <b>→</b>
    <span>${escapeHtml(edge.to)}</span>
    <code>${escapeHtml(edge.contractId)}</code>`).join("")}</div>`;
}

function renderCallStacks(callStacks = []) {
  if (callStacks.length === 0) {
    return '<p class="empty">No call stacks declared.</p>';
  }
  return `<div class="doc-table">${callStacks.map((stack) => `<div class="doc-row">
    <div class="doc-key">${escapeHtml(stack.entrypoint)}</div>
    <div class="doc-value">${(stack.calls ?? []).map((call) => `<code>${escapeHtml(call)}</code>`).join(" → ")}</div>
  </div>`).join("")}</div>`;
}

function renderSequences(sequences = []) {
  if (sequences.length === 0) {
    return '<p class="empty">No sequence diagrams declared.</p>';
  }
  return sequences.map((sequence) => `<article class="sequence-card">
    <strong>${escapeHtml(sequence.title)}</strong>
    <ol>${(sequence.messages ?? []).map((message) => `<li><span>${escapeHtml(message.from)}</span> → <span>${escapeHtml(message.to)}</span>: ${escapeHtml(message.label)}</li>`).join("")}</ol>
  </article>`).join("");
}

function renderStateTransitions(transitions = []) {
  if (transitions.length === 0) {
    return '<p class="empty">No state transitions declared.</p>';
  }
  return `<div class="transition-list">${transitions.map((transition) => `<span>${escapeHtml(transition.from)} → ${escapeHtml(transition.to)} <code>${escapeHtml(transition.gate)}</code></span>`).join("")}</div>`;
}

function renderBlockers(blockers = []) {
  if (blockers.length === 0) {
    return '<p class="empty">No active blockers.</p>';
  }
  return `<div class="rail-list">${blockers.map((blocker) => `<div>
    <strong>${escapeHtml(blocker.code)}</strong>
    <p>${escapeHtml(blocker.message)}</p>
    ${blocker.nextAction ? `<code>${escapeHtml(blocker.nextAction)}</code>` : ""}
  </div>`).join("")}</div>`;
}

function renderEvidenceSummary(evidence = []) {
  if (evidence.length === 0) {
    return '<p class="empty">No evidence recorded yet.</p>';
  }
  return `<div class="rail-list">${evidence.map((item) => `<div>
    <strong>${escapeHtml(item.kind)}</strong>
    <p>${escapeHtml(item.summary)}${item.workItemId ? ` for ${escapeHtml(item.workItemId)}` : ""}</p>
    <code>${escapeHtml(item.path)}</code>
  </div>`).join("")}</div>`;
}

function renderEvidenceLinks(links = []) {
  if (links.length === 0) {
    return renderEvidenceSummary([]);
  }
  return `<div class="rail-list">${links.map((link) => {
    const label = `${link.kind}: ${link.summary || link.path}`;
    return `<div>
      ${link.href ? `<a href="${escapeHtml(link.href)}">${escapeHtml(label)}</a>` : `<strong>${escapeHtml(label)}</strong>`}
      <code>${escapeHtml(link.path)}</code>
    </div>`;
  }).join("")}</div>`;
}

function renderRawArtifacts(model) {
  const artifacts = [
    ["PRD", "prd.json"],
    ["Design Pack", "design-pack.json"],
    ["Responsibility Units", "responsibility-units.json"],
    ["Preview Model", "preview/preview-model.json"]
  ];
  return `<div class="artifact-grid">${artifacts.map(([label, file]) => `<div>
    <strong>${escapeHtml(label)}</strong>
    <code>${escapeHtml(file)}</code>
  </div>`).join("")}
    <div>
      <strong>Run Directory</strong>
      <code>${escapeHtml(model.run.runDir)}</code>
    </div>
  </div>`;
}

function renderWorkItemCard(workItem) {
  const flags = [
    workItem.isBlocked ? "blocked" : null,
    workItem.isRetryReady ? "retry ready" : null,
    workItem.isRework ? "rework" : null,
    workItem.claim ? `claimed by ${workItem.claim.workerId}` : null
  ].filter(Boolean);
  return `<article class="work-card" data-work-item-id="${escapeHtml(workItem.id)}">
    <strong>${escapeHtml(workItem.title ?? workItem.id)}</strong>
    <code>${escapeHtml(workItem.id)}</code>
    <span>${escapeHtml(workItem.responsibilityUnitId)}</span>
    ${flags.length > 0 ? `<em>${escapeHtml(flags.join(" | "))}</em>` : ""}
  </article>`;
}

function renderCompactKanban(board) {
  if (!board) {
    return '<p class="empty">No launch board materialized yet.</p>';
  }
  return `<div class="compact-kanban">${board.lanes.map((lane) => `<section class="kanban-lane" data-lane="${escapeHtml(lane.name)}">
    <header><span>${escapeHtml(lane.name)}</span><strong>${lane.workItems.length}</strong></header>
    ${lane.workItems.slice(0, 3).map(renderWorkItemCard).join("")}
  </section>`).join("")}</div>`;
}

function renderChecklistStep(step) {
  return `<li class="guide-step ${escapeHtml(step.status)}">
    <span>${escapeHtml(step.label)}</span>
    <strong>${escapeHtml(step.status)}</strong>
    <code>${escapeHtml(step.command)}</code>
  </li>`;
}

function renderOperatorCockpit(cockpit, board, status) {
  if (!cockpit) {
    return "";
  }
  return `<aside class="status-rail" data-read-only-cockpit="${cockpit.readOnly ? "true" : "false"}">
    <section>
      <p class="rail-label">Runtime Snapshot</p>
      <h2>${escapeHtml(status.phase ?? "unknown")}</h2>
      <p><strong>${escapeHtml(status.headline ?? "Status unavailable.")}</strong></p>
      <p class="muted">Read-only dashboard. State changes stay in Claude Code.</p>
      <div class="command-copy">
        <code>${escapeHtml(status.nextCommand ?? status.nextAction ?? "none")}</code>
        <button type="button" class="copy-command" data-copy="${escapeHtml(status.nextCommand ?? status.nextAction ?? "")}">Copy</button>
      </div>
    </section>

    <section>
      <h3>Kanban</h3>
      ${renderCompactKanban(board)}
    </section>

    <section>
      <h3>Blockers</h3>
      ${renderBlockers(status.blockers)}
    </section>

    <section>
      <h3>Evidence Links</h3>
      ${renderEvidenceLinks(cockpit.evidenceLinks)}
    </section>

    <section>
      <h3>First Run</h3>
      <ol class="guide-steps">${cockpit.firstRunChecklist.map(renderChecklistStep).join("")}</ol>
    </section>
  </aside>`;
}

export function renderDashboardHtml(model) {
  const blueprint = model.blueprint ?? {};
  const primarySummary = (blueprint.summary ?? [])[0] ?? "No user-visible behavior recorded.";
  const primaryContract = blueprint.primaryContract;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Make It Real Blueprint - ${escapeHtml(blueprint.title ?? model.run.workItemId)}</title>
  <link rel="stylesheet" href="./preview.css">
</head>
<body>
  <main class="doc-shell">
    <nav class="doc-nav" aria-label="Blueprint sections">
      <p class="eyebrow">Make It Real</p>
      <strong>Blueprint Reference</strong>
      <a href="#overview" class="active">Overview</a>
      <a href="#delivery">What Will Be Delivered</a>
      <a href="#contracts">API / IO Contract</a>
      <a href="#boundaries">Responsibility Boundaries</a>
      <a href="#flow">Sequence & Call Stack</a>
      <a href="#evidence">Acceptance Evidence</a>
      <a href="#artifacts">Raw Artifacts</a>
      <a href="#runtime">Runtime Snapshot</a>
    </nav>

    <article class="doc-main">
      <header id="overview" class="hero-panel">
        <p class="eyebrow">Blueprint Reference / ${escapeHtml(model.run.workItemId)}</p>
        <h1>${escapeHtml(blueprint.title ?? model.run.workItemId)}</h1>
        <p class="summary-line">${escapeHtml(primarySummary)}</p>
        <div class="metric-grid">
          <div><span>Status</span><strong>${escapeHtml(model.status.blueprintStatus ?? "unknown")}</strong></div>
          <div><span>Phase</span><strong>${escapeHtml(model.status.phase ?? "unknown")}</strong></div>
          <div><span>Primary Contract</span><strong>${escapeHtml(primaryContract?.contractId ?? primaryContract?.kind ?? "none")}</strong></div>
          <div><span>Next Action</span><strong>${escapeHtml(model.status.nextAction ?? "none")}</strong></div>
        </div>
      </header>

      <section id="delivery" class="doc-section">
        <h2>What Will Be Delivered</h2>
        <div class="doc-table">
          <div class="doc-row"><div class="doc-key">Goals</div><div class="doc-value">${renderTextList(blueprint.goals)}</div></div>
          <div class="doc-row"><div class="doc-key">User-visible behavior</div><div class="doc-value">${renderTextList(blueprint.summary)}</div></div>
          <div class="doc-row"><div class="doc-key">Non-goals</div><div class="doc-value">${renderTextList(blueprint.nonGoals)}</div></div>
        </div>
      </section>

      <section id="contracts" class="doc-section">
        <h2>API / Interface Specs</h2>
        <p class="section-note">API / IO Contract surfaces that other responsibility units must use without reading implementation internals.</p>
        ${renderContracts(blueprint.contracts)}
      </section>

      <section id="boundaries" class="doc-section">
        <h2>Responsibility Boundaries</h2>
        ${renderBoundaries(blueprint.boundaries)}
      </section>

      <section id="flow" class="doc-section">
        <h2>Sequence & Call Stack</h2>
        <h3>System Architecture</h3>
        ${renderArchitecture(blueprint.architecture)}
        <h3>State Transition Flow</h3>
        ${renderStateTransitions(blueprint.stateTransitions)}
        <h3>Call Stack</h3>
        ${renderCallStacks(blueprint.callStacks)}
        <h3>Sequence Diagrams</h3>
        ${renderSequences(blueprint.sequences)}
      </section>

      <section id="evidence" class="doc-section">
        <h2>Acceptance Evidence</h2>
        ${renderAcceptance(blueprint.acceptanceCriteria)}
        <h3>Latest Evidence Summary</h3>
        ${renderEvidenceSummary(model.status.evidenceSummary)}
      </section>

      <section id="artifacts" class="doc-section">
        <h2>Raw Artifacts</h2>
        <p class="section-note">Canonical files remain available for audit, automation, and zero-context agent handoff.</p>
        ${renderRawArtifacts(model)}
      </section>
    </article>

    <div id="runtime">
      ${renderOperatorCockpit(model.operatorCockpit, model.board, model.status)}
    </div>
  </main>
  <script src="./preview.js"></script>
</body>
</html>
`;
}

export function renderDashboardCss() {
  return `
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --ink: #17202a;
  --muted: #667085;
  --line: #d9dee7;
  --soft-line: #eaecf0;
  --soft: #f9fafb;
  --accent: #3057d5;
  --accent-soft: #eef4ff;
  --ok: #027a48;
  --warn: #a16207;
  --bad: #b42318;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.55;
}

code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: .88em;
}

a { color: var(--accent); text-decoration: none; }

.doc-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 300px;
  gap: 18px;
  max-width: 1480px;
  margin: 0 auto;
  padding: 18px;
}

.doc-nav,
.status-rail,
.hero-panel,
.doc-section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.doc-nav,
.status-rail {
  position: sticky;
  top: 18px;
  align-self: start;
}

.doc-nav {
  display: grid;
  gap: 6px;
  padding: 14px;
}

.doc-nav strong {
  margin-bottom: 8px;
  font-size: 15px;
}

.doc-nav a {
  padding: 8px 10px;
  border-radius: 6px;
  color: #344054;
  font-size: 13px;
}

.doc-nav a.active,
.doc-nav a:hover {
  background: var(--accent-soft);
  color: #263ca8;
  font-weight: 700;
}

.doc-main {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.hero-panel,
.doc-section,
.status-rail section {
  padding: 18px;
}

.eyebrow,
.rail-label {
  margin: 0 0 6px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 48px);
  line-height: 1.05;
  letter-spacing: 0;
}

h2 {
  margin: 0 0 12px;
  font-size: 20px;
  letter-spacing: 0;
}

h3 {
  margin: 18px 0 8px;
  font-size: 14px;
  letter-spacing: 0;
}

.summary-line {
  max-width: 820px;
  color: #344054;
  font-size: 16px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.metric-grid div,
.doc-table,
.contract-card,
.boundary-card,
.sequence-card,
.criterion,
.compact-kanban .kanban-lane,
.rail-list > div {
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
}

.metric-grid div {
  padding: 10px;
}

.metric-grid span {
  display: block;
  color: var(--muted);
  font-size: 11px;
}

.metric-grid strong {
  display: block;
  margin-top: 4px;
  font-size: 13px;
}

.doc-table {
  overflow: hidden;
  background: var(--panel);
}

.doc-row {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  border-top: 1px solid var(--soft-line);
}

.doc-row:first-child { border-top: 0; }

.doc-key,
.doc-value {
  padding: 11px 12px;
}

.doc-key {
  background: var(--soft);
  color: #475467;
  font-weight: 700;
}

.doc-value ul {
  margin: 0;
}

.clean-list {
  padding-left: 18px;
}

.empty,
.muted,
.section-note {
  color: var(--muted);
}

.contract-card {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  background: var(--panel);
}

.contract-card p {
  margin: 3px 0 0;
  color: var(--muted);
}

.method {
  display: inline-flex;
  justify-content: center;
  border-radius: 999px;
  padding: 5px 8px;
  background: #ecfdf3;
  color: var(--ok);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.method.neutral {
  background: var(--accent-soft);
  color: var(--accent);
}

.boundary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.boundary-card {
  padding: 12px;
  background: var(--panel);
}

.path-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;
}

.path-list code,
.transition-list code {
  border: 1px solid var(--soft-line);
  border-radius: 999px;
  padding: 2px 7px;
  background: var(--soft);
}

.flow-line,
.transition-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.flow-line span,
.transition-list span {
  border: 1px solid var(--soft-line);
  border-radius: 999px;
  padding: 7px 10px;
  background: var(--panel);
  font-size: 13px;
}

.flow-line b {
  color: #98a2b3;
}

.sequence-card,
.criterion {
  padding: 11px 12px;
  background: var(--panel);
}

.sequence-card ol,
.criteria-list {
  display: grid;
  gap: 8px;
}

.criteria-list {
  margin-bottom: 18px;
}

.criterion {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 10px;
}

.status-rail {
  display: grid;
  gap: 0;
  overflow: hidden;
}

.status-rail section {
  border-top: 1px solid var(--soft-line);
}

.status-rail section:first-child {
  border-top: 0;
}

.status-rail h2 {
  font-size: 24px;
}

.command-copy {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.copy-command {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  padding: 5px 9px;
}

.compact-kanban {
  display: grid;
  gap: 8px;
}

.compact-kanban .kanban-lane {
  padding: 8px;
  background: var(--panel);
}

.kanban-lane header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  color: #344054;
  font-size: 12px;
}

.work-card {
  display: grid;
  gap: 4px;
  border-top: 1px solid var(--soft-line);
  padding-top: 7px;
  margin-top: 7px;
  font-size: 12px;
}

.work-card strong {
  font-size: 13px;
}

.work-card span,
.work-card em {
  color: var(--muted);
  font-style: normal;
}

.rail-list {
  display: grid;
  gap: 8px;
}

.rail-list > div {
  padding: 9px;
  background: var(--panel);
}

.artifact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.artifact-grid > div {
  display: grid;
  gap: 5px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
  padding: 10px;
}

.rail-list p {
  margin: 3px 0;
  color: var(--muted);
  font-size: 12px;
}

.guide-steps {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.guide-step {
  display: grid;
  gap: 3px;
  border-top: 1px solid var(--soft-line);
  padding-top: 8px;
}

.guide-step:first-child {
  border-top: 0;
  padding-top: 0;
}

.guide-step strong {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
}

.guide-step.complete strong { color: var(--ok); }
.guide-step.current strong,
.guide-step.blocked strong { color: var(--warn); }

@media (max-width: 1080px) {
  .doc-shell {
    grid-template-columns: 1fr;
  }

  .doc-nav,
  .status-rail {
    position: static;
  }

  .doc-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .doc-shell {
    padding: 12px;
  }

  .doc-nav,
  .metric-grid,
  .boundary-grid {
    grid-template-columns: 1fr;
  }

  .doc-row,
  .contract-card,
  .criterion,
  .artifact-grid {
    grid-template-columns: 1fr;
  }
}
`;
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
