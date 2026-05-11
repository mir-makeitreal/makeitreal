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

function humanizeIdentifier(value) {
  return String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function conciseTitleFromText(value) {
  const text = String(value ?? "");
  const functionLike = text.match(/\b([a-z][A-Za-z0-9]+)\s*\(/);
  if (functionLike) {
    return humanizeIdentifier(functionLike[1]);
  }
  const filtered = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => ![
      "a", "an", "and", "or", "the", "with", "for", "to", "of", "in",
      "implement", "create", "build", "add", "update", "pure", "javascript",
      "typescript", "responsibility", "unit", "module", "component", "contract",
      "verification", "command", "input", "output", "test", "tests"
    ].includes(word))
    .slice(0, 5)
    .join(" ");
  return humanizeIdentifier(filtered || text);
}

function primarySurface(blueprint = {}) {
  return blueprint.moduleInterfaces?.[0]?.publicSurfaces?.[0] ?? null;
}

function primaryModule(blueprint = {}) {
  return blueprint.moduleInterfaces?.[0] ?? null;
}

function surfaceSignature(surface) {
  if (!surface?.name) {
    return null;
  }
  const inputs = surface.signature?.inputs ?? [];
  const output = surface.signature?.outputs?.[0]?.type;
  const returnSuffix = output ? `: ${output}` : "";
  if (inputs.length === 0) {
    return `${surface.name}()${returnSuffix}`;
  }
  return `${surface.name}(${inputs.map((input) => input.name ?? "input").join(", ")})${returnSuffix}`;
}

function referenceTitle(model) {
  const blueprint = model.blueprint ?? {};
  const surface = primarySurface(blueprint);
  if (surface?.name && !/^[a-z0-9-]+\.module$/i.test(surface.name)) {
    return humanizeIdentifier(surface.name);
  }
  return conciseTitleFromText(blueprint.title ?? model.run.workItemId);
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

function renderContractReference(contracts = []) {
  if (contracts.length === 0) {
    return '<p class="empty">No public contracts declared.</p>';
  }
  return `<div class="reference-table">${contracts.map((contract) => `<div class="reference-row">
    <div><span class="method ${contract.kind === "none" ? "neutral" : ""}">${escapeHtml(contract.kind ?? "contract")}</span></div>
    <div>
      <strong>${escapeHtml(contract.contractId ?? "Unnamed contract")}</strong>
      <p>${escapeHtml(contract.kind === "none" ? contract.reason ?? "Non-API boundary contract." : "Authoritative machine-readable contract.")}</p>
    </div>
    <code>${escapeHtml(contract.path ?? "Declared by responsibility boundary")}</code>
  </div>`).join("")}</div>`;
}

function relativeImportPath(ownedPath) {
  const path = String(ownedPath ?? "").trim();
  if (!path) {
    return "./module";
  }
  return path.startsWith(".") ? path : `./${path}`;
}

function sampleValueForType(type) {
  const normalized = String(type ?? "").toLowerCase();
  if (normalized.includes("integer")) {
    return "42";
  }
  if (normalized.includes("string | number") || normalized.includes("number | string")) {
    return '"42"';
  }
  if (normalized.includes("string")) {
    return '"value"';
  }
  if (normalized.includes("number")) {
    return "42";
  }
  if (normalized.includes("boolean")) {
    return "true";
  }
  if (normalized.includes("array")) {
    return "[]";
  }
  if (normalized.includes("object")) {
    return "{}";
  }
  return "input";
}

function sampleValueForInput(input) {
  const name = String(input?.name ?? "").toLowerCase();
  if (name.includes("email")) {
    return '"user@example.com"';
  }
  if (name.includes("password")) {
    return '"correct horse battery staple"';
  }
  if (name === "min" || name.endsWith("min")) {
    return "1";
  }
  if (name === "max" || name.endsWith("max")) {
    return "100";
  }
  if (name.includes("count") || name.includes("size") || name.includes("index") || name.includes("offset")) {
    return "42";
  }
  if (name === "input" && String(input?.type ?? "").toLowerCase().includes("string | number")) {
    return '"42"';
  }
  return sampleValueForType(input?.type);
}

function usageSnippet({ moduleInterface, surface }) {
  if (!surface?.name) {
    return "// Public surface not declared yet.";
  }
  const importPath = relativeImportPath(moduleInterface?.owns?.[0]);
  const outputName = surface.signature?.outputs?.[0]?.name ?? "result";
  const args = (surface.signature?.inputs ?? [])
    .map((input) => sampleValueForInput(input))
    .join(", ");
  if (/^[A-Za-z_$][\w$]*$/.test(surface.name)) {
    return `import { ${surface.name} } from "${importPath}";

const ${outputName} = ${surface.name}(${args});`;
  }
  return `// ${surface.name} is the declared public surface owned by ${moduleInterface?.moduleName ?? "this responsibility unit"}.
// Call it only through the Blueprint contract; do not read implementation internals.
const ${outputName} = ${surface.name}(${args});`;
}

function renderCodeBlock(code, language = "js") {
  return `<pre class="code-block" data-language="${escapeHtml(language)}"><code>${escapeHtml(code)}</code></pre>`;
}

function renderKeyValueGrid(items = []) {
  return `<div class="reference-grid compact">${items.map((item) => `<div>
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(item.value)}</strong>
  </div>`).join("")}</div>`;
}

function formatSignatureMeta(item, valueKeys = []) {
  return valueKeys
    .map((key) => {
      if (key === "required" && item[key] === true) {
        return "required";
      }
      if (key === "required" && item[key] === false) {
        return "optional";
      }
      return item[key];
    })
    .filter(Boolean)
    .join(" · ");
}

function renderSignatureRow(item, valueKeys = []) {
  const details = [
    `<strong>${escapeHtml(item.name ?? item.code ?? "item")}</strong>`,
    `<span>${escapeHtml(formatSignatureMeta(item, valueKeys) || item.description || item.when || "")}</span>`
  ];
  if (item.description && !valueKeys.includes("description")) {
    details.push(`<p>${escapeHtml(item.description)}</p>`);
  }
  if (item.handling) {
    details.push(`<p>${escapeHtml(item.handling)}</p>`);
  }
  return `<div class="signature-row">${details.join("")}</div>`;
}

function renderSignatureTable(title, items = [], valueKeys = []) {
  if (items.length === 0) {
    return `<div class="signature-column">
      <h4>${escapeHtml(title)}</h4>
      <p class="empty">None declared.</p>
    </div>`;
  }
  return `<div class="signature-column">
    <h4>${escapeHtml(title)}</h4>
    <div class="signature-table">${items.map((item) => renderSignatureRow(item, valueKeys)).join("")}</div>
  </div>`;
}

function renderSpecTable(title, items = [], columns = []) {
  if (items.length === 0) {
    return `<section class="spec-block">
      <h3>${escapeHtml(title)}</h3>
      <p class="empty">None declared.</p>
    </section>`;
  }
  return `<section class="spec-block">
    <h3>${escapeHtml(title)}</h3>
    <div class="spec-table" role="table" aria-label="${escapeHtml(title)}">
      <div class="spec-row header" role="row">${columns.map((column) => `<div role="columnheader">${escapeHtml(column.label)}</div>`).join("")}</div>
      ${items.map((item) => `<div class="spec-row" role="row">${columns.map((column) => {
        let value = item[column.key];
        if (column.key === "required") {
          value = item.required === true ? "required" : "optional";
        }
        if (column.key === "name" || column.key === "code") {
          return `<div role="cell" data-label="${escapeHtml(column.label)}"><code>${escapeHtml(item.name ?? item.code ?? "item")}</code></div>`;
        }
        return `<div role="cell" data-label="${escapeHtml(column.label)}">${escapeHtml(value ?? "")}</div>`;
      }).join("")}</div>`).join("")}
    </div>
  </section>`;
}

function renderUsageReference({ moduleInterface, surface }) {
  if (!surface) {
    return '<p class="empty">No public surface is available for usage documentation.</p>';
  }
  return `<div class="usage-layout">
    <section class="reference-card">
      <p class="eyebrow">Usage</p>
      <h3>Call The Public Surface</h3>
      ${renderCodeBlock(usageSnippet({ moduleInterface, surface }))}
    </section>
    <section class="reference-card">
      <p class="eyebrow">Signature</p>
      <h3>${escapeHtml(surface.name)}</h3>
      <p class="signature-title"><code>${escapeHtml(surfaceSignature(surface))}</code></p>
      <p>${escapeHtml(surface.description ?? "Use only this declared surface from adjacent responsibility units.")}</p>
      ${renderKeyValueGrid([
        { label: "Kind", value: surface.kind ?? "surface" },
        { label: "Owner", value: moduleInterface?.owner ?? moduleInterface?.responsibilityUnitId ?? "Not assigned" },
        { label: "Contracts", value: (surface.contractIds ?? []).join(", ") || "None declared" },
        { label: "Consumers", value: (surface.consumers ?? []).join(", ") || "None declared" }
      ])}
    </section>
  </div>
  <div class="spec-stack">
    ${renderSpecTable("Parameters", surface.signature?.inputs ?? [], [
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "required", label: "Required" },
      { key: "description", label: "Description" }
    ])}
    ${renderSpecTable("Returns", surface.signature?.outputs ?? [], [
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "description", label: "Description" }
    ])}
    ${renderSpecTable("Errors", surface.signature?.errors ?? [], [
      { key: "code", label: "Code" },
      { key: "when", label: "When" },
      { key: "handling", label: "Handling" }
    ])}
  </div>`;
}

function renderSurfaceSummary({ moduleInterface, surface }) {
  const inputCount = surface.signature?.inputs?.length ?? 0;
  const outputCount = surface.signature?.outputs?.length ?? 0;
  const errorCount = surface.signature?.errors?.length ?? 0;
  return `<section class="surface-summary">
    <div>
      <p class="module-id">${escapeHtml(surface.kind ?? "surface")}</p>
      <h4>${escapeHtml(surface.name)}</h4>
      <p><code>${escapeHtml(surfaceSignature(surface))}</code></p>
      ${surface.description ? `<p class="muted">${escapeHtml(surface.description)}</p>` : ""}
    </div>
    ${renderKeyValueGrid([
      { label: "Parameters", value: String(inputCount) },
      { label: "Returns", value: String(outputCount) },
      { label: "Errors", value: String(errorCount) },
      { label: "Contracts", value: (surface.contractIds ?? []).join(", ") || "None declared" }
    ])}
    ${(surface.consumers ?? []).length > 0 ? `<p class="muted">Consumers: ${surface.consumers.map((consumer) => escapeHtml(consumer)).join(", ")}</p>` : ""}
  </section>`;
}

function renderModuleInterfaces(moduleInterfaces = []) {
  if (moduleInterfaces.length === 0) {
    return '<p class="empty">No module interfaces declared.</p>';
  }
  return `<div class="module-interface-list">${moduleInterfaces.map((moduleInterface) => `<article class="module-interface">
    <header>
      <div>
        <p class="module-id">${escapeHtml(moduleInterface.responsibilityUnitId)}</p>
        <h3>${escapeHtml(moduleInterface.moduleName)}</h3>
      </div>
      ${moduleInterface.owner ? `<span>${escapeHtml(moduleInterface.owner)}</span>` : ""}
    </header>
${moduleInterface.purpose ? `    <p class="section-note">${escapeHtml(moduleInterface.purpose)}</p>` : ""}
    ${renderKeyValueGrid([
      { label: "Owned paths", value: (moduleInterface.owns ?? []).join(", ") || "None declared" },
      { label: "Public surfaces", value: String((moduleInterface.publicSurfaces ?? []).length) },
      { label: "Imports", value: String((moduleInterface.imports ?? []).length) }
    ])}
    ${(moduleInterface.publicSurfaces ?? []).map((surface) => renderSurfaceSummary({ moduleInterface, surface })).join("")}
${(moduleInterface.imports ?? []).length > 0 ? `    <div class="imports-list">
      <h4>Imports</h4>
      ${(moduleInterface.imports ?? []).map((dependency) => `<p><code>${escapeHtml(dependency.contractId)}</code> ${escapeHtml(dependency.allowedUse ?? dependency.surface ?? "")}</p>`).join("")}
    </div>` : ""}
  </article>`).join("")}</div>`;
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
  return `<div class="callstack-list">${callStacks.map((stack) => `<article class="callstack-card">
    <header><code>${escapeHtml(stack.entrypoint)}</code></header>
    <ol>${(stack.calls ?? []).map((call) => `<li>${escapeHtml(call)}</li>`).join("")}</ol>
  </article>`).join("")}</div>`;
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

function renderDelivery(blueprint) {
  return `<div class="delivery-grid">
    <section class="reference-card">
      <h3>Goals</h3>
      ${renderTextList(blueprint.goals)}
    </section>
    <section class="reference-card">
      <h3>Runtime Behavior</h3>
      ${renderTextList(blueprint.summary)}
    </section>
    <section class="reference-card">
      <h3>Out Of Scope</h3>
      ${renderTextList(blueprint.nonGoals)}
    </section>
  </div>`;
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

function renderDeveloperDiagnostics(model, status) {
  return `<details class="diagnostics-panel">
    <summary>Developer Diagnostics</summary>
    <p class="section-note">Canonical files remain available for audit, automation, and zero-context agent handoff. These are diagnostics, not the primary Blueprint review surface.</p>
    <div class="doc-table">
      <div class="doc-row"><div class="doc-key">Current run phase</div><div class="doc-value"><code>${escapeHtml(status.phase ?? "unknown")}</code></div></div>
      <div class="doc-row"><div class="doc-key">Blueprint status</div><div class="doc-value"><code>${escapeHtml(status.blueprintStatus ?? "unknown")}</code></div></div>
      <div class="doc-row"><div class="doc-key">Run directory</div><div class="doc-value"><code>${escapeHtml(model.run.runDir)}</code></div></div>
    </div>
    ${renderRawArtifacts(model)}
  </details>`;
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
  return `<details class="status-rail" data-read-only-cockpit="${cockpit.readOnly ? "true" : "false"}">
    <summary>
      <span>Run Status & Kanban</span>
      <strong>${escapeHtml(status.phase ?? "unknown")}</strong>
    </summary>
    <div class="status-grid">
      <section>
        <p class="rail-label">Current Run</p>
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
    </div>
  </details>`;
}

function publicSurfaceCount(moduleInterfaces = []) {
  return moduleInterfaces.reduce((total, moduleInterface) => total + (moduleInterface.publicSurfaces ?? []).length, 0);
}

export function renderDashboardHtml(model) {
  const blueprint = model.blueprint ?? {};
  const primarySummary = (blueprint.summary ?? [])[0] ?? "No user-visible behavior recorded.";
  const primaryContract = blueprint.primaryContract;
  const surface = primarySurface(blueprint);
  const moduleInterface = primaryModule(blueprint);
  const title = referenceTitle(model);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Make It Real Blueprint - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./preview.css">
</head>
<body>
  <main class="doc-shell">
    <nav class="doc-nav" aria-label="Blueprint sections">
      <p class="eyebrow">Make It Real</p>
      <strong>Blueprint Reference</strong>
      <a href="#overview" class="active">Overview</a>
      <a href="#usage">Usage</a>
      <a href="#contracts">Contracts</a>
      <a href="#interfaces">Interfaces</a>
      <a href="#boundaries">Ownership</a>
      <a href="#flow">Flow</a>
      <a href="#evidence">Verification</a>
    </nav>

    <article class="doc-main">
      <header id="overview" class="hero-panel">
        <div class="hero-topline">
          <p class="eyebrow">Blueprint Reference</p>
          <span class="status-pill">${escapeHtml(model.status.blueprintStatus ?? "unknown")}</span>
        </div>
        <h1>${escapeHtml(title)}</h1>
        ${surfaceSignature(surface) ? `<p class="surface-line"><code>${escapeHtml(surfaceSignature(surface))}</code></p>` : ""}
        <p class="summary-line">${escapeHtml(primarySummary)}</p>
        <details class="request-disclosure">
          <summary>Original request</summary>
          <p>${escapeHtml(blueprint.title ?? model.run.workItemId)}</p>
        </details>
        <div class="reference-grid">
          <div><span>Public Surface</span><strong>${escapeHtml(surface?.name ?? "Not declared")}</strong></div>
          <div><span>Owner</span><strong>${escapeHtml(moduleInterface?.owner ?? moduleInterface?.responsibilityUnitId ?? "Not assigned")}</strong></div>
          <div><span>Contract</span><strong>${escapeHtml(primaryContract?.contractId ?? primaryContract?.kind ?? "none")}</strong></div>
          <div><span>${escapeHtml(verificationTileLabel(model.status))}</span><strong>${escapeHtml(verificationLabel(model.status))}</strong></div>
        </div>
      </header>

      <section id="usage" class="doc-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Reference</p>
            <h2>Usage Contract</h2>
          </div>
          <span>${publicSurfaceCount(blueprint.moduleInterfaces)} public surface${publicSurfaceCount(blueprint.moduleInterfaces) === 1 ? "" : "s"}</span>
        </div>
        ${renderUsageReference({ moduleInterface, surface })}
        <h3>Delivery Scope</h3>
        ${renderDelivery(blueprint)}
      </section>

      <section id="contracts" class="doc-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Boundary</p>
            <h2>Contracts</h2>
          </div>
          <span>${(blueprint.contracts ?? []).length} declared</span>
        </div>
        <p class="section-note">Authoritative API / IO surfaces that other responsibility units must use without reading implementation internals.</p>
        ${renderContractReference(blueprint.contracts)}
      </section>

      <section id="interfaces" class="doc-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Reference</p>
            <h2>Interfaces</h2>
          </div>
          <span>${(blueprint.moduleInterfaces ?? []).length} module${(blueprint.moduleInterfaces ?? []).length === 1 ? "" : "s"}</span>
        </div>
        <p class="section-note">Public surfaces and IO signatures for each responsibility unit. Adjacent teams should be able to work from this section without reading implementation code.</p>
        ${renderModuleInterfaces(blueprint.moduleInterfaces)}
      </section>

      <section id="boundaries" class="doc-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Ownership</p>
            <h2>Responsibility Boundaries</h2>
          </div>
          <span>${(blueprint.boundaries ?? []).length} owner${(blueprint.boundaries ?? []).length === 1 ? "" : "s"}</span>
        </div>
        ${renderBoundaries(blueprint.boundaries)}
      </section>

      <section id="flow" class="doc-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Execution</p>
            <h2>Flow</h2>
          </div>
        </div>
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
        <div class="section-heading">
          <div>
            <p class="eyebrow">Proof</p>
            <h2>Verification</h2>
          </div>
        </div>
        <h3>Acceptance Criteria</h3>
        ${renderAcceptance(blueprint.acceptanceCriteria)}
        <h3>Latest Evidence Summary</h3>
        ${renderEvidenceSummary(model.status.evidenceSummary)}
      </section>

      <section id="diagnostics" class="doc-section">
        ${renderDeveloperDiagnostics(model, model.status)}
      </section>

      <div id="runtime">
        ${renderOperatorCockpit(model.operatorCockpit, model.board, model.status)}
      </div>
    </article>
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
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 22px;
  max-width: 1320px;
  margin: 0 auto;
  padding: 22px;
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
  align-self: start;
}

.doc-nav {
  position: sticky;
  top: 22px;
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
  gap: 16px;
  min-width: 0;
}

.hero-panel,
.doc-section,
.status-rail section {
  padding: 18px;
}

.hero-panel {
  padding: 22px;
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
  max-width: 760px;
  font-size: clamp(30px, 3vw, 38px);
  line-height: 1.08;
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

.surface-line {
  margin: 10px 0 0;
}

.surface-line code {
  display: inline-flex;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--soft);
  padding: 7px 9px;
  color: #344054;
  overflow-wrap: anywhere;
}

.hero-topline {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

.status-pill {
  border: 1px solid #bfd0ff;
  border-radius: 999px;
  padding: 4px 9px;
  background: var(--accent-soft);
  color: #263ca8;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.request-disclosure {
  margin-top: 12px;
  color: var(--muted);
  font-size: 13px;
}

.request-disclosure summary {
  cursor: pointer;
  font-weight: 700;
}

.request-disclosure p {
  margin: 8px 0 0;
  max-width: 920px;
}

.reference-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.reference-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 12px;
}

.reference-grid div,
.reference-card,
.doc-table,
.reference-table,
.boundary-card,
.module-interface,
.surface-card,
.signature-row,
.sequence-card,
.criterion,
.compact-kanban .kanban-lane,
.rail-list > div {
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
}

.reference-grid div {
  padding: 10px;
}

.reference-grid span {
  display: block;
  color: var(--muted);
  font-size: 11px;
}

.reference-grid strong {
  display: block;
  margin-top: 4px;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.section-heading h2 {
  margin-bottom: 0;
}

.section-heading > span {
  border: 1px solid var(--soft-line);
  border-radius: 999px;
  padding: 4px 9px;
  background: var(--soft);
  color: #475467;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.usage-layout,
.delivery-grid {
  display: grid;
  grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
  gap: 12px;
}

.delivery-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 8px;
}

.reference-card {
  padding: 14px;
  background: var(--panel);
}

.reference-card h3 {
  margin-top: 0;
  font-size: 16px;
}

.reference-card > p:last-child {
  margin-bottom: 0;
}

.signature-title {
  margin: 8px 0;
}

.code-block {
  margin: 10px 0 0;
  border: 1px solid #cfd6e4;
  border-radius: 8px;
  background: #101828;
  color: #eef4ff;
  padding: 14px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-block code {
  color: inherit;
  font-size: inherit;
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

.reference-table {
  display: grid;
  overflow: hidden;
  background: var(--panel);
}

.reference-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) minmax(180px, auto);
  gap: 12px;
  align-items: center;
  border-top: 1px solid var(--soft-line);
  padding: 12px;
}

.reference-row:first-child { border-top: 0; }

.reference-row p {
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

.module-interface-list {
  display: grid;
  gap: 14px;
}

.module-interface {
  display: grid;
  gap: 14px;
  padding: 16px;
  background: var(--panel);
}

.module-interface header,
.surface-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.module-interface h3,
.surface-card h4 {
  margin: 0;
  font-size: 17px;
}

.module-interface header span {
  border: 1px solid var(--soft-line);
  border-radius: 999px;
  padding: 3px 8px;
  color: #344054;
  background: var(--soft);
  font-size: 12px;
  font-weight: 700;
}

.module-id {
  margin: 0 0 3px;
  color: var(--muted);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  text-transform: uppercase;
}

.surface-card {
  display: grid;
  gap: 14px;
  padding: 14px;
  background: var(--soft);
}

.surface-summary {
  display: grid;
  gap: 12px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
  padding: 13px;
}

.surface-summary h4 {
  margin: 0 0 6px;
  font-size: 16px;
}

.surface-summary p {
  margin: 0;
}

.contract-chip-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.contract-chip-list code {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 8px;
  background: var(--panel);
}

.surface-card p,
.signature-row p,
.imports-list p {
  margin: 0;
  color: var(--muted);
}

.signature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.spec-stack {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}

.spec-block h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.spec-table {
  overflow: hidden;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
}

.spec-row {
  display: grid;
  grid-template-columns: minmax(130px, .75fr) minmax(90px, .55fr) minmax(110px, .65fr) minmax(220px, 1.7fr);
  border-top: 1px solid var(--soft-line);
}

.spec-row:first-child {
  border-top: 0;
}

.spec-row.header {
  background: #f2f4f7;
  color: #475467;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.spec-row > div {
  min-width: 0;
  padding: 9px 10px;
  overflow-wrap: anywhere;
}

.spec-block:nth-child(2) .spec-row {
  grid-template-columns: minmax(130px, .8fr) minmax(90px, .6fr) minmax(220px, 1.8fr);
}

.spec-block:nth-child(3) .spec-row {
  grid-template-columns: minmax(180px, .8fr) minmax(240px, 1.1fr) minmax(280px, 1.4fr);
}

.signature-column h4,
.imports-list h4 {
  margin: 0 0 6px;
  color: #344054;
  font-size: 12px;
}

.signature-table {
  display: grid;
  gap: 6px;
}

.signature-row {
  display: grid;
  gap: 3px;
  padding: 9px;
  background: var(--panel);
}

.signature-row span {
  color: var(--muted);
  font-size: 12px;
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

.callstack-list {
  display: grid;
  gap: 10px;
}

.callstack-card {
  overflow: hidden;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
}

.callstack-card header {
  border-bottom: 1px solid var(--soft-line);
  background: var(--soft);
  padding: 10px 12px;
}

.callstack-card ol {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: callstep;
}

.callstack-card li {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  border-top: 1px solid var(--soft-line);
  padding: 10px 12px;
  counter-increment: callstep;
}

.callstack-card li:first-child {
  border-top: 0;
}

.callstack-card li::before {
  content: counter(callstep);
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
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
  display: block;
  overflow: hidden;
}

.status-rail summary {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 14px 18px;
  cursor: pointer;
  font-weight: 800;
}

.status-rail summary strong {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--soft-line);
}

.status-grid section {
  border-top: 1px solid var(--soft-line);
  border-left: 1px solid var(--soft-line);
}

.status-grid section:nth-child(1),
.status-grid section:nth-child(2) {
  border-top: 0;
}

.status-grid section:nth-child(odd) {
  border-left: 0;
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

.diagnostics-panel summary {
  cursor: pointer;
  font-weight: 800;
  font-size: 20px;
}

.diagnostics-panel .doc-table {
  margin: 12px 0;
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

  .doc-nav {
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
  .reference-grid,
  .reference-grid.compact,
  .usage-layout,
  .delivery-grid,
  .signature-grid,
  .boundary-grid,
  .status-grid {
    grid-template-columns: 1fr;
  }

  .doc-row,
  .reference-row,
  .spec-row,
  .spec-block:nth-child(2) .spec-row,
  .spec-block:nth-child(3) .spec-row,
  .criterion,
  .artifact-grid {
    grid-template-columns: 1fr;
  }

  .section-heading {
    display: grid;
  }

  .spec-row.header {
    display: none;
  }

  .spec-row {
    gap: 8px;
    padding: 10px;
  }

  .spec-row > div {
    padding: 0;
  }

  .spec-row > div::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 2px;
    color: #667085;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .04em;
    text-transform: uppercase;
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
