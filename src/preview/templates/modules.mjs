// Modules section template for Architecture Dossier.
// Pure refactor — extracted from render-dashboard-html.mjs.

import {
  escapeHtml,
  renderCodeBlock,
  renderFileTree,
  renderSchemaDisplay,
  renderSurfaceSummary,
  renderSignatureTable,
  renderCodeList,
  renderTextChips,
  usageSnippet,
  moduleAnchor,
  surfaceAnchor,
} from "./shared.mjs";

function renderModuleDirectory(modules = []) {
  if (modules.length === 0) {
    return "";
  }
  return `<section id="modules-directory" class="module-directory" aria-label="Module directory">
    <header>
      <div>
        <p class="eyebrow">Reference Index</p>
        <h3>Module Directory</h3>
      </div>
      <span>${modules.length} module${modules.length === 1 ? "" : "s"}</span>
    </header>
    <div class="module-directory-table" role="table" aria-label="Module directory">
      <div class="module-directory-row header" role="row">
        <div role="columnheader">Module</div>
        <div role="columnheader">Owner</div>
        <div role="columnheader">Public Surfaces</div>
        <div role="columnheader">Owned Paths</div>
      </div>
      ${modules.map((module, moduleIndex) => `<a class="module-directory-row" role="row" href="#${escapeHtml(moduleAnchor(module, moduleIndex))}">
        <div role="cell" data-label="Module"><strong>${escapeHtml(module.moduleName)}</strong><code>${escapeHtml(module.responsibilityUnitId)}</code></div>
        <div role="cell" data-label="Owner">${escapeHtml(module.owner ?? "owner missing")}</div>
        <div role="cell" data-label="Public Surfaces">${(module.publicSurfaces ?? []).map((surface) => `<code>${escapeHtml(surface.name)}</code>`).join("")}</div>
        <div role="cell" data-label="Owned Paths">${(module.owns ?? []).map((ownedPath) => `<code>${escapeHtml(ownedPath)}</code>`).join("")}</div>
      </a>`).join("")}
    </div>
  </section>`;
}

function renderModuleSdkSection(module, moduleIndex, dossier) {
  const surfaces = module.publicSurfaces ?? [];
  const traces = dossier.surfaceTraceReference ?? [];
  return `<article id="${escapeHtml(moduleAnchor(module, moduleIndex))}" class="module-reference-card">
    <header>
      <div>
        <p class="module-id">${escapeHtml(module.responsibilityUnitId)}</p>
        <h3>${escapeHtml(module.moduleName)}</h3>
      </div>
      ${module.owner ? `<span>${escapeHtml(module.owner)}</span>` : ""}
    </header>
    <p class="section-note">${escapeHtml(module.purpose ?? "Declared responsibility unit.")}</p>

    ${renderFileTree(module.ownedFileTree)}

    ${surfaces.map((surface, surfaceIndex) => {
      const surfaceTrace = traces.find((t) => t.moduleName === module.moduleName && t.surfaceName === surface.name);
      const traceHtml = surfaceTrace ? `<div class="doc-table compact-doc-table" style="margin-top:10px;">
        ${surfaceTrace.consumers.length > 0 ? `<div class="doc-row"><div class="doc-key">Consumers</div><div class="doc-value">${renderTextChips(surfaceTrace.consumers)}</div></div>` : ""}
        ${surfaceTrace.callStacks.length > 0 ? `<div class="doc-row"><div class="doc-key">Call Stacks</div><div class="doc-value">${renderCodeList(surfaceTrace.callStacks)}</div></div>` : ""}
        ${surfaceTrace.scenarios.length > 0 ? `<div class="doc-row"><div class="doc-key">Scenarios</div><div class="doc-value">${renderTextChips(surfaceTrace.scenarios)}</div></div>` : ""}
      </div>` : "";
      return `<section id="${escapeHtml(surfaceAnchor(module, surface, moduleIndex, surfaceIndex))}" class="surface-reference">
        ${renderSurfaceSummary({ moduleInterface: module, surface })}
        ${renderSchemaDisplay(surface)}
        <div class="surface-detail-grid">
          ${renderSignatureTable("Parameters", surface.signature?.inputs ?? [], ["type", "required", "description"])}
          ${renderSignatureTable("Returns", surface.signature?.outputs ?? [], ["type", "description"])}
          ${renderSignatureTable("Errors", surface.signature?.errors ?? [], ["when", "handling"])}
        </div>
        ${traceHtml}
        <section class="sdk-example" aria-label="Usage example">
          <div class="sdk-panel-title">
            <span>Usage Example</span>
            <strong>Call only through the declared contract surface</strong>
          </div>
          ${renderCodeBlock(usageSnippet({ moduleInterface: module, surface }))}
        </section>
      </section>`;
    }).join("")}

    <p class="section-note" style="color: var(--muted); font-size: 12px; margin-top: 8px;">Boundary enforcement: edits outside these paths are blocked by the PreToolUse hook during implementation.</p>
  </article>`;
}

export function renderModulesSection(dossier = {}) {
  const modules = dossier.modules ?? [];
  if (modules.length === 0) {
    return `<section id="modules" class="architecture-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">SDK Reference</p>
          <h2>Modules</h2>
        </div>
      </div>
      <p class="empty">No modules declared.</p>
    </section>`;
  }
  return `<section id="modules" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">SDK Reference</p>
        <h2>Modules</h2>
      </div>
      <span>${modules.length} module${modules.length === 1 ? "" : "s"}</span>
    </div>
    <p class="section-note">Each module shows its owned paths, all public surfaces with full contract schemas, usage examples, and boundary enforcement. Consumers should rely on these contracts, not implementation details.</p>
    ${renderModuleDirectory(modules)}
    <div class="module-reference">
      ${modules.map((module, moduleIndex) => renderModuleSdkSection(module, moduleIndex, dossier)).join("")}
    </div>
  </section>`;
}
