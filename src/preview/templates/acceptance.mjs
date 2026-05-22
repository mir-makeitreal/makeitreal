// Acceptance & Evidence section template for Architecture Dossier.
// Pure refactor — extracted from render-dashboard-html.mjs.

import {
  escapeHtml,
  renderAcceptance,
  renderTestResults,
  renderSourcesList,
  conciseTitleFromText,
} from "./shared.mjs";

function relativeRunDir(runDir) {
  const path = String(runDir ?? "");
  const marker = ".makeitreal/";
  const index = path.indexOf(marker);
  if (index >= 0) {
    return path.slice(index);
  }
  return path;
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
      <code>${escapeHtml(relativeRunDir(model.run.runDir))}</code>
    </div>
  </div>`;
}

function renderDeveloperDiagnostics(model, status) {
  return `<details class="diagnostics-panel">
    <summary>Developer Diagnostics</summary>
    <p class="section-note">Canonical files remain available for audit, automation, and zero-context agent handoff. These are diagnostics, not the primary Blueprint review surface.</p>
    <div class="doc-table">
      <div class="doc-row"><div class="doc-key">Current run phase</div><div class="doc-value"><code>${escapeHtml(status.phase ?? "unknown")}</code></div></div>
      <div class="doc-row"><div class="doc-key">Blueprint status</div><div class="doc-value"><code>${escapeHtml(status.blueprintStatus ?? "unknown")}</code></div></div>
      <div class="doc-row"><div class="doc-key">Run directory</div><div class="doc-value"><code>${escapeHtml(relativeRunDir(model.run.runDir))}</code></div></div>
    </div>
    ${renderRawArtifacts(model)}
  </details>`;
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

function renderWorkItemCard(workItem) {
  const title = conciseTitleFromText(workItem.title ?? workItem.id);
  const flags = [
    workItem.isBlocked ? "blocked" : null,
    workItem.isRetryReady ? "retry ready" : null,
    workItem.isRework ? "rework" : null,
    workItem.claim ? `claimed by ${workItem.claim.workerId}` : null
  ].filter(Boolean);
  return `<article class="work-card" data-work-item-id="${escapeHtml(workItem.id)}">
    <strong>${escapeHtml(title)}</strong>
    <code>${escapeHtml(workItem.id)}</code>
    <span>${escapeHtml(workItem.responsibilityUnitId)}</span>
    ${flags.length > 0 ? `<em>${escapeHtml(flags.join(" | "))}</em>` : ""}
  </article>`;
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

function groupBoardForOperator(board) {
  const order = ["Planned", "Ready", "In Progress", "Review", "Done", "Blocked"];
  const groups = new Map(order.map((name) => [name, { name, workItems: [] }]));
  for (const lane of board.lanes ?? []) {
    for (const workItem of lane.workItems ?? []) {
      groups.get(operatorLaneFor(workItem)).workItems.push({ ...workItem, internalLane: lane.name });
    }
  }
  return [...groups.values()].filter((group) => group.workItems.length > 0 || group.name !== "Blocked");
}

function renderCompactKanban(board) {
  if (!board) {
    return '<div class="compact-kanban" data-operator-kanban="true"><p class="empty">No launch board materialized yet.</p></div>';
  }
  const groups = groupBoardForOperator(board);
  return `<div class="compact-kanban" data-operator-kanban="true">${groups.map((group) => `<section class="kanban-lane" data-lane="${escapeHtml(group.name)}">
    <header><span>${escapeHtml(group.name)}</span><strong>${group.workItems.length}</strong></header>
    ${group.workItems.slice(0, 3).map(renderWorkItemCard).join("")}
    ${group.workItems.length > 3 ? `<p class="muted">+${group.workItems.length - 3} more</p>` : ""}
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
  return `<details class="status-rail" data-read-only-cockpit="${cockpit.readOnly ? "true" : "false"}" data-live-status-rail>
    <summary>
      <span>Run Status & Kanban</span>
      <strong data-live-phase>${escapeHtml(status.phase ?? "unknown")}</strong>
    </summary>
    <div class="status-grid">
      <section>
        <p class="rail-label">Current Run</p>
        <h2 data-live-phase>${escapeHtml(status.phase ?? "unknown")}</h2>
        <p><strong data-live-headline>${escapeHtml(status.headline ?? "Status unavailable.")}</strong></p>
        <p class="muted">Read-only dashboard. State changes stay in Claude Code.</p>
        <div class="command-copy">
          <code data-live-next-command>${escapeHtml(status.nextCommand ?? status.nextAction ?? "none")}</code>
          <button type="button" class="copy-command" data-live-copy-command data-copy="${escapeHtml(status.nextCommand ?? status.nextAction ?? "")}">Copy</button>
        </div>
      </section>

      <section>
        <h3>Kanban</h3>
        <div data-live-kanban>${renderCompactKanban(board)}</div>
      </section>

      <section>
        <h3>Blockers</h3>
        <div data-live-blockers>${renderBlockers(status.blockers)}</div>
      </section>

      <section>
        <h3>Evidence Links</h3>
        <div data-live-evidence-links>${renderEvidenceLinks(cockpit.evidenceLinks)}</div>
      </section>

      <section>
        <h3>First Run</h3>
        <ol class="guide-steps">${cockpit.firstRunChecklist.map(renderChecklistStep).join("")}</ol>
      </section>
    </div>
  </details>`;
}

export function renderAcceptanceEvidenceSection(model, dossier, blueprint) {
  return `<section id="acceptance-evidence" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Acceptance</p>
        <h2>Acceptance &amp; Evidence</h2>
      </div>
    </div>

    <h3>Acceptance Criteria</h3>
    ${renderAcceptance(blueprint.acceptanceCriteria, dossier.workItems)}

    ${(dossier.reviewDecisions ?? []).length > 0 ? `<h3 style="margin-top:20px;">Review Decisions</h3>
    <ol class="review-decisions">${dossier.reviewDecisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol>` : ""}

    <h3 style="margin-top:20px;">Verification Evidence</h3>
    ${renderTestResults(model.status.evidenceSummary ?? [])}

    <h3 style="margin-top:20px;">Sources</h3>
    ${renderSourcesList(dossier.sources ?? [])}

    <details class="diagnostics-panel" style="margin-top:20px;">
      <summary>Diagnostics</summary>
      <p class="section-note">Runtime state and board details are kept here for audit only. The Architecture Dossier above is the primary review surface.</p>
      ${renderDeveloperDiagnostics(model, model.status)}
      <section>
        <h3>Board State</h3>
        <div data-live-kanban>${renderCompactKanban(model.board)}</div>
      </section>
    </details>
  </section>`;
}
