// Overview section template for Architecture Dossier.
// Pure refactor — extracted from render-dashboard-html.mjs.

import {
  escapeHtml,
  mermaidDiagramCard,
  mermaidLabel,
  moduleSurfaces,
  surfaceDisplayName,
  signatureInputs,
  signatureOutputs,
  signatureErrors,
  findSurfaceByImport,
  referenceSummary,
  referenceTitle,
  surfaceSignature,
  usageSnippet,
  renderCodeBlock,
  firstPublicSurface,
  moduleAnchor,
  surfaceAnchor,
  anchorSlug,
  renderKeyValueGrid,
} from "./shared.mjs";

export function systemMapMermaid(dossier = {}) {
  const surfaces = moduleSurfaces(dossier);
  if (surfaces.length === 0) {
    return null;
  }

  const lines = ["flowchart LR"];
  const surfaceIds = new Map();
  for (const entry of surfaces) {
    surfaceIds.set(`${entry.moduleInterface.responsibilityUnitId}|${entry.surface.name}`, entry.id);
    lines.push(`  ${entry.id}["${mermaidLabel(surfaceDisplayName(entry))}"]`);
    for (const [inputIndex, input] of signatureInputs(entry.surface).entries()) {
      const id = `input_${entry.moduleIndex}_${entry.surfaceIndex}_${inputIndex}`;
      lines.push(`  ${id}(["${mermaidLabel(`${input.name}: ${input.type}`)}"])`);
      lines.push(`  ${id} --> ${entry.id}`);
    }
    for (const [outputIndex, output] of signatureOutputs(entry.surface).entries()) {
      const id = `output_${entry.moduleIndex}_${entry.surfaceIndex}_${outputIndex}`;
      lines.push(`  ${entry.id} --> ${id}(["${mermaidLabel(`${output.name}: ${output.type}`)}"])`);
    }
    for (const [errorIndex, error] of signatureErrors(entry.surface).entries()) {
      const id = `error_${entry.moduleIndex}_${entry.surfaceIndex}_${errorIndex}`;
      lines.push(`  ${entry.id} -.->|"throws"| ${id}(["${mermaidLabel(error.code)}"])`);
    }
  }

  for (const entry of surfaces) {
    for (const dependency of entry.moduleInterface.imports ?? []) {
      const provider = findSurfaceByImport({ dossier, dependency });
      if (!provider) {
        continue;
      }
      const providerId = surfaceIds.get(`${provider.moduleInterface.responsibilityUnitId}|${provider.surface.name}`);
      if (providerId) {
        lines.push(`  ${entry.id} -->|"${mermaidLabel(dependency.contractId ?? dependency.surface ?? "contract")}"| ${providerId}`);
      }
    }
  }

  return lines.join("\n");
}

export function moduleTopologyMermaid(dossier = {}) {
  const modules = dossier.modules ?? [];
  if (modules.length === 0) {
    return null;
  }
  const moduleIds = new Map();
  const lines = ["flowchart LR"];
  for (const [index, moduleInterface] of modules.entries()) {
    const nodeId = `m${index}`;
    moduleIds.set(moduleInterface.responsibilityUnitId, nodeId);
    moduleIds.set(moduleInterface.moduleName, nodeId);
    const name = mermaidLabel(moduleInterface.moduleName ?? moduleInterface.responsibilityUnitId);
    const ruId = mermaidLabel(moduleInterface.responsibilityUnitId ?? "");
    const surfaceCount = (moduleInterface.publicSurfaces ?? []).length;
    const surfaceLabel = surfaceCount === 1 ? "1 surface" : `${surfaceCount} surfaces`;
    const label = `<b>${escapeHtml(name)}</b><br/>${escapeHtml(ruId)}<br/>${escapeHtml(surfaceLabel)}`;
    lines.push(`  ${nodeId}["${label}"]`);
    lines.push(`  class ${nodeId} module`);
  }

  const seenEdges = new Set();
  for (const moduleInterface of modules) {
    const fromId = moduleIds.get(moduleInterface.responsibilityUnitId);
    if (!fromId) continue;
    for (const dependency of moduleInterface.imports ?? []) {
      const toId =
        moduleIds.get(dependency.providerResponsibilityUnitId) ||
        moduleIds.get(dependency.providerModuleName) ||
        moduleIds.get(dependency.providerName);
      if (!toId) continue;
      const edgeKey = `${fromId}->${toId}:${dependency.contractId ?? dependency.surface ?? ""}`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      const edgeLabel = mermaidLabel(dependency.contractId ?? dependency.surface ?? "contract");
      lines.push(`  ${fromId} -->|"${edgeLabel}"| ${toId}`);
    }
  }

  for (const edge of dossier.dependencyEdges ?? []) {
    const fromId = moduleIds.get(edge.from) || moduleIds.get(edge.fromResponsibilityUnitId);
    const toId = moduleIds.get(edge.to) || moduleIds.get(edge.toResponsibilityUnitId);
    if (!fromId || !toId) continue;
    const edgeKey = `${fromId}->${toId}:${edge.contractId ?? ""}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    lines.push(`  ${fromId} -->|"${mermaidLabel(edge.contractId ?? "contract")}"| ${toId}`);
  }

  lines.push("  classDef module fill:#161b22,stroke:#30363d,stroke-width:1px,color:#e6edf3,rx:10,ry:10");
  return lines.join("\n");
}

export function renderDesignPatterns(patterns = []) {
  if (!patterns || patterns.length === 0) {
    return "";
  }
  return `<section id="design-patterns" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Architecture</p>
        <h2>Design Patterns</h2>
      </div>
    </div>
    <div class="design-patterns-list">
      ${patterns.map((pattern) => `<article class="design-pattern-card" style="padding:12px 16px;border:1px solid var(--line);border-radius:var(--radius-sm);margin-bottom:8px;">
        <strong>${escapeHtml(pattern.name ?? "Unnamed pattern")}</strong>
        <p class="muted" style="margin:4px 0 0;">${escapeHtml(pattern.rationale ?? "")}</p>
        ${pattern.mermaid ? mermaidDiagramCard({
          title: pattern.name,
          description: pattern.rationale,
          diagram: pattern.mermaid
        }) : ""}
      </article>`).join("")}
    </div>
  </section>`;
}

function navSurfaceLinks(module, moduleIndex) {
  const moduleName = String(module.moduleName ?? "").trim().toLowerCase();
  return (module.publicSurfaces ?? [])
    .map((surface, surfaceIndex) => ({ surface, surfaceIndex }))
    .filter(({ surface }) => String(surface.name ?? "").trim().toLowerCase() !== moduleName)
    .map(({ surface, surfaceIndex }) => `<a class="nav-surface" href="#${escapeHtml(surfaceAnchor(module, surface, moduleIndex, surfaceIndex))}">${escapeHtml(surface.name)}</a>`)
    .join("");
}

export function renderDossierNav(dossier = {}) {
  const isEmpty = (key) => {
    if (key === "scenarios") return (dossier.scenarioIndex ?? []).length === 0 && (dossier.scenarioDetails ?? []).length === 0;
    if (key === "execution-plan") return (dossier.taskDag?.nodes ?? []).length === 0;
    if (key === "modules") return (dossier.modules ?? []).length === 0;
    if (key === "acceptance-evidence") return false;
    return false;
  };
  const navCls = (key) => isEmpty(key) ? ' class="nav-empty"' : '';
  const modules = dossier.modules ?? [];
  const moduleSubNav = modules.map((module, moduleIndex) => {
    const surfaceLinks = (module.publicSurfaces ?? [])
      .filter((surface) => String(surface.name ?? "").trim().toLowerCase() !== String(module.moduleName ?? "").trim().toLowerCase())
      .map((surface, surfaceIndex) => `<a class="nav-surface" href="#${escapeHtml(surfaceAnchor(module, surface, moduleIndex, surfaceIndex))}">${escapeHtml(surface.name)}</a>`)
      .join("");
    return `<a class="nav-module" href="#${escapeHtml(moduleAnchor(module, moduleIndex))}">${escapeHtml(module.moduleName)}</a>${surfaceLinks}`;
  }).join("");
  return `<nav class="architecture-nav" aria-label="Architecture Dossier sections">
    <p class="eyebrow">Make It Real</p>
    <strong>Architecture Dossier</strong>
    <label class="nav-filter">
      <span>Filter reference</span>
      <input type="search" data-nav-filter placeholder="Module, surface, contract">
    </label>
    <a href="#overview" class="active">Overview</a>
    <a href="#scenarios"${navCls("scenarios")}>Scenarios</a>
    <a href="#execution-plan"${navCls("execution-plan")}>Execution Plan</a>
    <a href="#modules"${navCls("modules")}>Modules</a>
    ${modules.length > 0 ? `<div class="nav-group"><span>Modules</span>${moduleSubNav}</div>` : ""}
    <a href="#acceptance-evidence">Acceptance &amp; Evidence</a>
  </nav>`;
}

export function renderOverviewSection(model, dossier, blueprint) {
  const primarySummary = referenceSummary({ blueprint, dossier });
  const title = referenceTitle(model);
  const scope = dossier.approvalScope ?? {};
  const placement = dossier.systemPlacement ?? {};
  return `<header id="overview" class="architecture-hero">
        <div class="hero-topline">
          <p class="eyebrow">Blueprint Reference</p>
          <span class="status-pill" data-live-blueprint-status>${escapeHtml(model.status.blueprintStatus ?? "unknown")}</span>
        </div>
        <p class="reference-label">Architecture Dossier</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="summary-line">${escapeHtml(primarySummary)}</p>
        <details class="request-disclosure">
          <summary>Original request</summary>
          <p>${escapeHtml(blueprint.request || blueprint.title || model.run.workItemId)}</p>
        </details>
        <div class="overview-brief">
          <p><strong>Review focus:</strong> module placement, public interfaces, contract IO, scenario flow, and acceptance evidence.</p>
          <p><strong>Current phase:</strong> <span data-live-phase>${escapeHtml(model.status.phase ?? "unknown")}</span>. <span data-live-headline>${escapeHtml(model.status.headline ?? "Status unavailable.")}</span></p>
          <p><strong>Next Claude Code action:</strong> <code data-live-next-command>${escapeHtml(model.status.nextCommand ?? model.status.nextAction ?? "none")}</code></p>
        </div>

        <div class="doc-table approval-scope-table" style="margin-top:20px;">
          <div class="doc-row"><div class="doc-key">Authorized Paths</div><div class="doc-value">${(scope.authorizedPaths ?? []).map((ownedPath) => `<code>${escapeHtml(ownedPath)}</code>`).join("") || '<span class="empty">None declared.</span>'}</div></div>
          <div class="doc-row"><div class="doc-key">Required Contracts</div><div class="doc-value">${(scope.requiredContracts ?? []).map((contractId) => `<code>${escapeHtml(contractId)}</code>`).join("") || '<span class="empty">None declared.</span>'}</div></div>
          <div class="doc-row"><div class="doc-key">Required Work Items</div><div class="doc-value">${(scope.requiredWorkItems ?? []).map((id) => `<code>${escapeHtml(id)}</code>`).join("") || '<span class="empty">None declared.</span>'}</div></div>
        </div>

        ${mermaidDiagramCard({
          title: "Architecture Topology",
          description: "Responsibility units and declared contract edges for the software under change.",
          diagram: moduleTopologyMermaid(dossier) ?? systemMapMermaid(dossier)
        })}
        ${mermaidDiagramCard({
          title: "Contract Surface Detail",
          description: "Public surfaces with declared inputs, outputs, and errors per responsibility unit.",
          diagram: systemMapMermaid(dossier)
        })}

        ${renderDesignPatterns(dossier.designPatterns)}
      </header>`;
}
