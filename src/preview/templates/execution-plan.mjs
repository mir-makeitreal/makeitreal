// Execution Plan section template for Architecture Dossier.
// Pure refactor — extracted from render-dashboard-html.mjs.

import {
  escapeHtml,
  mermaidDiagramCard,
  mermaidLabel,
  conciseTitleFromText,
} from "./shared.mjs";

export function taskLaneClass(lane = "") {
  const normalized = String(lane ?? "").toLowerCase();
  if (normalized.includes("done") || normalized.includes("complete") || normalized.includes("verified")) {
    return "done";
  }
  if (
    normalized.includes("doing") ||
    normalized.includes("running") ||
    normalized.includes("active") ||
    normalized.includes("inprogress") ||
    normalized.includes("in_progress") ||
    normalized.includes("in progress") ||
    normalized.includes("review")
  ) {
    return "running";
  }
  if (normalized.includes("block") || normalized.includes("fail")) {
    return "blocked";
  }
  return "ready";
}

export function taskDagMermaid(dossier = {}) {
  const nodes = dossier.taskDag?.nodes ?? [];
  if (nodes.length === 0) {
    return null;
  }
  const nodeIds = new Map(nodes.map((node, index) => [node.id, `task_${index}`]));
  const lines = ["flowchart TB"];
  for (const node of nodes) {
    const nodeId = nodeIds.get(node.id);
    const title = mermaidLabel(node.title ?? node.moduleName ?? node.responsibilityUnitId ?? node.id);
    const moduleLabel = mermaidLabel(node.moduleName ?? node.responsibilityUnitId ?? "");
    const laneLabel = mermaidLabel(node.lane ?? node.status ?? node.kind ?? "ready");
    const kindLabel = mermaidLabel(node.kind ?? "implementation");
    const label = [
      `<b>${escapeHtml(title)}</b>`,
      escapeHtml(moduleLabel),
      `${escapeHtml(kindLabel)} · ${escapeHtml(laneLabel)}`
    ].join("<br/>");
    lines.push(`  ${nodeId}["${label}"]`);
    lines.push(`  class ${nodeId} ${taskLaneClass(node.lane ?? node.status)}`);
  }
  for (const edge of dossier.taskDag?.edges ?? []) {
    const from = nodeIds.get(edge.from);
    const to = nodeIds.get(edge.to);
    if (from && to) {
      lines.push(`  ${from} -->|"${mermaidLabel(edge.contractId ?? "depends on")}"| ${to}`);
    }
  }
  lines.push("  classDef ready fill:#0f1d2e,stroke:#58a6ff,stroke-width:1px,color:#e6edf3,rx:10,ry:10");
  lines.push("  classDef running fill:#2a210e,stroke:#d29922,stroke-width:1px,color:#e6edf3,rx:10,ry:10");
  lines.push("  classDef done fill:#0f2417,stroke:#3fb950,stroke-width:1px,color:#e6edf3,rx:10,ry:10");
  lines.push("  classDef blocked fill:#2a0f17,stroke:#f85149,stroke-width:1px,color:#e6edf3,rx:10,ry:10");
  return lines.join("\n");
}

export function renderExecutionPlanSection(dossier = {}) {
  const taskDag = dossier.taskDag ?? {};
  const nodes = taskDag.nodes ?? [];
  const topology = dossier.workerTopology ?? {};
  const assignments = topology.assignments ?? [];
  return `<section id="execution-plan" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Execution</p>
        <h2>Execution Plan</h2>
      </div>
    </div>
    <p class="section-note">Work is split by responsibility boundary. A child Task can execute a node without reading sibling implementation context.</p>
    ${mermaidDiagramCard({
      title: "Responsibility Task Graph",
      description: "Required work items and dependency contracts for native Claude Code Task fan-out.",
      diagram: taskDagMermaid(dossier)
    }) || '<p class="empty">No task graph declared.</p>'}
    ${(() => {
      const dagNodes = (dossier.taskDag?.nodes ?? []);
      const dagEdges = (dossier.taskDag?.edges ?? []);
      if (dagNodes.length === 0) return "";
      const inDeg = new Map(dagNodes.map((n) => [n.id, 0]));
      for (const e of dagEdges) { inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1); }
      let frontier = dagNodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id);
      let maxP = frontier.length;
      const visited = new Set(frontier);
      const adj = new Map(dagNodes.map((n) => [n.id, []]));
      for (const e of dagEdges) { (adj.get(e.from) ?? []).push(e.to); }
      while (frontier.length > 0) {
        const next = [];
        for (const id of frontier) {
          for (const child of (adj.get(id) ?? [])) {
            inDeg.set(child, (inDeg.get(child) ?? 1) - 1);
            if (inDeg.get(child) === 0 && !visited.has(child)) { visited.add(child); next.push(child); }
          }
        }
        if (next.length > maxP) maxP = next.length;
        frontier = next;
      }
      return `<p class="section-note"><strong>Maximum parallelism: ${maxP} concurrent agent${maxP === 1 ? "" : "s"}</strong></p>`;
    })()}
    <div class="task-dag-table" role="table" aria-label="Task DAG">
      <div class="task-dag-row header" role="row">
        <div role="columnheader">Work Item</div>
        <div role="columnheader">Responsibility</div>
        <div role="columnheader">Contracts</div>
        <div role="columnheader">Authorized Paths</div>
      </div>
      ${nodes.map((node) => `<div class="task-dag-row" role="row">
        <div role="cell" data-label="Work Item"><strong>${escapeHtml(conciseTitleFromText(node.title))}</strong><code>${escapeHtml(node.id)}</code><span>${escapeHtml(node.kind)}</span></div>
        <div role="cell" data-label="Responsibility"><strong>${escapeHtml(node.moduleName ?? node.responsibilityUnitId)}</strong><code>${escapeHtml(node.responsibilityUnitId)}</code></div>
        <div role="cell" data-label="Contracts">${(node.contractIds ?? []).map((contractId) => `<code>${escapeHtml(contractId)}</code>`).join("")}</div>
        <div role="cell" data-label="Authorized Paths">${(node.allowedPaths ?? []).map((ownedPath) => `<code>${escapeHtml(ownedPath)}</code>`).join("")}</div>
      </div>`).join("")}
    </div>

    ${assignments.length > 0 ? `<div class="section-heading" style="margin-top:28px;">
      <div>
        <p class="eyebrow">Native Agents</p>
        <h3>Worker Topology</h3>
      </div>
    </div>
    <p class="section-note">Each assignment is the planned native Task packet: one responsibility unit, declared contracts, and authorized paths.</p>
    <div class="worker-topology-list">
      ${assignments.map((assignment) => `<article class="worker-assignment">
        <header>
          <div>
            <p class="module-id">${escapeHtml(assignment.workItemId)}</p>
            <h3>${escapeHtml(assignment.moduleName)}</h3>
          </div>
          <code>${escapeHtml(assignment.evidenceRole)}</code>
        </header>
        <p>${escapeHtml(assignment.handoff)}</p>
        <div class="doc-table compact-doc-table">
          <div class="doc-row"><div class="doc-key">Responsibility Unit</div><div class="doc-value"><code>${escapeHtml(assignment.responsibilityUnitId)}</code></div></div>
          <div class="doc-row"><div class="doc-key">Contracts</div><div class="doc-value">${(assignment.contractIds ?? []).map((contractId) => `<code>${escapeHtml(contractId)}</code>`).join("")}</div></div>
          <div class="doc-row"><div class="doc-key">Paths</div><div class="doc-value">${(assignment.allowedPaths ?? []).map((ownedPath) => `<code>${escapeHtml(ownedPath)}</code>`).join("")}</div></div>
        </div>
      </article>`).join("")}
    </div>
    <p class="section-note">Review roles: ${(topology.reviewRoles ?? []).map((role) => `<code>${escapeHtml(role)}</code>`).join(" ")}</p>` : ""}
  </section>`;
}
