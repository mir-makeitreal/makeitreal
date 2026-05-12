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

function surfaceSignature(surface) {
  const http = httpSurface(surface);
  if (http) {
    const output = surface.signature.outputs[0].type;
    return `${http.method} ${http.path} -> ${output}`;
  }
  const inputs = surface.signature.inputs;
  const output = surface.signature.outputs[0].type;
  const returnSuffix = output ? `: ${output}` : "";
  if (inputs.length === 0) {
    return `${surface.name}()${returnSuffix}`;
  }
  return `${surface.name}(${inputs.map((input) => input.name).join(", ")})${returnSuffix}`;
}

function referenceTitle(model) {
  const blueprint = model.blueprint ?? {};
  const rawTitle = blueprint.systemDossier?.title ?? blueprint.title ?? model.run.workItemId;
  const primaryModuleName = blueprint.systemDossier?.modules?.[0]?.moduleName;
  if (String(rawTitle).length > 90 && primaryModuleName) {
    return primaryModuleName;
  }
  return conciseTitleFromText(rawTitle) || "Blueprint";
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

function relativeImportPath(ownedPath) {
  const path = String(ownedPath ?? "").trim();
  if (!path) {
    return "./module";
  }
  return path.startsWith(".") ? path : `./${path}`;
}

function sampleValueForType(type) {
  const normalized = String(type ?? "").toLowerCase();
  if (normalized.includes("object") && normalized.includes("method") && normalized.includes("path")) {
    return '{ method: "GET", path: "/health" }';
  }
  if (normalized.includes("object")) {
    return "{}";
  }
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

function safeIdentifier(value, fallback = "result") {
  const words = String(value ?? "")
    .replace(/^[0-9]+[\s._-]*/, "")
    .replace(/[^a-z0-9_$]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return fallback;
  }
  const identifier = words
    .map((word, index) => {
      const normalized = word.replace(/^[^a-z_$]+/i, "");
      if (!normalized) {
        return "";
      }
      return index === 0
        ? `${normalized[0].toLowerCase()}${normalized.slice(1)}`
        : `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
    })
    .join("");
  return /^[A-Za-z_$][\w$]*$/.test(identifier) ? identifier : fallback;
}

function httpSurface(surface) {
  const match = String(surface?.name ?? "").match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/i);
  if (!match) {
    return null;
  }
  return {
    method: match[1].toUpperCase(),
    path: match[2]
  };
}

function declaredRequestBodyFields(surface) {
  const dottedFields = surface.signature.inputs
    .filter((input) => input.name.startsWith("request.body."))
    .map((input) => ({ ...input, name: input.name.replace("request.body.", "") }));
  if (dottedFields.length > 0) {
    return dottedFields;
  }

  const wholeBody = surface.signature.inputs.find((input) => ["requestBody", "body", "payload"].includes(input.name));
  if (wholeBody?.fields?.length > 0) {
    return wholeBody.fields.map((field) => typeof field === "string" ? { name: field, type: "string" } : field);
  }

  throw new Error(`HARNESS_PREVIEW_MODEL_INVALID: ${surface.name} must declare request body fields.`);
}

function requestBodyDeclaration(surface) {
  const body = declaredRequestBodyFields(surface)
    .map((input) => `  ${input.name}: ${sampleValueForInput(input)}`)
    .join(",\n");
  return `const requestBody = {\n${body}\n};\n\n`;
}

function usageSnippet({ moduleInterface, surface }) {
  const http = httpSurface(surface);
  if (http) {
    const outputName = safeIdentifier(surface.signature.outputs[0].name, "responseBody");
    const hasRequestBody = http.method !== "GET" && http.method !== "DELETE";
    const requestBody = hasRequestBody ? requestBodyDeclaration(surface) : "";
    const bodyLine = hasRequestBody ? `,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(requestBody)` : "";
    return `${requestBody}const httpResponse = await fetch("${http.path}", {
  method: "${http.method}"${bodyLine}
});

if (!httpResponse.ok) {
  throw new Error(\`HTTP \${httpResponse.status}\`);
}

const ${outputName} = await httpResponse.json();`;
  }
  const importPath = relativeImportPath(moduleInterface?.owns?.[0]);
  const outputName = safeIdentifier(surface.signature.outputs[0].name, "result");
  const args = surface.signature.inputs
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

function renderFileTreeNode(node = {}) {
  const children = node.children ?? [];
  const marker = node.type === "file" ? "file" : "dir";
  if (children.length === 0) {
    return `<li><span class="file-tree-node ${escapeHtml(marker)}">${escapeHtml(node.name ?? "root")}</span></li>`;
  }
  return `<li>
    <span class="file-tree-node ${escapeHtml(marker)}">${escapeHtml(node.name ?? "root")}</span>
    <ul>${children.map(renderFileTreeNode).join("")}</ul>
  </li>`;
}

function renderFileTree(tree) {
  if (!tree?.name) {
    return '<p class="empty">No owned paths declared.</p>';
  }
  return `<div class="file-tree" role="tree">
    <ul>${renderFileTreeNode(tree)}</ul>
  </div>`;
}

function renderSchemaField(field = {}, role = "field") {
  const meta = [
    field.type,
    field.required === true ? "required" : null,
    field.required === false ? "optional" : null,
    field.when,
    field.handling
  ].filter(Boolean);
  const metaHtml = meta.length > 0 ? `<span>${escapeHtml(meta.join(" · "))}</span>` : "";
  const descriptionHtml = field.description ? `<p>${escapeHtml(field.description)}</p>` : "";
  const detailsHtml = [metaHtml, descriptionHtml].filter(Boolean).join("");
  return `<li>
    <code>${escapeHtml(field.name ?? field.code ?? role)}</code>${detailsHtml ? `
    ${detailsHtml}` : ""}
  </li>`;
}

function renderSchemaSection(title, fields = [], role = "field") {
  return `<section>
    <h4>${escapeHtml(title)}</h4>
    ${fields.length === 0
      ? '<p class="empty">None declared.</p>'
      : `<ul>${fields.map((field) => renderSchemaField(field, role)).join("")}</ul>`}
  </section>`;
}

function renderSchemaDisplay(surface = {}) {
  const signature = surface.signature ?? {};
  return `<article class="schema-display">
    <header>
      <div>
        <p class="eyebrow">${escapeHtml(surface.kind ?? "surface")}</p>
        <h3>${escapeHtml(surface.name)}</h3>
      </div>
      <code>${escapeHtml((surface.contractIds ?? []).join(", ") || "boundary contract")}</code>
    </header>
    <p class="surface-signature"><code>${escapeHtml(surfaceSignature(surface))}</code></p>
    ${surface.description ? `<p class="section-note">${escapeHtml(surface.description)}</p>` : ""}
    <div class="schema-sections">
      ${renderSchemaSection("Inputs", signature.inputs ?? [], "input")}
      ${renderSchemaSection("Outputs", signature.outputs ?? [], "output")}
      ${renderSchemaSection("Errors", signature.errors ?? [], "error")}
    </div>
  </article>`;
}

function renderSourcesList(sources = []) {
  if (sources.length === 0) {
    return '<p class="empty">No source artifacts recorded.</p>';
  }
  return `<ol class="sources-list">
    ${sources.map((source) => `<li>
      <span>${escapeHtml(source.label)}</span>
      <code>${escapeHtml(source.path)}</code>
      <em>${escapeHtml(source.kind)}</em>
    </li>`).join("")}
  </ol>`;
}

function renderTestResults(evidence = []) {
  if (evidence.length === 0) {
    return '<div class="test-results"><p class="empty">No evidence recorded yet.</p></div>';
  }
  return `<div class="test-results">
    ${evidence.map((item) => `<article class="${item.ok === false ? "failed" : "passed"}">
      <strong>${escapeHtml(item.kind ?? "evidence")}</strong>
      <p>${escapeHtml(item.summary ?? "Evidence recorded.")}</p>
      ${item.path ? `<code>${escapeHtml(item.path)}</code>` : ""}
    </article>`).join("")}
  </div>`;
}

function renderWorkflowGraph(scenario = {}) {
  const messages = scenario.messages ?? [];
  if (messages.length === 0) {
    return '<p class="empty">No scenario messages declared.</p>';
  }
  return `<div class="workflow-graph">
    ${messages.map((message, index) => `<div class="workflow-step">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(message.from)} → ${escapeHtml(message.to)}</strong>
      <p>${escapeHtml(message.label)}</p>
    </div>`).join("")}
  </div>`;
}

function scenarioMermaid(scenario = {}) {
  return sequenceMermaid([scenario]);
}

function renderScenarioVisualization(scenario = {}) {
  const mermaid = scenario.visualizationKind === "mermaid" ? scenarioMermaid(scenario) : null;
  if (mermaid) {
    return `${mermaidDiagramCard({
      title: scenario.title,
      description: "Declared software scenario flow.",
      diagram: mermaid
    })}
    <details class="workflow-fallback">
      <summary>Step-by-step flow</summary>
      ${renderWorkflowGraph(scenario)}
    </details>`;
  }
  return renderWorkflowGraph(scenario);
}

function renderScenarioIndex(scenarios = []) {
  if (scenarios.length === 0) {
    return '<p class="empty">No software scenarios declared.</p>';
  }
  return `<div class="scenario-index">
    ${scenarios.map((scenario) => `<a href="#${escapeHtml(anchorSlug(scenario.id, "scenario"))}">
      <strong>${escapeHtml(scenario.title)}</strong>
      <span>${scenario.participantCount} participants · ${scenario.stepCount} steps · ${escapeHtml(scenario.visualizationKind)}</span>
    </a>`).join("")}
  </div>`;
}

function renderScenarioDetails(scenarios = []) {
  if (scenarios.length === 0) {
    return '<p class="empty">No scenario details declared.</p>';
  }
  return `<div class="scenario-reference">
    ${scenarios.map((scenario) => `<article id="${escapeHtml(anchorSlug(scenario.id, "scenario"))}" class="scenario-detail">
      <header>
        <h3>${escapeHtml(scenario.title)}</h3>
        <p>${escapeHtml((scenario.participants ?? []).join(" → "))}</p>
      </header>
      ${renderScenarioVisualization(scenario)}
    </article>`).join("")}
  </div>`;
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
  if (item.handling && !valueKeys.includes("handling")) {
    details.push(`<p>${escapeHtml(item.handling)}</p>`);
  }
  if (item.cases?.length > 0) {
    details.push(`<ul class="signature-cases">${item.cases.map((contractCase) => `<li><code>${escapeHtml(contractCase.input ?? contractCase.name)}</code><span>${escapeHtml(contractCase.output)}</span></li>`).join("")}</ul>`);
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

function renderSurfaceSummary({ moduleInterface, surface }) {
  const inputCount = surface.signature.inputs.length;
  const outputCount = surface.signature.outputs.length;
  const errorCount = surface.signature.errors.length;
  return `<section class="surface-summary">
    <header class="surface-reference-header">
      <div>
        <span class="method neutral">${escapeHtml(surfaceKindLabel(surface))}</span>
        <h4>${escapeHtml(surface.name)}</h4>
        <p class="surface-signature"><code>${escapeHtml(surfaceSignature(surface))}</code></p>
        ${surface.description ? `<p class="muted">${escapeHtml(surface.description)}</p>` : ""}
      </div>
      <div class="contract-chip-list">
        ${(surface.contractIds ?? []).map((contractId) => `<code>${escapeHtml(contractId)}</code>`).join("")}
      </div>
    </header>
    ${renderKeyValueGrid([
      { label: "Parameters", value: String(inputCount) },
      { label: "Returns", value: String(outputCount) },
      { label: "Errors", value: String(errorCount) },
      { label: "Provider", value: moduleInterface.moduleName }
    ])}
    ${(surface.consumers ?? []).length > 0 ? `<p class="muted">Consumers: ${surface.consumers.map((consumer) => escapeHtml(consumer)).join(", ")}</p>` : ""}
  </section>`;
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

function mermaidLabel(value) {
  return String(value ?? "")
    .replaceAll('"', "'")
    .replaceAll("\n", " ")
    .trim() || "Unnamed";
}

function mermaidNodeId(index) {
  return `n${index}`;
}

function mermaidParticipants(messages = []) {
  const labels = [];
  for (const message of messages) {
    for (const side of [message.from, message.to]) {
      const label = mermaidLabel(side);
      if (!labels.includes(label)) {
        labels.push(label);
      }
    }
  }
  return labels;
}

function mermaidDiagramCard({ title, description, diagram }) {
  if (!diagram) {
    return "";
  }
  return `<article class="diagram-card">
    <header>
      <strong>${escapeHtml(title)}</strong>
      ${description ? `<span>${escapeHtml(description)}</span>` : ""}
    </header>
    <pre class="mermaid">${escapeHtml(diagram)}</pre>
    <details class="mermaid-source">
      <summary>Mermaid source</summary>
      ${renderCodeBlock(diagram, "mermaid")}
    </details>
  </article>`;
}

function moduleSurfaces(dossier = {}) {
  return (dossier.modules ?? []).flatMap((moduleInterface, moduleIndex) =>
    (moduleInterface.publicSurfaces ?? []).map((surface, surfaceIndex) => ({
      moduleInterface,
      moduleIndex,
      surface,
      surfaceIndex,
      id: `surface_${moduleIndex}_${surfaceIndex}`
    }))
  );
}

function surfaceDisplayName({ moduleInterface, surface }) {
  return `${moduleInterface.moduleName}: ${surface.name}`;
}

function signatureInputs(surface) {
  return surface.signature?.inputs ?? [];
}

function signatureOutputs(surface) {
  return surface.signature?.outputs ?? [];
}

function signatureErrors(surface) {
  return surface.signature?.errors ?? [];
}

function firstPublicSurface(dossier = {}) {
  return moduleSurfaces(dossier)[0] ?? null;
}

function findSurfaceByImport({ dossier, dependency }) {
  const provider = (dossier.modules ?? []).find((moduleInterface) =>
    moduleInterface.responsibilityUnitId === dependency.providerResponsibilityUnitId
  );
  if (!provider) {
    return null;
  }
  const surface = (provider.publicSurfaces ?? []).find((candidate) =>
    candidate.name === dependency.surface || (candidate.contractIds ?? []).includes(dependency.contractId)
  ) ?? provider.publicSurfaces?.[0];
  if (!surface) {
    return null;
  }
  const surfaceEntry = moduleSurfaces(dossier).find((entry) =>
    entry.moduleInterface.responsibilityUnitId === provider.responsibilityUnitId &&
    entry.surface.name === surface.name
  );
  return surfaceEntry ?? null;
}

function systemMapMermaid(dossier = {}) {
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

function harnessSequence(sequence = {}) {
  const text = [
    ...(sequence.participants ?? []),
    ...(sequence.messages ?? []).flatMap((message) => [message.from, message.to, message.label])
  ].join(" ").toLowerCase();
  return text.includes("make it real")
    || text.includes("implementation responsibility unit")
    || text.includes("request planned work")
    || text.includes("assign work.");
}

function sequenceMermaid(sequences = []) {
  const sequence = sequences[0];
  const messages = sequence?.messages ?? [];
  if (messages.length === 0) {
    return null;
  }
  const participants = mermaidParticipants(messages);
  const participantIds = new Map(participants.map((label, index) => [label, `p${index}`]));
  return [
    "sequenceDiagram",
    ...participants.map((label) => `  participant ${participantIds.get(label)} as ${label}`),
    ...messages.map((message) => `  ${participantIds.get(mermaidLabel(message.from))}->>${participantIds.get(mermaidLabel(message.to))}: ${mermaidLabel(message.label)}`)
  ].join("\n");
}

function derivedSoftwareSequenceMermaid(dossier = {}) {
  const surfaces = moduleSurfaces(dossier);
  if (surfaces.length === 0) {
    return null;
  }

  const importMessages = surfaces.flatMap((entry) =>
    (entry.moduleInterface.imports ?? []).map((dependency) => {
      const provider = findSurfaceByImport({ dossier, dependency });
      return provider ? { entry, dependency, provider } : null;
    }).filter(Boolean)
  );
  if (importMessages.length > 0) {
    const participants = [...new Set(importMessages.flatMap(({ entry, provider }) => [
      entry.moduleInterface.moduleName,
      provider.moduleInterface.moduleName
    ]))];
    const ids = new Map(participants.map((label, index) => [label, `p${index}`]));
    return [
      "sequenceDiagram",
      ...participants.map((label) => `  participant ${ids.get(label)} as ${label}`),
      ...importMessages.flatMap(({ entry, dependency, provider }) => [
        `  ${ids.get(entry.moduleInterface.moduleName)}->>${ids.get(provider.moduleInterface.moduleName)}: ${mermaidLabel(dependency.contractId ?? dependency.surface)}`,
        `  ${ids.get(provider.moduleInterface.moduleName)}-->>${ids.get(entry.moduleInterface.moduleName)}: declared output or error`
      ])
    ].join("\n");
  }

  const primary = surfaces[0];
  const inputLabel = signatureInputs(primary.surface).map((input) => input.name).join(", ") || "input";
  const outputLabel = signatureOutputs(primary.surface).map((output) => output.name).join(", ") || "output";
  const errorLabel = signatureErrors(primary.surface).map((error) => error.code).join(" | ") || "declared error";
  return [
    "sequenceDiagram",
    "  participant caller as Caller",
    `  participant surface as ${mermaidLabel(surfaceDisplayName(primary))}`,
    `  caller->>surface: ${mermaidLabel(inputLabel)}`,
    "  surface->>surface: validate declared input contract",
    "  alt valid contract",
    `    surface-->>caller: ${mermaidLabel(outputLabel)}`,
    "  else declared failure",
    `    surface--x caller: ${mermaidLabel(errorLabel)}`,
    "  end"
  ].join("\n");
}

function softwareSequenceMermaid(dossier = {}) {
  const realSequences = (dossier.signalFlows ?? []).filter((sequence) => !harnessSequence(sequence));
  return sequenceMermaid(realSequences) ?? derivedSoftwareSequenceMermaid(dossier);
}

function stateMermaid(dossier = {}) {
  const primary = firstPublicSurface(dossier);
  if (!primary) {
    return null;
  }
  const inputLabel = signatureInputs(primary.surface).map((input) => input.name).join(", ") || "input";
  const outputLabel = signatureOutputs(primary.surface).map((output) => output.name).join(", ") || "output";
  const errorLabel = signatureErrors(primary.surface).map((error) => error.code).join(" | ");
  const lines = [
    "stateDiagram-v2",
    "  [*] --> InputReceived",
    `  InputReceived --> ContractValid: validate ${mermaidLabel(inputLabel)}`,
    `  ContractValid --> SurfaceExecuted: ${mermaidLabel(primary.surface.name)}`,
    `  SurfaceExecuted --> OutputReturned: ${mermaidLabel(outputLabel)}`,
    "  OutputReturned --> [*]"
  ];
  if (errorLabel) {
    lines.push(`  ContractValid --> DeclaredError: ${mermaidLabel(errorLabel)}`);
    lines.push("  DeclaredError --> [*]");
  }
  return lines.join("\n");
}

function callStackMermaid(callStacks = []) {
  const stack = callStacks[0];
  const calls = stack?.calls ?? [];
  if (calls.length === 0) {
    return null;
  }
  return [
    "flowchart TD",
    `  entry["${mermaidLabel(stack.entrypoint)}"]`,
    ...calls.map((call, index) => {
      const id = `c${index}`;
      const previous = index === 0 ? "entry" : `c${index - 1}`;
      return `  ${previous} --> ${id}["${mermaidLabel(call)}"]`;
    })
  ].join("\n");
}

function renderVisualBlueprint(dossier = {}) {
  const diagrams = [
    mermaidDiagramCard({
      title: "Software Contract Topology",
      description: "Public surfaces, declared inputs, outputs, errors, and cross-module contracts.",
      diagram: systemMapMermaid(dossier)
    }),
    mermaidDiagramCard({
      title: "Runtime Sequence",
      description: "How the software surface is called and what it returns or throws.",
      diagram: softwareSequenceMermaid(dossier)
    }),
    mermaidDiagramCard({
      title: "Surface State Flow",
      description: "The domain execution states for the primary public surface.",
      diagram: stateMermaid(dossier)
    }),
    mermaidDiagramCard({
      title: "Call Stack",
      description: "The declared execution path for the public surface.",
      diagram: callStackMermaid(dossier.callStacks)
    })
  ].filter(Boolean);
  if (diagrams.length === 0) {
    return '<p class="empty">No Mermaid diagrams declared.</p>';
  }
  return `<div class="diagram-grid">${diagrams.join("")}</div>`;
}

function anchorSlug(value, fallback = "item") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

function moduleAnchor(module, index) {
  return `module-${index}-${anchorSlug(module.moduleName ?? module.responsibilityUnitId, "module")}`;
}

function surfaceAnchor(module, surface, moduleIndex, surfaceIndex) {
  return `${moduleAnchor(module, moduleIndex)}-surface-${surfaceIndex}-${anchorSlug(surface.name, "surface")}`;
}

function navSurfaceLinks(module, moduleIndex) {
  const moduleName = String(module.moduleName ?? "").trim().toLowerCase();
  return (module.publicSurfaces ?? [])
    .map((surface, surfaceIndex) => ({ surface, surfaceIndex }))
    .filter(({ surface }) => String(surface.name ?? "").trim().toLowerCase() !== moduleName)
    .map(({ surface, surfaceIndex }) => `<a class="nav-surface" href="#${escapeHtml(surfaceAnchor(module, surface, moduleIndex, surfaceIndex))}">${escapeHtml(surface.name)}</a>`)
    .join("");
}

function renderModuleNav(dossier = {}) {
  const modules = dossier.modules ?? [];
  if (modules.length === 0) {
    return "";
  }
  return `<div class="nav-group">
    <span>Modules</span>
    ${modules.map((module, moduleIndex) => `<a class="nav-module" href="#${escapeHtml(moduleAnchor(module, moduleIndex))}">${escapeHtml(module.moduleName)}</a>
      ${navSurfaceLinks(module, moduleIndex)}`).join("")}
  </div>`;
}

function renderDossierNav(dossier = {}) {
  return `<nav class="architecture-nav" aria-label="Architecture Dossier sections">
    <p class="eyebrow">Make It Real</p>
    <strong>Architecture Dossier</strong>
    <label class="nav-filter">
      <span>Filter reference</span>
      <input type="search" data-nav-filter placeholder="Module, surface, contract">
    </label>
    <a href="#overview" class="active">Overview</a>
    <a href="#system-placement">System Placement</a>
    <a href="#responsibility-map">Responsibility Map</a>
    <a href="#scenario-index">Scenario Index</a>
    <a href="#contract-surfaces">Contract Surfaces</a>
    ${renderModuleNav(dossier)}
    <a href="#scenario-reference">Scenario Reference</a>
    <a href="#review-decisions">Review Decisions</a>
    <a href="#verification-evidence">Verification Evidence</a>
    <a href="#sources">Sources</a>
    <a href="#diagnostics">Diagnostics</a>
  </nav>`;
}

function renderModuleNode(module) {
  return `<article class="module-node">
    <header>
      <span>${escapeHtml(module.responsibilityUnitId)}</span>
      <strong>${escapeHtml(module.moduleName)}</strong>
    </header>
    <p>${escapeHtml(module.purpose ?? "Declared responsibility unit.")}</p>
    <div class="chip-row">
      <span>${escapeHtml(module.owner ?? "owner missing")}</span>
      <span>${(module.publicSurfaces ?? []).length} surface${(module.publicSurfaces ?? []).length === 1 ? "" : "s"}</span>
      <span>${(module.imports ?? []).length} import${(module.imports ?? []).length === 1 ? "" : "s"}</span>
    </div>
  </article>`;
}

function renderSystemMap(dossier = {}) {
  const modules = dossier.modules ?? [];
  if (modules.length === 0) {
    return '<p class="empty">No modules declared.</p>';
  }
  return `<div class="system-map">
    ${modules.map(renderModuleNode).join("")}
  </div>`;
}

function renderDependencyMatrix(edges = []) {
  if (edges.length === 0) {
    return '<p class="empty">No cross-module dependencies declared.</p>';
  }
  return `<div class="dependency-matrix" role="table" aria-label="Dependency graph">
    <div class="matrix-row header" role="row">
      <div role="columnheader">From</div>
      <div role="columnheader">To</div>
      <div role="columnheader">Contract</div>
      <div role="columnheader">Allowed Use</div>
    </div>
    ${edges.map((edge) => `<div class="matrix-row" role="row">
      <div role="cell" data-label="From">${escapeHtml(edge.fromLabel ?? edge.from)}</div>
      <div role="cell" data-label="To">${escapeHtml(edge.toLabel ?? edge.to)}</div>
      <div role="cell" data-label="Contract"><code>${escapeHtml(edge.contractId ?? "none")}</code></div>
      <div role="cell" data-label="Allowed Use">${escapeHtml(edge.allowedUse ?? "")}</div>
    </div>`).join("")}
  </div>`;
}

function renderContractMatrix(rows = []) {
  if (rows.length === 0) {
    return '<p class="empty">No contracts declared.</p>';
  }
  return `<div class="contract-matrix">
    ${rows.map((row) => `<article>
      <header>
        <code>${escapeHtml(row.contractId)}</code>
        <span>${escapeHtml(row.kind ?? "contract")}</span>
      </header>
      <p>${escapeHtml(row.summary)}</p>
      <dl>
        <div><dt>Providers</dt><dd>${escapeHtml((row.providers ?? []).join(", ") || "None declared")}</dd></div>
        <div><dt>Consumers</dt><dd>${escapeHtml((row.consumers ?? []).join(", ") || "None declared")}</dd></div>
        <div><dt>Path</dt><dd>${escapeHtml(row.path ?? "Boundary declaration")}</dd></div>
      </dl>
    </article>`).join("")}
  </div>`;
}

function surfaceKindLabel(surface) {
  const http = httpSurface(surface);
  return http ? `${http.method} ${http.path}` : surface.kind;
}

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

function renderSurfaceReference({ moduleInterface, surface, moduleIndex = 0, surfaceIndex = 0 }) {
  return `<section id="${escapeHtml(surfaceAnchor(moduleInterface, surface, moduleIndex, surfaceIndex))}" class="surface-reference">
    ${renderSurfaceSummary({ moduleInterface, surface })}
    <div class="surface-detail-grid">
      ${renderSignatureTable("Parameters", surface.signature?.inputs ?? [], ["type", "required", "description"])}
      ${renderSignatureTable("Returns", surface.signature?.outputs ?? [], ["type", "description"])}
      ${renderSignatureTable("Errors", surface.signature?.errors ?? [], ["when", "handling"])}
    </div>
    <section class="sdk-example" aria-label="Usage example">
      <div class="sdk-panel-title">
        <span>Usage Example</span>
        <strong>Call only through the declared contract surface</strong>
      </div>
      ${renderCodeBlock(usageSnippet({ moduleInterface, surface }))}
    </section>
  </section>`;
}

function renderModuleReference(modules = []) {
  if (modules.length === 0) {
    return '<p class="empty">No module references declared.</p>';
  }
  return `<div class="module-reference">
    ${renderModuleDirectory(modules)}
    ${modules.map((module, moduleIndex) => `<article id="${escapeHtml(moduleAnchor(module, moduleIndex))}" class="module-reference-card">
      <header>
        <div>
          <p class="module-id">${escapeHtml(module.responsibilityUnitId)}</p>
          <h3>${escapeHtml(module.moduleName)}</h3>
        </div>
        ${module.owner ? `<span>${escapeHtml(module.owner)}</span>` : ""}
      </header>
      <p class="section-note">${escapeHtml(module.purpose ?? "Declared responsibility unit.")}</p>
      ${renderKeyValueGrid([
        { label: "Owned paths", value: (module.owns ?? []).join(", ") || "None declared" },
        { label: "Public surfaces", value: String((module.publicSurfaces ?? []).length) },
        { label: "Imports", value: String((module.imports ?? []).length) }
      ])}
      ${(module.publicSurfaces ?? []).map((surface, surfaceIndex) => renderSurfaceReference({ moduleInterface: module, surface, moduleIndex, surfaceIndex })).join("")}
    </article>`).join("")}
  </div>`;
}

function renderFlowTimeline(dossier = {}) {
  const realSequences = (dossier.signalFlows ?? []).filter((sequence) => !harnessSequence(sequence));
  return `<div class="flow-timeline">
    <section>
      <h3>Signal Flow</h3>
      ${mermaidDiagramCard({
        title: "Runtime Sequence",
        description: "Mermaid sequence diagram generated from software module interfaces.",
        diagram: softwareSequenceMermaid(dossier)
      })}
      ${renderSequences(realSequences)}
    </section>
    <section>
      <h3>Call Stack</h3>
      ${mermaidDiagramCard({
        title: "Call Stack",
        description: "Mermaid call graph generated from declared call stack.",
        diagram: callStackMermaid(dossier.callStacks)
      })}
      ${renderCallStacks(dossier.callStacks)}
    </section>
    <section>
      <h3>Surface State Flow</h3>
      ${mermaidDiagramCard({
        title: "Surface State Flow",
        description: "Mermaid state diagram generated from the primary public surface.",
        diagram: stateMermaid(dossier)
      })}
    </section>
  </div>`;
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

function renderSystemPlacement(dossier = {}) {
  const placement = dossier.systemPlacement ?? {};
  return `<section id="system-placement" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Architecture</p>
        <h2>System Placement</h2>
      </div>
    </div>
    <p class="section-note">${escapeHtml(placement.summary ?? "Declared module placement for this Blueprint.")}</p>
    ${mermaidDiagramCard({
      title: "Module Topology",
      description: "Responsibility units and declared contract edges for the software under change.",
      diagram: systemMapMermaid(dossier)
    })}
    <div class="doc-table architecture-table">
      ${(placement.modules ?? []).map((module) => `<div class="doc-row">
        <div class="doc-key">${escapeHtml(module.moduleName)}</div>
        <div class="doc-value">
          <strong>${escapeHtml(module.responsibilityUnitId)}</strong>
          ${module.owner ? `<span>${escapeHtml(module.owner)}</span>` : ""}
          <p>${escapeHtml(module.purpose ?? "")}</p>
        </div>
      </div>`).join("")}
    </div>
  </section>`;
}

function renderResponsibilityMap(modules = []) {
  if (modules.length === 0) {
    return '<p class="empty">No responsibility boundaries declared.</p>';
  }
  return `<section id="responsibility-map" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Boundaries</p>
        <h2>Responsibility Map</h2>
      </div>
    </div>
    <div class="responsibility-map">
      ${modules.map((module, index) => `<article id="${escapeHtml(moduleAnchor(module, index))}" class="responsibility-unit">
        <header>
          <h3>${escapeHtml(module.moduleName)}</h3>
          <code>${escapeHtml(module.responsibilityUnitId)}</code>
        </header>
        <p>${escapeHtml(module.purpose ?? "Declared responsibility unit.")}</p>
        ${module.owner ? `<p class="section-note">Owner: ${escapeHtml(module.owner)}</p>` : ""}
        ${renderFileTree(module.ownedFileTree)}
        <h4>Public Interfaces</h4>
        <ul class="surface-list">${(module.publicSurfaces ?? []).map((surface, surfaceIndex) =>
          `<li><a href="#${escapeHtml(surfaceAnchor(module, surface, index, surfaceIndex))}">${escapeHtml(surface.name)}</a></li>`
        ).join("")}</ul>
      </article>`).join("")}
    </div>
  </section>`;
}

function renderContractSurfaces(dossier = {}) {
  const modules = dossier.modules ?? [];
  if (modules.length === 0) {
    return '<p class="empty">No contract surfaces declared.</p>';
  }
  return `<section id="contract-surfaces" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Contracts</p>
        <h2>Contract Surfaces</h2>
      </div>
    </div>
    <p class="section-note">Each public surface is shown as an SDK-style schema. Consumers should rely on this contract, not provider implementation details.</p>
    <div class="contract-surface-list">
      ${modules.flatMap((module, moduleIndex) => (module.publicSurfaces ?? []).map((surface, surfaceIndex) =>
        `<article id="${escapeHtml(surfaceAnchor(module, surface, moduleIndex, surfaceIndex))}" class="contract-surface">
          <p class="module-id">${escapeHtml(module.moduleName)} · ${escapeHtml(module.responsibilityUnitId)}</p>
          ${renderSchemaDisplay(surface)}
          <section class="sdk-example" aria-label="Usage example">
            <div class="sdk-panel-title">
              <span>Usage Example</span>
              <strong>Declared surface only</strong>
            </div>
            ${renderCodeBlock(usageSnippet({ moduleInterface: module, surface }))}
          </section>
        </article>`
      )).join("")}
    </div>
  </section>`;
}

function renderReviewDecisions(decisions = []) {
  if (decisions.length === 0) {
    return '<p class="empty">No review decisions derived.</p>';
  }
  return `<section id="review-decisions" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Human Review</p>
        <h2>Review Decisions</h2>
      </div>
    </div>
    <ol class="review-decisions">${decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol>
  </section>`;
}

function renderVerificationEvidence(status = {}) {
  return `<section id="verification-evidence" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Proof</p>
        <h2>Verification Evidence</h2>
      </div>
    </div>
    ${renderTestResults(status.evidenceSummary ?? [])}
  </section>`;
}

function renderSourcesSection(dossier = {}) {
  return `<section id="sources" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Traceability</p>
        <h2>Sources</h2>
      </div>
    </div>
    ${renderSourcesList(dossier.sources ?? [])}
  </section>`;
}

function renderDiagnostics(model, status) {
  return `<section id="diagnostics" class="architecture-section">
    <details class="diagnostics-panel">
      <summary>Diagnostics</summary>
      <p class="section-note">Runtime state and board details are kept here for audit only. The Architecture Dossier above is the primary review surface.</p>
      ${renderDeveloperDiagnostics(model, status)}
      <section>
        <h3>Board State</h3>
        <div data-live-kanban>${renderCompactKanban(model.board)}</div>
      </section>
    </details>
  </section>`;
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

function renderOnThisBlueprint(dossier = {}) {
  const moduleLinks = (dossier.modules ?? []).slice(0, 5).map((module, moduleIndex) =>
    `<a href="#${escapeHtml(moduleAnchor(module, moduleIndex))}">${escapeHtml(module.moduleName)}</a>`
  ).join("");
  return `<section class="rail-section">
    <p class="eyebrow">Reference</p>
    <h2>On This Blueprint</h2>
    <nav class="rail-toc" aria-label="On this Blueprint">
      <a href="#visual-blueprint">Visual Blueprint</a>
      <a href="#system-map">System Map</a>
      <a href="#contracts">Contract Matrix</a>
      <a href="#modules-directory">Module Directory</a>
      ${moduleLinks}
      <a href="#flows">Signal Flow</a>
      <a href="#evidence">Evidence</a>
    </nav>
  </section>`;
}

function renderPrimarySurfaceRail(dossier = {}) {
  const primary = firstPublicSurface(dossier);
  if (!primary) {
    return "";
  }
  return `<section class="rail-section primary-surface-rail">
    <p class="eyebrow">Primary Surface</p>
    <h2>${escapeHtml(primary.surface.name)}</h2>
    <p class="muted">${escapeHtml(primary.moduleInterface.moduleName)}</p>
    <code class="signature-chip">${escapeHtml(surfaceSignature(primary.surface))}</code>
    <details class="rail-code" open>
      <summary>Usage</summary>
      ${renderCodeBlock(usageSnippet(primary))}
    </details>
  </section>`;
}

function renderReferenceRail(model, dossier) {
  return `<aside class="runtime-rail reference-rail" aria-label="Blueprint Reference">
    ${renderOnThisBlueprint(dossier)}
    ${renderPrimarySurfaceRail(dossier)}
    <section class="rail-section runtime-section">
      <p class="eyebrow">Runtime Snapshot</p>
      ${renderOperatorCockpit(model.operatorCockpit, model.board, model.status)}
    </section>
  </aside>`;
}

function publicSurfaceCount(moduleInterfaces = []) {
  return moduleInterfaces.reduce((total, moduleInterface) => total + (moduleInterface.publicSurfaces ?? []).length, 0);
}

function requireSystemDossier(model) {
  if (!model.blueprint || !model.blueprint.systemDossier) {
    throw new Error("HARNESS_PREVIEW_MODEL_INVALID: blueprint.systemDossier is required.");
  }
  return model.blueprint.systemDossier;
}

export function renderDashboardHtml(model) {
  const dossier = requireSystemDossier(model);
  const blueprint = model.blueprint;
  const primarySummary = (blueprint.summary ?? [])[0] ?? "No user-visible behavior recorded.";
  const title = referenceTitle(model);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Make It Real Architecture Dossier - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./preview.css">
</head>
<body>
  <main class="architecture-shell">
    ${renderDossierNav(dossier)}

    <article class="architecture-main">
      <header id="overview" class="architecture-hero">
        <div class="hero-topline">
          <p class="eyebrow">Blueprint Reference</p>
          <span class="status-pill" data-live-blueprint-status>${escapeHtml(model.status.blueprintStatus ?? "unknown")}</span>
        </div>
        <p class="reference-label">Architecture Dossier</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="summary-line">${escapeHtml(primarySummary)}</p>
        <details class="request-disclosure">
          <summary>Original request</summary>
          <p>${escapeHtml(blueprint.title ?? model.run.workItemId)}</p>
        </details>
        <div class="overview-brief">
          <p><strong>Review focus:</strong> module placement, public interfaces, contract IO, scenario flow, and acceptance evidence.</p>
          <p><strong>Current phase:</strong> <span data-live-phase>${escapeHtml(model.status.phase ?? "unknown")}</span>. <span data-live-headline>${escapeHtml(model.status.headline ?? "Status unavailable.")}</span></p>
          <p><strong>Next Claude Code action:</strong> <code data-live-next-command>${escapeHtml(model.status.nextCommand ?? model.status.nextAction ?? "none")}</code></p>
        </div>
      </header>

      ${renderSystemPlacement(dossier)}
      ${renderResponsibilityMap(dossier.modules)}

      <section id="scenario-index" class="architecture-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Flows</p>
            <h2>Scenario Index</h2>
          </div>
        </div>
        <p class="section-note">High-level scenario list for review. Detailed walk-throughs stay in Scenario Reference so large blueprints do not overload the overview.</p>
        ${renderScenarioIndex(dossier.scenarioIndex)}
      </section>

      ${renderContractSurfaces(dossier)}

      <section id="scenario-reference" class="architecture-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Flows</p>
            <h2>Scenario Reference</h2>
          </div>
        </div>
        ${renderScenarioDetails(dossier.scenarioDetails)}
      </section>

      <section id="acceptance" class="architecture-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Acceptance</p>
            <h2>Acceptance Criteria</h2>
          </div>
        </div>
        ${renderAcceptance(blueprint.acceptanceCriteria)}
      </section>

      ${renderReviewDecisions(dossier.reviewDecisions)}
      ${renderVerificationEvidence(model.status)}
      ${renderSourcesSection(dossier)}
      ${renderDiagnostics(model, model.status)}
    </article>
  </main>
  <script src="./preview.js"></script>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({
      startOnLoad: true,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        primaryColor: "#eef4ff",
        primaryTextColor: "#17202a",
        primaryBorderColor: "#b8c7f5",
        lineColor: "#667085",
        fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
      }
    });
  </script>
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
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

.status-pill {
  border: 1px solid #bfd0ff;
  border-radius: 999px;
  max-width: 100%;
  padding: 4px 9px;
  background: var(--accent-soft);
  color: #263ca8;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  overflow-wrap: anywhere;
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

.diagram-grid {
  display: grid;
  gap: 12px;
}

.diagram-card {
  overflow: hidden;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
}

.diagram-card header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--soft-line);
  background: var(--soft);
  padding: 10px 12px;
}

.diagram-card header span {
  color: var(--muted);
  font-size: 12px;
}

.mermaid {
  margin: 0;
  min-height: 140px;
  padding: 16px;
  overflow: auto;
  background: #fbfcff;
  color: var(--ink);
  text-align: center;
}

.mermaid svg {
  max-width: 100%;
  height: auto;
}

.mermaid-source {
  border-top: 1px solid var(--soft-line);
  padding: 8px 12px 12px;
}

.mermaid-source summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.doc-table {
  overflow: hidden;
  max-width: 100%;
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
  min-width: 0;
  padding: 11px 12px;
  overflow-wrap: anywhere;
}

.doc-key {
  background: var(--soft);
  color: #475467;
  font-weight: 700;
}

.doc-value ul {
  margin: 0;
}

.doc-value code,
.artifact-grid code,
.rail-list code {
  overflow-wrap: anywhere;
  white-space: normal;
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
  max-width: 100%;
  min-width: 0;
}

.contract-chip-list code {
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 8px;
  background: var(--panel);
  overflow-wrap: anywhere;
  white-space: normal;
}

.surface-card p,
.signature-row p,
.imports-list p {
  margin: 0;
  color: var(--muted);
}

.signature-cases {
  display: grid;
  gap: 6px;
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.signature-cases li {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(120px, 0.7fr) 1fr;
}

.signature-cases span {
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
  min-width: 0;
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
  min-width: 0;
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

.dossier-shell {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(300px, 340px);
  gap: 16px;
  max-width: 1560px;
  margin: 0 auto;
  padding: 16px;
}

.dossier-nav,
.runtime-rail,
.dossier-hero,
.dossier-section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.dossier-nav,
.runtime-rail {
  position: sticky;
  top: 18px;
  align-self: start;
}

.dossier-nav {
  display: grid;
  gap: 4px;
  max-height: calc(100vh - 36px);
  overflow: auto;
  padding: 14px;
}

.dossier-nav strong {
  margin-bottom: 8px;
  font-size: 15px;
}

.nav-filter {
  display: grid;
  gap: 5px;
  margin: 2px 0 10px;
}

.nav-filter span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.nav-filter input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--soft);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  padding: 8px 9px;
}

.dossier-nav a {
  padding: 8px 10px;
  border-radius: 6px;
  color: #344054;
  font-size: 13px;
}

.dossier-nav a[hidden] {
  display: none;
}

.dossier-nav a.active,
.dossier-nav a:hover {
  background: var(--accent-soft);
  color: #263ca8;
  font-weight: 700;
}

.nav-group {
  display: grid;
  gap: 2px;
  margin: 6px 0;
  border-top: 1px solid var(--soft-line);
  padding-top: 8px;
}

.nav-group > span {
  padding: 4px 10px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.dossier-nav .nav-module {
  font-weight: 700;
}

.dossier-nav .nav-surface {
  padding-left: 20px;
  color: var(--muted);
  font-size: 12px;
}

.dossier-main {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.dossier-hero,
.dossier-section,
.runtime-rail {
  padding: 18px;
}

.dossier-hero,
.dossier-section,
.diagram-card,
.module-directory {
  min-width: 0;
}

.dossier-hero h1 {
  max-width: 980px;
  font-size: clamp(28px, 2.4vw, 36px);
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.system-map {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.module-node,
.module-reference-card,
.contract-matrix article {
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
  padding: 14px;
}

.module-node header,
.module-reference-card header,
.contract-matrix article header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.module-node strong,
.module-reference-card h3,
.contract-matrix code {
  overflow-wrap: anywhere;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.chip-row span {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff;
  padding: 3px 8px;
  color: var(--muted);
  font-size: 12px;
}

.dependency-matrix {
  display: grid;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  overflow: hidden;
}

.matrix-row {
  display: grid;
  grid-template-columns: minmax(120px, .9fr) minmax(120px, .9fr) minmax(190px, 1fr) minmax(220px, 1.4fr);
  border-top: 1px solid var(--soft-line);
}

.matrix-row:first-child {
  border-top: 0;
}

.matrix-row > div {
  min-width: 0;
  padding: 10px;
  overflow-wrap: anywhere;
}

.matrix-row.header {
  background: #f1f4f8;
  color: #344054;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.contract-matrix,
.module-reference,
.flow-timeline {
  display: grid;
  gap: 12px;
}

.module-reference > * {
  min-width: 0;
}

.module-directory {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
}

.module-directory > header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  border-bottom: 1px solid var(--soft-line);
  background: var(--soft);
  padding: 12px 14px;
}

.module-directory h3 {
  margin: 0;
  font-size: 16px;
}

.module-directory > header > span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.module-directory-table {
  display: grid;
}

.module-directory-row {
  display: grid;
  grid-template-columns: minmax(170px, .9fr) minmax(110px, .55fr) minmax(200px, 1.1fr) minmax(220px, 1.2fr);
  gap: 10px;
  align-items: start;
  border-top: 1px solid var(--soft-line);
  padding: 11px 14px;
  color: var(--ink);
}

.module-directory-row:first-child {
  border-top: 0;
}

.module-directory-row.header {
  background: #f1f4f8;
  color: #344054;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.module-directory-row:not(.header):hover {
  background: #fbfcff;
}

.module-directory-row > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.module-directory-row strong {
  flex-basis: 100%;
}

.module-directory-row code {
  border: 1px solid var(--soft-line);
  border-radius: 999px;
  background: var(--soft);
  padding: 2px 7px;
}

.surface-reference {
  display: grid;
  gap: 12px;
}

.surface-reference > *,
.surface-detail-grid > *,
.surface-summary > * {
  min-width: 0;
}

.surface-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.surface-reference-header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.surface-reference-header h4 {
  margin: 8px 0 4px;
  font-size: 19px;
}

.surface-signature {
  margin: 0;
}

.surface-signature code,
.signature-chip {
  display: inline-block;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  padding: 7px 9px;
  color: #344054;
  overflow-wrap: anywhere;
}

.sdk-example {
  overflow: hidden;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
}

.sdk-panel-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--soft-line);
  background: var(--soft);
  padding: 9px 12px;
}

.sdk-panel-title span {
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.sdk-panel-title strong {
  color: #344054;
  font-size: 12px;
}

.sdk-example .code-block {
  margin: 0;
  border: 0;
  border-radius: 0;
}

.contract-matrix dl {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
}

.contract-matrix dl div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px;
}

.contract-matrix dt {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.contract-matrix dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.runtime-rail {
  display: grid;
  gap: 12px;
}

.reference-rail {
  align-content: start;
}

.rail-section {
  display: grid;
  gap: 10px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
  padding: 12px;
}

.rail-section h2 {
  margin: 0;
}

.rail-toc {
  display: grid;
  gap: 4px;
}

.rail-toc a {
  border-radius: 6px;
  color: #344054;
  font-size: 13px;
  padding: 6px 8px;
}

.rail-toc a:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.primary-surface-rail .signature-chip {
  font-size: 12px;
}

.rail-code {
  display: grid;
  gap: 8px;
}

.rail-code summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.rail-code .code-block {
  max-height: 300px;
  margin: 0;
  font-size: 12px;
}

.runtime-section {
  background: var(--panel);
}

.runtime-rail h2 {
  margin: 0;
  font-size: 18px;
}

.runtime-rail .status-rail {
  border: 0;
  background: transparent;
}

.runtime-rail .status-rail > summary {
  cursor: pointer;
  font-weight: 800;
  padding: 0;
}

.runtime-rail .status-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 12px;
  border-top: 0;
}

.runtime-rail .status-grid section {
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
}

.architecture-shell {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 980px);
  gap: 24px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 24px;
}

.architecture-nav,
.architecture-hero,
.architecture-section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.architecture-nav {
  position: sticky;
  top: 24px;
  align-self: start;
  display: grid;
  gap: 4px;
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 14px;
}

.architecture-nav strong {
  margin-bottom: 8px;
  font-size: 15px;
}

.architecture-nav a {
  padding: 8px 10px;
  border-radius: 6px;
  color: #344054;
  font-size: 13px;
}

.architecture-nav a[hidden] {
  display: none;
}

.architecture-nav a.active,
.architecture-nav a:hover {
  background: var(--accent-soft);
  color: #263ca8;
  font-weight: 700;
}

.architecture-main {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.architecture-hero,
.architecture-section {
  padding: 22px;
}

.architecture-hero h1 {
  max-width: 900px;
  font-size: clamp(30px, 3vw, 42px);
  line-height: 1.08;
  overflow-wrap: anywhere;
}

.reference-label {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 800;
}

.overview-brief {
  display: grid;
  gap: 8px;
  margin-top: 18px;
  border-top: 1px solid var(--soft-line);
  padding-top: 14px;
}

.overview-brief p {
  margin: 0;
  color: #344054;
}

.architecture-table {
  margin-top: 14px;
}

.architecture-table .doc-value {
  display: grid;
  gap: 4px;
}

.architecture-table .doc-value p {
  margin: 0;
  color: var(--muted);
}

.responsibility-map,
.contract-surface-list,
.scenario-reference {
  display: grid;
  gap: 14px;
}

.responsibility-unit,
.contract-surface,
.scenario-detail {
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
  padding: 16px;
}

.responsibility-unit header,
.schema-display header,
.scenario-detail header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.responsibility-unit h3,
.schema-display h3,
.scenario-detail h3 {
  margin: 0;
  font-size: 18px;
}

.responsibility-unit h4 {
  margin: 14px 0 8px;
  font-size: 13px;
  color: #344054;
}

.surface-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.surface-list a {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel);
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
}

.file-tree {
  overflow: auto;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
  padding: 10px 12px;
}

.file-tree ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  list-style: none;
}

.file-tree > ul {
  padding-left: 0;
}

.file-tree-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #344054;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

.file-tree-node.dir::before { content: "dir"; color: var(--accent); font-weight: 800; }
.file-tree-node.file::before { content: "file"; color: var(--muted); font-weight: 800; }

.schema-display {
  display: grid;
  gap: 12px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
  padding: 14px;
}

.schema-display header > code {
  max-width: 320px;
  overflow-wrap: anywhere;
  white-space: normal;
}

.schema-sections {
  display: grid;
  gap: 10px;
}

.schema-sections section {
  border-top: 1px solid var(--soft-line);
  padding-top: 10px;
}

.schema-sections h4 {
  margin: 0 0 6px;
  font-size: 13px;
}

.schema-sections ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.schema-sections li {
  display: grid;
  gap: 3px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
  padding: 9px;
}

.schema-sections li span,
.schema-sections li p,
.scenario-detail header p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.scenario-index {
  display: grid;
  gap: 8px;
}

.scenario-index a {
  display: grid;
  gap: 4px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
  padding: 12px;
  color: var(--ink);
}

.scenario-index span {
  color: var(--muted);
  font-size: 12px;
}

.workflow-fallback {
  margin-top: 10px;
}

.workflow-fallback summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.workflow-graph {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.workflow-step {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 8px 12px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
  padding: 10px;
}

.workflow-step span {
  grid-row: span 2;
  color: var(--accent);
  font-weight: 800;
}

.workflow-step p {
  margin: 0;
  color: var(--muted);
}

.review-decisions {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 22px;
}

.review-decisions li {
  padding-left: 4px;
}

.test-results {
  display: grid;
  gap: 8px;
}

.test-results article {
  border: 1px solid var(--soft-line);
  border-left: 4px solid var(--ok);
  border-radius: 8px;
  background: var(--soft);
  padding: 10px 12px;
}

.test-results article.failed {
  border-left-color: var(--bad);
}

.test-results p {
  margin: 3px 0;
  color: var(--muted);
}

.sources-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sources-list li {
  display: grid;
  grid-template-columns: minmax(120px, .5fr) minmax(0, 1fr) minmax(90px, .35fr);
  gap: 10px;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--soft);
  padding: 10px;
}

.sources-list span,
.sources-list em {
  color: var(--muted);
  font-style: normal;
  font-weight: 700;
}

@media (max-width: 1320px) {
  .doc-shell {
    grid-template-columns: 1fr;
  }

  .doc-nav {
    position: static;
  }

  .doc-nav {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dossier-shell {
    grid-template-columns: minmax(210px, 240px) minmax(0, 1fr);
  }

  .runtime-rail {
    grid-column: 2;
    position: static;
  }

  .architecture-shell {
    grid-template-columns: minmax(200px, 240px) minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .doc-shell {
    padding: 12px;
  }

  .doc-nav,
  .dossier-shell,
  .reference-grid,
  .reference-grid.compact,
  .usage-layout,
  .delivery-grid,
  .signature-grid,
  .surface-detail-grid,
  .boundary-grid,
  .status-grid {
    grid-template-columns: 1fr;
  }

  .dossier-shell {
    padding: 10px;
  }

  .dossier-nav,
  .architecture-nav,
  .runtime-rail {
    position: static;
  }

  .architecture-shell {
    grid-template-columns: 1fr;
    padding: 12px;
  }

  .runtime-rail {
    grid-column: auto;
  }

  .doc-row,
  .reference-row,
  .spec-row,
  .module-directory-row,
  .sources-list li,
  .spec-block:nth-child(2) .spec-row,
  .spec-block:nth-child(3) .spec-row,
  .criterion,
  .artifact-grid {
    grid-template-columns: 1fr;
  }

  .section-heading {
    display: grid;
  }

  .surface-reference-header {
    display: grid;
  }

  .contract-chip-list {
    justify-content: flex-start;
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

  .matrix-row {
    grid-template-columns: 1fr;
  }

  .matrix-row.header {
    display: none;
  }

  .matrix-row > div::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 2px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
}
`;
}

export function renderDashboardJs() {
  return `(() => {
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
    const nextCommand = status.nextCommand ?? status.nextAction ?? "";

    setTextAll("[data-live-blueprint-status]", status.blueprintStatus ?? "unknown");
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
      const nextKanbanHtml = renderKanban(model.board);
      if (kanban.innerHTML !== nextKanbanHtml) {
        kanban.innerHTML = nextKanbanHtml;
      }
    }
    const blockers = document.querySelector("[data-live-blockers]");
    if (blockers) {
      const nextBlockersHtml = renderBlockers(status.blockers ?? []);
      if (blockers.innerHTML !== nextBlockersHtml) {
        blockers.innerHTML = nextBlockersHtml;
      }
    }
    const evidenceLinks = document.querySelector("[data-live-evidence-links]");
    if (evidenceLinks) {
      const nextEvidenceHtml = renderEvidenceLinks(model.operatorCockpit?.evidenceLinks ?? []);
      if (evidenceLinks.innerHTML !== nextEvidenceHtml) {
        evidenceLinks.innerHTML = nextEvidenceHtml;
      }
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

  function bindNavFilter() {
    const input = document.querySelector("[data-nav-filter]");
    if (!input || input.dataset.filterBound === "true") {
      return;
    }
    input.dataset.filterBound = "true";
    const links = [...document.querySelectorAll(".architecture-nav a")];
    input.addEventListener("input", () => {
      const needle = input.value.trim().toLowerCase();
      for (const link of links) {
        link.hidden = needle.length > 0 && !link.textContent.toLowerCase().includes(needle);
      }
    });
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
  bindNavFilter();
  checkForDashboardUpdate();
  pollTimer = window.setInterval(checkForDashboardUpdate, pollMs);
  console.info("makeitreal:auto-reload");
})();
`;
}
