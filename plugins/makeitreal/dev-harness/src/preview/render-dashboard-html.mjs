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

function renderAcceptance(criteria = [], workItems = []) {
  if (criteria.length === 0) {
    return '<p class="empty">No acceptance criteria recorded.</p>';
  }
  const acToWorkItems = new Map();
  for (const workItem of workItems) {
    const tracedAcIds = workItem.prdTrace?.acceptanceCriteriaIds ?? [];
    for (const acId of tracedAcIds) {
      const current = acToWorkItems.get(acId) ?? [];
      current.push(workItem);
      acToWorkItems.set(acId, current);
    }
  }
  const allVerificationCommands = workItems.flatMap((workItem) => (workItem.verificationCommands ?? []).map((cmd) => ({ cmd, workItemId: workItem.id })));
  return `<div class="criteria-list">${criteria.map((criterion) => {
    const acId = criterion.id ?? "AC";
    const linked = acToWorkItems.get(acId) ?? [];
    const linkedCommands = linked.flatMap((workItem) => (workItem.verificationCommands ?? []).map((cmd) => ({ cmd, workItemId: workItem.id })));
    const verificationHtml = linkedCommands.length > 0
      ? `<div class="ac-verification" style="margin-top:6px;padding:6px 10px;background:var(--surface-raised, #161b22);border-radius:var(--radius-sm, 6px);border-left:3px solid var(--ok, #3fb950);">
          <span style="font-size:11px;color:var(--muted, #7d8590);font-weight:600;">Verification</span>
          ${linkedCommands.map((entry) => `<div style="margin-top:2px;"><code style="font-size:12px;">${escapeHtml(entry.cmd)}</code> <span style="font-size:11px;color:var(--muted, #7d8590);">(${escapeHtml(entry.workItemId)})</span></div>`).join("")}
        </div>`
      : allVerificationCommands.length > 0
        ? `<div class="ac-verification" style="margin-top:6px;padding:6px 10px;background:var(--surface-raised, #161b22);border-radius:var(--radius-sm, 6px);border:1px dashed var(--warn, #d29922);">
          <span style="font-size:11px;color:var(--warn, #d29922);font-weight:600;">Unlinked — general verification only</span>
          ${allVerificationCommands.map((entry) => `<div style="margin-top:2px;"><code style="font-size:12px;">${escapeHtml(entry.cmd)}</code> <span style="font-size:11px;color:var(--muted, #7d8590);">(${escapeHtml(entry.workItemId)})</span></div>`).join("")}
        </div>`
        : "";
    return `<div class="criterion">
    <strong>${escapeHtml(acId)}</strong>
    <span>${escapeHtml(criterion.statement ?? criterion)}</span>
    ${verificationHtml}
  </div>`;
  }).join("")}</div>`;
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

function conciseTitleFromText(value, { preferFunction = true } = {}) {
  const text = String(value ?? "");
  const functionLike = preferFunction ? text.match(/\b([a-z][A-Za-z0-9]+)\s*\(/) : null;
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
      "typescript", "responsibility", "unit", "units", "module", "component", "contract",
      "verification", "command", "input", "output", "test", "tests"
    ].includes(word))
    .slice(0, 5)
    .join(" ");
  return humanizeIdentifier(filtered || text);
}

function nonExternalModules(modules = []) {
  return modules.filter((moduleInterface) => moduleInterface.owner !== "external.provider");
}

function titleIntroBeforeUnitSections(value) {
  return String(value ?? "")
    .split(/\bUnit\s+\d+\b/i)[0]
    .trim();
}

function countLabel(count) {
  return new Map([
    [1, "One"],
    [2, "Two"],
    [3, "Three"],
    [4, "Four"],
    [5, "Five"]
  ]).get(count) ?? String(count);
}

function architecturePacketTitle({ rawTitle, modules, dependencyEdges = [] }) {
  const implementationModules = nonExternalModules(modules);
  if (implementationModules.length === 1 && modules.length > 1) {
    return implementationModules[0].moduleName;
  }

  if (dependencyEdges.length === 0) {
    return `${countLabel(modules.length)} Independent Responsibility Units`;
  }

  const introTitle = conciseTitleFromText(titleIntroBeforeUnitSections(rawTitle), { preferFunction: false });
  if (introTitle) {
    return introTitle;
  }
  return `${modules.length} Responsibility Units`;
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
  const dossier = blueprint.systemDossier ?? {};
  const rawTitle = dossier.title ?? blueprint.title ?? model.run.workItemId;
  const modules = dossier.modules ?? [];
  if (modules.length > 1) {
    return architecturePacketTitle({ rawTitle, modules, dependencyEdges: dossier.dependencyEdges ?? [] });
  }
  return conciseTitleFromText(rawTitle) || "Blueprint";
}

function referenceSummary({ blueprint, dossier }) {
  const modules = dossier.modules ?? [];
  if (modules.length > 1) {
    const moduleNames = modules.map((moduleInterface) => moduleInterface.moduleName).filter(Boolean).join(", ");
    const contractCount = new Set((dossier.contractSurfaces ?? []).flatMap((surface) => surface.contractIds ?? [])).size;
    const contractLabel = contractCount === 1 ? "1 contract" : `${contractCount} contracts`;
    return `${modules.length} responsibility units: ${moduleNames}. Review module placement, public signatures, ${contractLabel}, and Done evidence as one architecture packet.`;
  }
  return (blueprint.summary ?? [])[0] ?? "No user-visible behavior recorded.";
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
  const concretePath = path.includes("*") ? path.replace(/\/?\*\*?.*$/, "") || path : path;
  return concretePath.startsWith(".") ? concretePath : `./${concretePath}`;
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

  return [];
}

function requestBodyDeclaration(surface) {
  const fields = declaredRequestBodyFields(surface);
  if (fields.length === 0) {
    return `/* ⚠ No request body fields declared for ${surface.name} */\nconst requestBody = {};\n\n`;
  }
  const body = fields
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
  const importComment = String(moduleInterface?.owns?.[0] ?? "").includes("*")
    ? `// TODO: resolve this import path after implementation\n`
    : "";
  const outputName = safeIdentifier(surface.signature.outputs[0].name, "result");
  const args = surface.signature.inputs
    .map((input) => sampleValueForInput(input))
    .join(", ");
  if (/^[A-Za-z_$][\w$]*$/.test(surface.name)) {
    return `${importComment}import { ${surface.name} } from "${importPath}";

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

function typeBadgeHtml(type) {
  const normalized = String(type ?? "").toLowerCase();
  const knownTypes = ["string", "number", "boolean", "object", "array", "integer"];
  const matched = knownTypes.find((known) => normalized.includes(known));
  if (!matched) {
    return "";
  }
  return `<span class="type-badge" style="display:inline-block;background:#1c6b50;color:#e6edf3;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;margin-right:6px;">${escapeHtml(matched)}</span>`;
}

function constraintNoteHtml(description) {
  if (!description) {
    return "";
  }
  const constraintPatterns = [/\bmust be\b/i, /\bminimum\b/i, /\bmaximum\b/i, /\bpattern\b/i, /\bone of\b/i, /\bmin\b/i, /\bmax\b/i, /\bat least\b/i, /\bat most\b/i, /\brequired when\b/i];
  const hasConstraint = constraintPatterns.some((pattern) => pattern.test(description));
  if (!hasConstraint) {
    return "";
  }
  return `<p class="constraint-note" style="margin:2px 0 0;font-size:11px;color:var(--warn);font-style:italic;">⚠ Constraint: ${escapeHtml(description)}</p>`;
}

function renderSchemaField(field = {}, role = "field") {
  const errorCode = String(field.code ?? "");
  const httpStatusMatch = role === "error" ? errorCode.match(/^(\d{3})\./) : null;
  const httpBadge = httpStatusMatch ? `<span class="http-status-badge" style="display:inline-block;background:var(--bad);color:#fff;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;margin-right:6px;">${httpStatusMatch[1]}</span>` : "";
  const typed = typeBadgeHtml(field.type);
  const meta = [
    field.type,
    field.required === true ? "required" : null,
    field.required === false ? "optional" : null,
    field.when,
    field.handling
  ].filter(Boolean);
  const metaHtml = meta.length > 0 ? `<span>${escapeHtml(meta.join(" · "))}</span>` : "";
  const descriptionHtml = field.description ? `<p>${escapeHtml(field.description)}</p>` : "";
  const constraint = constraintNoteHtml(field.description);
  const detailsHtml = [metaHtml, descriptionHtml, constraint].filter(Boolean).join("");
  return `<li>
    ${httpBadge}${typed}<code>${escapeHtml(field.name ?? field.code ?? role)}</code>${detailsHtml ? `
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
    ${(surface.consumers ?? []).length > 0 ? `<p class="muted">Consumers: ${surface.consumers.map((consumer) => escapeHtml(consumer)).join(", ")}</p>` : '<p class="consumer-warning" style="color: var(--warn);">No declared consumers — verify this is intentional</p>'}
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

function moduleTopologyMermaid(dossier = {}) {
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

function taskLaneClass(lane = "") {
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

function taskDagMermaid(dossier = {}) {
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

  return [
    "sequenceDiagram",
    "  participant caller as Caller",
    ...surfaces.map((entry) => `  participant ${entry.id} as ${mermaidLabel(surfaceDisplayName(entry))}`),
    ...surfaces.flatMap((entry) => {
      const inputLabel = signatureInputs(entry.surface).map((input) => input.name).join(", ") || "input";
      const outputLabel = signatureOutputs(entry.surface).map((output) => output.name).join(", ") || "output";
      const errorLabel = signatureErrors(entry.surface).map((error) => error.code).join(" | ") || "declared error";
      return [
        `  caller->>${entry.id}: ${mermaidLabel(inputLabel)}`,
        `  ${entry.id}->>${entry.id}: validate ${mermaidLabel(entry.surface.name)} contract`,
        "  alt valid contract",
        `    ${entry.id}-->>caller: ${mermaidLabel(outputLabel)}`,
        "  else declared failure",
        `    ${entry.id}--x caller: ${mermaidLabel(errorLabel)}`,
        "  end"
      ];
    })
  ].join("\n");
}

function softwareSequenceMermaid(dossier = {}) {
  const realSequences = (dossier.signalFlows ?? []).filter((sequence) => !harnessSequence(sequence));
  return sequenceMermaid(realSequences) ?? derivedSoftwareSequenceMermaid(dossier);
}

function stateMermaidForSurface(entry = {}) {
  if (!entry.surface) {
    return null;
  }
  const inputLabel = signatureInputs(entry.surface).map((input) => input.name).join(", ") || "input";
  const outputLabel = signatureOutputs(entry.surface).map((output) => output.name).join(", ") || "output";
  const errorLabel = signatureErrors(entry.surface).map((error) => error.code).join(" | ");
  const lines = [
    "stateDiagram-v2",
    "  [*] --> InputReceived",
    `  InputReceived --> ContractValid: validate ${mermaidLabel(inputLabel)}`,
    `  ContractValid --> SurfaceExecuted: ${mermaidLabel(entry.surface.name)}`,
    `  SurfaceExecuted --> OutputReturned: ${mermaidLabel(outputLabel)}`,
    "  OutputReturned --> [*]"
  ];
  if (errorLabel) {
    lines.push(`  ContractValid --> DeclaredError: ${mermaidLabel(errorLabel)}`);
    lines.push("  DeclaredError --> [*]");
  }
  return lines.join("\n");
}

function stateDiagramCards(dossier = {}) {
  const surfaces = moduleSurfaces(dossier);
  if (surfaces.length === 0) {
    return [];
  }
  return surfaces.map((entry) => mermaidDiagramCard({
    title: `${entry.surface.name} State Flow`,
    description: `Declared execution states for ${surfaceDisplayName(entry)}.`,
    diagram: stateMermaidForSurface(entry)
  })).filter(Boolean);
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
    ...stateDiagramCards(dossier),
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
  const isEmpty = (key) => {
    if (key === "approval-scope") return !(dossier.approvalScope);
    if (key === "system-placement") return !(dossier.systemPlacement);
    if (key === "task-dag") return (dossier.taskDag?.nodes ?? []).length === 0;
    if (key === "worker-topology") return (dossier.workerTopology?.assignments ?? []).length === 0;
    if (key === "responsibility-map") return (dossier.modules ?? []).length === 0;
    if (key === "scenario-index") return (dossier.scenarioIndex ?? []).length === 0;
    if (key === "contract-surfaces") return (dossier.modules ?? []).length === 0;
    if (key === "surface-trace-reference") return (dossier.surfaceTraceReference ?? []).length === 0;
    if (key === "scenario-reference") return (dossier.scenarioDetails ?? []).length === 0 && (dossier.signalFlows ?? []).length === 0;
    if (key === "review-decisions") return (dossier.reviewDecisions ?? []).length === 0;
    if (key === "sources") return (dossier.sources ?? []).length === 0;
    return false;
  };
  const navCls = (key) => isEmpty(key) ? ' class="nav-empty"' : '';
  return `<nav class="architecture-nav" aria-label="Architecture Dossier sections">
    <p class="eyebrow">Make It Real</p>
    <strong>Architecture Dossier</strong>
    <label class="nav-filter">
      <span>Filter reference</span>
      <input type="search" data-nav-filter placeholder="Module, surface, contract">
    </label>
    <a href="#overview" class="active">Overview</a>
    <a href="#approval-scope"${navCls("approval-scope")}>Approval Scope</a>
    <a href="#system-placement"${navCls("system-placement")}>System Placement</a>
    <a href="#task-dag"${navCls("task-dag")}>Task DAG</a>
    <a href="#worker-topology"${navCls("worker-topology")}>Worker Topology</a>
    <a href="#responsibility-map"${navCls("responsibility-map")}>Responsibility Map</a>
    <a href="#scenario-index"${navCls("scenario-index")}>Scenario Index</a>
    <a href="#contract-surfaces"${navCls("contract-surfaces")}>Contract Surfaces</a>
    <a href="#surface-trace-reference"${navCls("surface-trace-reference")}>Surface Trace Reference</a>
    ${renderModuleNav(dossier)}
    <a href="#scenario-reference"${navCls("scenario-reference")}>Scenario Reference</a>
    <a href="#review-decisions"${navCls("review-decisions")}>Review Decisions</a>
    <a href="#verification-evidence">Verification Evidence</a>
    <a href="#sources"${navCls("sources")}>Sources</a>
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
        <div><dt>Consumers</dt><dd>${(row.consumers ?? []).length === 0 ? '<span class="consumer-warning" style="color: var(--warn);">No declared consumers — verify this is intentional</span>' : escapeHtml(row.consumers.join(", "))}</dd></div>
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
      <div class="diagram-grid">
        ${stateDiagramCards(dossier).join("") || '<p class="empty">No surface state flows declared.</p>'}
      </div>
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
      diagram: moduleTopologyMermaid(dossier) ?? systemMapMermaid(dossier)
    })}
    ${mermaidDiagramCard({
      title: "Contract Surface Detail",
      description: "Public surfaces with declared inputs, outputs, and errors per responsibility unit.",
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

function renderApprovalScope(dossier = {}) {
  const scope = dossier.approvalScope ?? {};
  return `<section id="approval-scope" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Approval Packet</p>
        <h2>Approval Scope</h2>
      </div>
    </div>
    <p class="section-note">Approve this Blueprint only if these paths, contracts, and required work items match the intended software change.</p>
    <div class="doc-table approval-scope-table">
      <div class="doc-row"><div class="doc-key">Required Work Items</div><div class="doc-value">${(scope.requiredWorkItems ?? []).map((id) => `<code>${escapeHtml(id)}</code>`).join("") || '<span class="empty">None declared.</span>'}</div></div>
      <div class="doc-row"><div class="doc-key">Authorized Paths</div><div class="doc-value">${(scope.authorizedPaths ?? []).map((ownedPath) => `<code>${escapeHtml(ownedPath)}</code>`).join("") || '<span class="empty">None declared.</span>'}</div></div>
      <div class="doc-row"><div class="doc-key">Required Contracts</div><div class="doc-value">${(scope.requiredContracts ?? []).map((contractId) => `<code>${escapeHtml(contractId)}</code>`).join("") || '<span class="empty">None declared.</span>'}</div></div>
      <div class="doc-row"><div class="doc-key">Blueprint Fingerprint</div><div class="doc-value"><code>${escapeHtml(scope.blueprintFingerprint ?? "pending review seed")}</code></div></div>
    </div>
  </section>`;
}

function renderTaskDag(dossier = {}) {
  const taskDag = dossier.taskDag ?? {};
  const nodes = taskDag.nodes ?? [];
  return `<section id="task-dag" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Execution Graph</p>
        <h2>Task DAG</h2>
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
  </section>`;
}

function renderWorkerTopology(dossier = {}) {
  const topology = dossier.workerTopology ?? {};
  const assignments = topology.assignments ?? [];
  return `<section id="worker-topology" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Native Agents</p>
        <h2>Worker Topology</h2>
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
    <p class="section-note">Review roles: ${(topology.reviewRoles ?? []).map((role) => `<code>${escapeHtml(role)}</code>`).join(" ")}</p>
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
        <p class="section-note" style="color: var(--muted); font-size: 12px; margin-top: 8px;">Boundary enforcement: edits outside these paths are blocked by the PreToolUse hook during implementation.</p>
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

function renderCodeList(values = [], emptyText = "None declared.") {
  const uniqueValues = [...new Set((values ?? []).filter(Boolean))];
  if (uniqueValues.length === 0) {
    return `<span class="empty">${escapeHtml(emptyText)}</span>`;
  }
  return uniqueValues.map((value) => `<code>${escapeHtml(value)}</code>`).join("");
}

function renderTextChips(values = [], emptyText = "None declared.") {
  const uniqueValues = [...new Set((values ?? []).filter(Boolean))];
  if (uniqueValues.length === 0) {
    return `<span class="empty">${escapeHtml(emptyText)}</span>`;
  }
  return uniqueValues.map((value) => `<span>${escapeHtml(value)}</span>`).join("");
}

function renderSurfaceTraceReference(traces = []) {
  if (traces.length === 0) {
    return `<section id="surface-trace-reference" class="architecture-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Trace</p>
          <h2>Surface Trace Reference</h2>
        </div>
      </div>
      <p class="empty">No public surfaces declared.</p>
    </section>`;
  }
  return `<section id="surface-trace-reference" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Trace</p>
        <h2>Surface Trace Reference</h2>
      </div>
    </div>
    <p class="section-note">Use this as the reviewer map from public surface to provider, consumers, allowed use, and scenario evidence. It is the SDK-style trace for multi-module Blueprints.</p>
    <div class="surface-trace-list">
      ${traces.map((trace) => `<article class="surface-trace-card">
        <header>
          <div>
            <p class="eyebrow">${escapeHtml(trace.surfaceKind ?? "surface")}</p>
            <h3>${escapeHtml(trace.surfaceName)}</h3>
          </div>
          <code>${escapeHtml(trace.responsibilityUnitId)}</code>
        </header>
        <div class="doc-table compact-doc-table">
          <div class="doc-row"><div class="doc-key">Provider</div><div class="doc-value"><strong>${escapeHtml(trace.moduleName)}</strong>${trace.owner ? `<span>${escapeHtml(trace.owner)}</span>` : ""}</div></div>
          <div class="doc-row"><div class="doc-key">Contracts</div><div class="doc-value">${renderCodeList(trace.contractIds)}</div></div>
          <div class="doc-row"><div class="doc-key">Provider Work</div><div class="doc-value">${renderCodeList(trace.providerWorkItems)}</div></div>
          <div class="doc-row"><div class="doc-key">Consumers</div><div class="doc-value">${renderTextChips(trace.consumers)}</div></div>
          <div class="doc-row"><div class="doc-key">Allowed Use</div><div class="doc-value">${renderTextChips(trace.allowedUses)}</div></div>
          <div class="doc-row"><div class="doc-key">Call Stacks</div><div class="doc-value">${renderCodeList(trace.callStacks)}</div></div>
          <div class="doc-row"><div class="doc-key">Scenarios</div><div class="doc-value">${renderTextChips(trace.scenarios)}</div></div>
        </div>
      </article>`).join("")}
    </div>
  </section>`;
}

function renderDesignPatterns(patterns = []) {
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
      </article>`).join("")}
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
  const primarySummary = referenceSummary({ blueprint, dossier });
  const title = referenceTitle(model);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Make It Real Architecture Dossier - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./preview.css?v=${Date.now()}">
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

      ${renderApprovalScope(dossier)}
      ${renderSystemPlacement(dossier)}
      ${renderTaskDag(dossier)}
      ${renderWorkerTopology(dossier)}
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
      ${renderSurfaceTraceReference(dossier.surfaceTraceReference)}

      <section id="scenario-reference" class="architecture-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Flows</p>
            <h2>Scenario Reference</h2>
          </div>
        </div>
        ${renderFlowTimeline(dossier)}
        ${renderScenarioDetails(dossier.scenarioDetails)}
      </section>

      <section id="acceptance" class="architecture-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Acceptance</p>
            <h2>Acceptance Criteria</h2>
          </div>
        </div>
        ${renderAcceptance(blueprint.acceptanceCriteria, dossier.workItems)}
      </section>

      ${renderDesignPatterns(dossier.designPatterns)}
      ${renderReviewDecisions(dossier.reviewDecisions)}
      ${renderVerificationEvidence(model.status)}
      ${renderSourcesSection(dossier)}
      ${renderDiagnostics(model, model.status)}
    </article>
  </main>
  <script src="./preview.js?v=${Date.now()}"></script>
  <script type="module">
    let mermaid;
    try {
      mermaid = (await import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")).default;
    } catch (_cdnError) {
      document.querySelectorAll("details.mermaid-source").forEach((el) => el.open = true);
      document.querySelectorAll("pre.mermaid").forEach((el) => el.style.display = "none");
    }
    if (!mermaid) { /* offline — sources already revealed above */ }
    else {
    const mermaidFont = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    mermaid.initialize({
      startOnLoad: true,
      securityLevel: "strict",
      theme: "base",
      fontFamily: mermaidFont,
      flowchart: {
        curve: "basis",
        htmlLabels: true,
        useMaxWidth: true,
        padding: 30,
        nodeSpacing: 60,
        rankSpacing: 80
      },
      sequence: {
        useMaxWidth: true,
        diagramMarginX: 32,
        diagramMarginY: 24,
        boxMargin: 12,
        boxTextMargin: 6,
        noteMargin: 12,
        messageMargin: 38,
        mirrorActors: false,
        actorFontFamily: mermaidFont,
        noteFontFamily: mermaidFont,
        messageFontFamily: mermaidFont
      },
      themeVariables: {
        background: "transparent",
        primaryColor: "#1c2128",
        primaryTextColor: "#e6edf3",
        primaryBorderColor: "#30363d",
        secondaryColor: "#1c2128",
        secondaryBorderColor: "#30363d",
        secondaryTextColor: "#e6edf3",
        tertiaryColor: "#0d1117",
        tertiaryBorderColor: "#30363d",
        tertiaryTextColor: "#e6edf3",
        mainBkg: "#1c2128",
        secondBkg: "#1c2128",
        lineColor: "#58a6ff",
        textColor: "#e6edf3",
        labelTextColor: "#e6edf3",
        nodeTextColor: "#e6edf3",
        edgeLabelBackground: "#0d1117",
        clusterBkg: "#0d1117",
        clusterBorder: "#30363d",
        titleColor: "#e6edf3",
        fontFamily: mermaidFont,
        fontSize: "14px",
        /* sequence */
        actorBkg: "#1c2128",
        actorBorder: "#30363d",
        actorTextColor: "#e6edf3",
        actorLineColor: "#30363d",
        signalColor: "#58a6ff",
        signalTextColor: "#e6edf3",
        labelBoxBkgColor: "#1c2128",
        labelBoxBorderColor: "#30363d",
        labelTextColor: "#e6edf3",
        loopTextColor: "#e6edf3",
        noteBkgColor: "#1c2128",
        noteBorderColor: "#30363d",
        noteTextColor: "#e6edf3",
        activationBkgColor: "#1c2128",
        activationBorderColor: "#58a6ff",
        sequenceNumberColor: "#0d1117",
        /* state */
        specialStateColor: "#58a6ff",
        altBackground: "#1c2128",
        innerEndBackground: "#1c2128",
        compositeBackground: "#1c2128",
        compositeBorder: "#30363d",
        compositeTitleBackground: "#1c2128",
        stateLabelColor: "#e6edf3",
        stateBkg: "#1c2128",
        labelColor: "#e6edf3",
        errorBkgColor: "#3d1d24",
        errorTextColor: "#f87171"
      }
    });
    }
  </script>
</body>
</html>
`;
}

export function renderDashboardCss() {
  return `
:root {
  color-scheme: dark light;
  --bg: #08090a;
  --panel: #0e0f12;
  --panel-2: #16181d;
  --ink: #f5f5f7;
  --ink-2: #c9c9d1;
  --muted: #6e6e80;
  --line: rgba(255,255,255,0.06);
  --line-strong: rgba(255,255,255,0.1);
  --soft: rgba(255,255,255,0.025);
  --soft-line: rgba(255,255,255,0.05);
  --accent: #8e95f5;
  --accent-strong: #a4abff;
  --accent-soft: rgba(142,149,245,0.12);
  --accent-border: rgba(142,149,245,0.28);
  --ok: #4ade80;
  --warn: #fbbf24;
  --bad: #f87171;
  --mono: "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  --radius: 10px;
  --radius-sm: 6px;
}

[data-theme="light"] {
  --bg: #fafafa;
  --panel: #ffffff;
  --panel-2: #f7f7f8;
  --ink: #0a0a0a;
  --ink-2: #1a1a1a;
  --muted: #767687;
  --line: rgba(0,0,0,0.07);
  --line-strong: rgba(0,0,0,0.12);
  --soft: rgba(0,0,0,0.02);
  --soft-line: rgba(0,0,0,0.05);
  --accent: #5e6ad2;
  --accent-strong: #4a55b8;
  --accent-soft: rgba(94,106,210,0.08);
  --accent-border: rgba(94,106,210,0.22);
  --ok: #047a48;
  --warn: #b45309;
  --bad: #b42318;
}

* { box-sizing: border-box; }
*::selection { background: var(--accent-soft); color: var(--ink); }

html { background: var(--bg); }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

code, pre, .file-tree-node {
  font-family: var(--mono);
  font-size: 12.5px;
  font-variant-ligatures: none;
}

a { color: var(--accent); text-decoration: none; transition: color .12s ease; }
a:hover { color: var(--accent-strong); }

p { margin: 0 0 8px; color: var(--ink-2); }
p:last-child { margin-bottom: 0; }
hr { border: 0; border-top: 1px solid var(--soft-line); margin: 16px 0; }

ul { margin: 0 0 8px; padding-left: 18px; color: var(--ink-2); }
ul:last-child { margin-bottom: 0; }
li { padding: 2px 0; }

button { font-family: inherit; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 99px; border: 2px solid var(--bg); }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }

[data-theme-toggle] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--ink-2);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  padding: 5px 10px;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
[data-theme-toggle]:hover {
  background: var(--accent-soft);
  color: var(--ink);
  border-color: var(--accent-border);
}

.architecture-shell {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 980px);
  gap: 48px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 40px 96px;
}

.architecture-nav {
  position: sticky;
  top: 24px;
  align-self: start;
  display: grid;
  gap: 1px;
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 4px 0;
}

.architecture-nav .nav-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 0 10px;
}

.architecture-nav .eyebrow { margin: 0; }

.architecture-nav strong {
  display: block;
  margin: 4px 10px 12px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.architecture-nav a {
  display: block;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  transition: background .1s ease, color .1s ease;
}

.architecture-nav a[hidden] { display: none; }
.architecture-nav a.nav-empty { opacity: 0.4; }

.architecture-nav a:hover {
  background: var(--soft);
  color: var(--ink-2);
}

.architecture-nav a.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.nav-filter {
  display: grid;
  gap: 6px;
  margin: 4px 10px 12px;
}

.nav-filter span {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.nav-filter input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
  padding: 6px 9px;
  transition: border-color .12s ease;
}

.nav-filter input:focus {
  outline: none;
  border-color: var(--accent-border);
}

.nav-group {
  display: grid;
  gap: 1px;
  margin: 12px 0 4px;
  padding-top: 12px;
  border-top: 1px solid var(--soft-line);
}

.nav-group > span {
  padding: 4px 10px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.architecture-nav .nav-module { color: var(--ink-2); font-weight: 500; }
.architecture-nav .nav-surface {
  padding-left: 22px;
  color: var(--muted);
  font-size: 12px;
}
.architecture-nav .nav-surface::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 1px;
  background: var(--line-strong);
  margin-right: 8px;
  vertical-align: middle;
}

.architecture-main {
  display: grid;
  gap: 56px;
  min-width: 0;
}

.architecture-hero,
.architecture-section,
.diagram-card,
.module-directory {
  min-width: 0;
}

.architecture-hero {
  display: grid;
  gap: 12px;
  padding: 8px 0 0;
}

.hero-topline {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.eyebrow,
.rail-label {
  margin: 0;
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reference-label {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--accent-border);
  border-radius: 99px;
  padding: 3px 10px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}

h1 {
  margin: 0;
  max-width: 820px;
  font-size: clamp(28px, 3vw, 38px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--ink);
  overflow-wrap: anywhere;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--ink);
}

h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
}

h4 {
  margin: 0 0 6px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.summary-line {
  max-width: 760px;
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 16px;
  line-height: 1.55;
  letter-spacing: -0.005em;
}

.request-disclosure {
  margin-top: 12px;
  color: var(--muted);
  font-size: 13px;
}

.request-disclosure summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.request-disclosure summary::-webkit-details-marker { display: none; }
.request-disclosure summary::before {
  content: "›";
  display: inline-block;
  color: var(--muted);
  transition: transform .12s ease;
  transform: rotate(0deg);
}
.request-disclosure[open] summary::before { transform: rotate(90deg); }
.request-disclosure summary:hover { color: var(--ink-2); }

.request-disclosure p {
  margin: 8px 0 0;
  max-width: 820px;
  color: var(--ink-2);
}

.overview-brief {
  display: grid;
  gap: 8px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--soft-line);
}

.overview-brief p {
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
}

.overview-brief strong { color: var(--ink); font-weight: 600; }

.architecture-section {
  display: grid;
  gap: 16px;
  scroll-margin-top: 32px;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--soft-line);
}

.section-heading > div {
  display: grid;
  gap: 4px;
}

.section-heading h2 { margin: 0; }

.section-heading > span {
  border: 1px solid var(--line);
  border-radius: 99px;
  padding: 3px 9px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.section-note {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
  max-width: 760px;
}

.empty, .muted { color: var(--muted); font-size: 13px; }

.clean-list { padding-left: 18px; color: var(--ink-2); }

/* === Cards: borderless, more whitespace === */
.module-node,
.module-reference-card,
.contract-matrix article,
.responsibility-unit,
.contract-surface,
.surface-trace-card,
.scenario-detail,
.worker-assignment,
.reference-card,
.boundary-card,
.callstack-card,
.sequence-card,
.diagram-card,
.schema-display,
.surface-summary,
.workflow-step,
.criterion,
.sdk-example,
.test-results article,
.scenario-index a,
.signature-row,
.rail-section,
.rail-list > div,
.artifact-grid > div {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 18px;
  transition: border-color .12s ease;
}

/* Nested cards (inside other cards) get the elevated tone */
.responsibility-unit .file-tree,
.surface-detail-grid .signature-column,
.schema-sections li,
.signature-row {
  background: var(--panel-2);
}

/* Reference grid (key-value) */
.reference-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 12px;
  background: var(--soft-line);
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--line);
}

.reference-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reference-grid div {
  padding: 12px 14px;
  background: var(--panel);
}

.reference-grid span {
  display: block;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.reference-grid strong {
  display: block;
  margin-top: 4px;
  color: var(--ink);
  font-size: 13.5px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

/* === Doc table === */
.doc-table {
  overflow: hidden;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius);
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
  padding: 12px 16px;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.doc-key {
  background: var(--soft);
  color: var(--muted);
  font-weight: 500;
  font-size: 11.5px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.doc-value { color: var(--ink-2); }
.doc-value ul { margin: 0; }
.doc-value strong { color: var(--ink); font-weight: 600; }
.doc-value p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }

.compact-doc-table .doc-row {
  grid-template-columns: 140px minmax(0, 1fr);
}

.architecture-table { margin-top: 4px; }
.architecture-table .doc-value { display: grid; gap: 4px; }
.architecture-table .doc-value span { color: var(--muted); font-size: 12px; }

.doc-value code,
.artifact-grid code,
.rail-list code,
.contract-chip-list code,
.task-dag-row code,
.worker-assignment code,
.approval-scope-table code,
.module-directory-row code,
.surface-list a,
.path-list code,
.transition-list code,
.flow-line span,
.transition-list span {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 99px;
  padding: 2px 9px;
  background: var(--panel-2);
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

/* === Code blocks === */
.code-block {
  margin: 0;
  border-radius: var(--radius);
  background: #050507;
  color: #e8e8ec;
  padding: 16px 18px;
  overflow: auto;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

[data-theme="light"] .code-block {
  background: #1a1b1f;
  color: #e8e8ec;
}

.code-block code {
  color: inherit;
  font-size: inherit;
  background: transparent;
  border: 0;
  padding: 0;
  border-radius: 0;
}

/* === Mermaid + diagrams === */
.diagram-grid {
  display: grid;
  gap: 14px;
}

.diagram-card {
  overflow: hidden;
  padding: 0;
  border: 1px solid #21262d;
  border-radius: 12px;
  background: #0d1117;
}

.diagram-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--soft-line);
}

.diagram-card header strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.diagram-card header span {
  color: var(--muted);
  font-size: 12px;
}

.mermaid {
  margin: 0;
  min-height: 140px;
  padding: 32px 32px;
  overflow-x: auto;
  overflow-y: hidden;
  background:
    radial-gradient(ellipse 900px 500px at 30% 20%, rgba(88,166,255,0.08), transparent 65%),
    radial-gradient(ellipse 700px 400px at 75% 80%, rgba(56,139,253,0.06), transparent 65%),
    #0d1117;
  color: #e6edf3;
  text-align: center;
  font-family: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
}

.mermaid svg {
  max-width: 100%;
  height: auto;
  background: transparent !important;
  filter: drop-shadow(0 0 40px rgba(88,166,255,0.04));
}

.mermaid svg .edgePath .path,
.mermaid svg .flowchart-link {
  stroke: #58a6ff;
  stroke-width: 2px;
}

.mermaid svg .edgeLabel {
  background-color: #0d1117 !important;
  color: #e6edf3 !important;
  font-size: 12px !important;
}
.mermaid svg .edgeLabel rect { fill: #0d1117 !important; rx: 6; ry: 6; }
.mermaid svg .edgeLabel foreignObject div { background-color: #0d1117 !important; color: #e6edf3 !important; padding: 2px 8px !important; border-radius: 6px; }

.mermaid svg .node rect,
.mermaid svg .node polygon,
.mermaid svg .node circle,
.mermaid svg .node ellipse,
.mermaid svg .node path {
  rx: 12;
  ry: 12;
  filter: drop-shadow(0 2px 8px rgba(88,166,255,0.15)) drop-shadow(0 6px 16px rgba(0,0,0,0.30));
}

.mermaid svg .node .label,
.mermaid svg .node .nodeLabel,
.mermaid svg .label foreignObject div {
  color: #e6edf3 !important;
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif !important;
  font-size: 14px !important;
  line-height: 1.4;
  padding: 4px 8px;
}

.mermaid svg .node foreignObject {
  overflow: visible;
}

.mermaid svg .node rect {
  min-width: 180px;
}

.mermaid svg .node .nodeLabel b { color: #e6edf3; font-weight: 600; }

.mermaid svg .marker { fill: #58a6ff !important; stroke: #58a6ff !important; }

[data-theme="light"] .mermaid {
  background: #f6f8fa;
  color: #1f2328;
}

.mermaid-source {
  border-top: 1px solid var(--soft-line);
  padding: 12px 18px;
}

.mermaid-source summary,
.workflow-fallback summary,
.rail-code summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  list-style: none;
}
.mermaid-source summary::-webkit-details-marker,
.workflow-fallback summary::-webkit-details-marker,
.rail-code summary::-webkit-details-marker { display: none; }

.mermaid-source summary:hover,
.workflow-fallback summary:hover,
.rail-code summary:hover { color: var(--ink-2); }

.mermaid-source .code-block { margin-top: 10px; }

/* === System map / module nodes === */
.system-map {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.module-node header,
.module-reference-card header,
.contract-matrix article header,
.worker-assignment header,
.responsibility-unit header,
.surface-trace-card header,
.schema-display header,
.scenario-detail header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.module-node strong,
.module-reference-card h3,
.contract-matrix code,
.module-node h3 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.module-node p,
.contract-matrix p,
.module-reference-card .section-note {
  color: var(--muted);
  font-size: 13px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.chip-row span {
  border: 1px solid var(--line);
  border-radius: 99px;
  background: var(--panel-2);
  padding: 2px 9px;
  color: var(--muted);
  font-size: 11.5px;
}

/* === Dependency matrix / Spec tables === */
.dependency-matrix {
  display: grid;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}

.matrix-row,
.task-dag-row,
.spec-row,
.module-directory-row {
  display: grid;
  border-top: 1px solid var(--soft-line);
}

.matrix-row { grid-template-columns: minmax(120px, .9fr) minmax(120px, .9fr) minmax(190px, 1fr) minmax(220px, 1.4fr); }
.task-dag-row { grid-template-columns: minmax(180px, .9fr) minmax(170px, .8fr) minmax(190px, 1fr) minmax(220px, 1.2fr); gap: 8px; padding: 12px 16px; align-items: start; }
.spec-row { grid-template-columns: minmax(130px, .75fr) minmax(90px, .55fr) minmax(110px, .65fr) minmax(220px, 1.7fr); }
.module-directory-row { grid-template-columns: minmax(170px, .9fr) minmax(110px, .55fr) minmax(200px, 1.1fr) minmax(220px, 1.2fr); gap: 8px; padding: 12px 16px; align-items: start; color: var(--ink); }

.matrix-row:first-child,
.task-dag-row:first-child,
.spec-row:first-child,
.module-directory-row:first-child { border-top: 0; }

.matrix-row > div,
.spec-row > div {
  min-width: 0;
  padding: 11px 14px;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.matrix-row.header,
.task-dag-row.header,
.spec-row.header,
.module-directory-row.header {
  background: var(--soft);
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.task-dag-row > div,
.worker-assignment .doc-value,
.approval-scope-table .doc-value,
.module-directory-row > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.task-dag-row strong,
.module-directory-row strong { flex-basis: 100%; color: var(--ink); font-weight: 600; }
.task-dag-row span { color: var(--muted); font-size: 12px; }

.module-directory-row:not(.header):hover { background: var(--soft); }

.spec-block { display: grid; gap: 10px; }
.spec-block h3 { margin: 0; }
.spec-table { overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.spec-stack { display: grid; gap: 14px; margin-top: 12px; }
.spec-block:nth-child(2) .spec-row { grid-template-columns: minmax(130px, .8fr) minmax(90px, .6fr) minmax(220px, 1.8fr); }
.spec-block:nth-child(3) .spec-row { grid-template-columns: minmax(180px, .8fr) minmax(240px, 1.1fr) minmax(280px, 1.4fr); }

.task-dag-table,
.worker-topology-list {
  display: grid;
  gap: 14px;
}

.task-dag-table {
  gap: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}

.worker-assignment {
  display: grid;
  gap: 12px;
}

.worker-assignment h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.worker-assignment p {
  margin: 0;
  color: var(--ink-2);
  font-size: 13.5px;
}

/* === Module directory === */
.module-directory {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}

.module-directory > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--soft-line);
  padding: 14px 18px;
}

.module-directory h3 { margin: 0; }
.module-directory > header > span { color: var(--muted); font-size: 12px; font-weight: 500; }

.module-directory-table { display: grid; }

/* === Module reference === */
.module-reference {
  display: grid;
  gap: 14px;
}

.module-reference > * { min-width: 0; }
.module-reference-card { display: grid; gap: 14px; }
.module-id {
  margin: 0;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* === Surface reference === */
.surface-reference {
  display: grid;
  gap: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--soft-line);
}

.surface-reference:first-of-type { padding-top: 0; border-top: 0; }

.surface-reference > *,
.surface-detail-grid > *,
.surface-summary > * { min-width: 0; }

.surface-summary { display: grid; gap: 12px; padding: 16px; }
.surface-summary h4 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
.surface-summary p { margin: 0; }

.surface-reference-header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.surface-reference-header h4 {
  margin: 6px 0 4px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.surface-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.surface-signature { margin: 0; }
.surface-signature code,
.signature-chip {
  display: inline-block;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  padding: 6px 10px;
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.contract-chip-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}

.method {
  display: inline-flex;
  justify-content: center;
  border-radius: 99px;
  padding: 3px 9px;
  background: rgba(74, 222, 128, 0.1);
  color: var(--ok);
  border: 1px solid rgba(74, 222, 128, 0.2);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.method.neutral {
  background: var(--accent-soft);
  color: var(--accent-strong);
  border-color: var(--accent-border);
}

/* === Signature blocks === */
.signature-column {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel-2);
}

.signature-column h4,
.imports-list h4 {
  margin: 0;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.signature-table {
  display: grid;
  gap: 6px;
}

.signature-row {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  background: var(--panel);
  border-radius: var(--radius-sm);
  border-color: var(--soft-line);
}

.signature-row strong { color: var(--ink); font-size: 13px; font-weight: 600; }
.signature-row span { color: var(--muted); font-size: 12px; }
.signature-row p { margin: 4px 0 0; color: var(--ink-2); font-size: 12.5px; }

.signature-cases {
  display: grid;
  gap: 5px;
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

.signature-cases span { color: var(--muted); font-size: 12px; }

.signature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

/* === SDK example === */
.sdk-example {
  overflow: hidden;
  padding: 0;
}

.sdk-panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--soft-line);
  padding: 10px 16px;
}

.sdk-panel-title span {
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.sdk-panel-title strong {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}

.sdk-example .code-block {
  margin: 0;
  border: 0;
  border-radius: 0;
}

/* === Schema display === */
.schema-display {
  display: grid;
  gap: 12px;
}

.schema-display header > code {
  max-width: 320px;
  overflow-wrap: anywhere;
  white-space: normal;
}

.schema-sections { display: grid; gap: 10px; }

.schema-sections section {
  border-top: 1px solid var(--soft-line);
  padding-top: 12px;
}

.schema-sections h4 { margin: 0 0 8px; }

.schema-sections ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.schema-sections li {
  display: grid;
  gap: 3px;
  border: 1px solid var(--soft-line);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
}

.schema-sections li code {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 500;
}

.schema-sections li span,
.schema-sections li p,
.scenario-detail header p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

/* === Contract surfaces / Trace === */
.responsibility-map,
.contract-surface-list,
.surface-trace-list,
.scenario-reference {
  display: grid;
  gap: 14px;
}

.responsibility-unit h3,
.surface-trace-card h3,
.schema-display h3,
.scenario-detail h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.responsibility-unit h4 {
  margin: 16px 0 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-2);
}

.surface-list a:hover { color: var(--accent); border-color: var(--accent-border); }

/* === File tree === */
.file-tree {
  overflow: auto;
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  background: var(--panel-2);
}

.file-tree ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: 18px;
  list-style: none;
}

.file-tree > ul { padding-left: 0; }

.file-tree-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 12px;
}

.file-tree-node.dir::before {
  content: "/";
  color: var(--accent);
  font-weight: 700;
}
.file-tree-node.file::before {
  content: ".";
  color: var(--muted);
  font-weight: 700;
  width: 8px;
  display: inline-flex;
  justify-content: center;
}

/* === Scenario index === */
.scenario-index { display: grid; gap: 8px; }

.scenario-index a {
  display: grid;
  gap: 4px;
  color: var(--ink-2);
  padding: 14px 16px;
}

.scenario-index a:hover {
  border-color: var(--accent-border);
  color: var(--ink);
}

.scenario-index a strong { color: var(--ink); font-weight: 600; }
.scenario-index span { color: var(--muted); font-size: 12px; }

/* === Workflow / Flow === */
.workflow-fallback { margin-top: 12px; }

.workflow-graph {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.workflow-step {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 4px 14px;
  padding: 12px 14px;
}

.workflow-step span {
  grid-row: span 2;
  color: var(--accent);
  font-family: var(--mono);
  font-weight: 600;
  font-size: 13px;
}

.workflow-step strong { color: var(--ink); font-weight: 600; font-size: 13.5px; }
.workflow-step p { margin: 0; color: var(--muted); font-size: 12.5px; }

.flow-timeline {
  display: grid;
  gap: 28px;
}

.flow-timeline > section { display: grid; gap: 12px; }
.flow-timeline > section > h3 {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* === Call stack === */
.callstack-list { display: grid; gap: 10px; }

.callstack-card {
  overflow: hidden;
  padding: 0;
}

.callstack-card header {
  background: var(--soft);
  padding: 10px 16px;
  border-bottom: 1px solid var(--soft-line);
}

.callstack-card header code {
  color: var(--ink);
  font-weight: 500;
  background: transparent;
  border: 0;
  padding: 0;
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
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 12px;
  border-top: 1px solid var(--soft-line);
  padding: 11px 16px;
  counter-increment: callstep;
  font-size: 13px;
  color: var(--ink-2);
}

.callstack-card li:first-child { border-top: 0; }

.callstack-card li::before {
  content: counter(callstep);
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 22px;
  height: 22px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
}

.sequence-card { padding: 14px 16px; }
.sequence-card strong { display: block; color: var(--ink); font-weight: 600; margin-bottom: 8px; }
.sequence-card ol { display: grid; gap: 6px; margin: 0; padding-left: 18px; color: var(--ink-2); font-size: 13px; }

/* === Path lists / flow lines === */
.path-list,
.transition-list,
.flow-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.path-list { margin: 8px 0; }

.flow-line b { color: var(--muted); font-weight: 600; }

/* === Criteria === */
.criteria-list { display: grid; gap: 10px; margin-bottom: 14px; }

.criterion {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  padding: 12px 14px;
}

.criterion strong { color: var(--accent); font-family: var(--mono); font-size: 12px; font-weight: 600; }
.criterion span { color: var(--ink-2); font-size: 13.5px; }

/* === Review decisions === */
.review-decisions {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 22px;
  color: var(--ink-2);
}

.review-decisions li { padding-left: 4px; }

/* === Test results === */
.test-results {
  display: grid;
  gap: 8px;
}

.test-results article {
  border-left: 3px solid var(--ok);
  padding: 12px 16px;
}

.test-results article.failed { border-left-color: var(--bad); }

.test-results strong { color: var(--ink); font-weight: 600; }
.test-results p { margin: 4px 0; color: var(--ink-2); font-size: 13px; }

/* === Sources === */
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
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 12px 14px;
  align-items: center;
}

.sources-list span,
.sources-list em {
  color: var(--muted);
  font-style: normal;
  font-weight: 500;
  font-size: 12.5px;
}

.sources-list span { color: var(--ink); font-weight: 600; }

/* === Diagnostics === */
.diagnostics-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 0;
}

.diagnostics-panel summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  padding: 14px 18px;
  list-style: none;
}
.diagnostics-panel summary::-webkit-details-marker { display: none; }
.diagnostics-panel summary::after {
  content: "›";
  display: inline-block;
  color: var(--muted);
  transition: transform .12s ease;
}
.diagnostics-panel[open] summary::after { transform: rotate(90deg); }

.diagnostics-panel[open] {
  padding: 0 18px 18px;
}

.diagnostics-panel .doc-table { margin: 12px 0; }
.diagnostics-panel section { display: grid; gap: 10px; margin-top: 16px; }

.diagnostics-panel .diagnostics-panel {
  border: 1px solid var(--soft-line);
  margin-top: 12px;
}

.artifact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.artifact-grid > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
}

.artifact-grid strong { color: var(--ink); font-weight: 600; font-size: 13px; }

/* === Rail (legacy structures used by helper functions) === */
.rail-list { display: grid; gap: 8px; }
.rail-list > div { padding: 10px 12px; }
.rail-list strong { color: var(--ink); font-weight: 600; }
.rail-list p { margin: 4px 0; color: var(--muted); font-size: 12.5px; }

.rail-section { display: grid; gap: 10px; }
.rail-section h2 { margin: 0; font-size: 16px; }

.rail-toc { display: grid; gap: 2px; }
.rail-toc a {
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 13px;
  padding: 6px 10px;
}
.rail-toc a:hover { background: var(--soft); color: var(--ink-2); }

.rail-code { display: grid; gap: 8px; }

.runtime-section { background: var(--panel); }
.runtime-rail h2 { margin: 0; font-size: 16px; }
.runtime-rail .status-rail { border: 0; background: transparent; padding: 0; }
.runtime-rail .status-rail > summary { cursor: pointer; padding: 0; font-weight: 600; }

/* === Status rail (kept for compatibility, used inside diagnostics) === */
.status-rail {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  display: block;
  overflow: hidden;
}

.status-rail summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  cursor: pointer;
  font-weight: 600;
}

.status-rail summary strong { color: var(--muted); font-size: 12px; font-weight: 500; }

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--soft-line);
}

.status-grid section {
  border-top: 1px solid var(--soft-line);
  border-left: 1px solid var(--soft-line);
  padding: 16px 18px;
}

.status-grid section:nth-child(1),
.status-grid section:nth-child(2) { border-top: 0; }
.status-grid section:nth-child(odd) { border-left: 0; }

.status-rail h2 { font-size: 22px; }

.command-copy {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.copy-command {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--ink-2);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  transition: background .12s ease, color .12s ease;
}
.copy-command:hover { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--accent-border); }

/* === Kanban === */
.compact-kanban {
  display: grid;
  gap: 8px;
}

.compact-kanban .kanban-lane {
  border: 1px solid var(--soft-line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  padding: 10px 12px;
}

.kanban-lane header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.kanban-lane header strong { color: var(--ink); font-family: var(--mono); }

.work-card {
  display: grid;
  gap: 3px;
  border-top: 1px solid var(--soft-line);
  padding-top: 8px;
  margin-top: 8px;
  font-size: 12.5px;
}

.work-card:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }

.work-card strong { color: var(--ink); font-size: 13px; font-weight: 600; }
.work-card code { color: var(--muted); background: transparent; border: 0; padding: 0; font-size: 11px; }
.work-card span,
.work-card em { color: var(--muted); font-style: normal; font-size: 11.5px; }

/* === Guide steps === */
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
  padding-top: 10px;
}

.guide-step:first-child { border-top: 0; padding-top: 0; }

.guide-step strong {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.guide-step.complete strong { color: var(--ok); }
.guide-step.current strong,
.guide-step.blocked strong { color: var(--warn); }

/* === Theme toggle bar === */
.dashboard-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 40px;
  border-bottom: 1px solid var(--soft-line);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: saturate(140%) blur(12px);
  -webkit-backdrop-filter: saturate(140%) blur(12px);
}

.dashboard-topbar .brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
}

.dashboard-topbar .brand strong {
  color: var(--ink);
  font-weight: 600;
}

.dashboard-topbar .brand .dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
}

/* === Responsive === */
@media (max-width: 1100px) {
  .architecture-shell {
    grid-template-columns: minmax(200px, 240px) minmax(0, 1fr);
    gap: 32px;
    padding: 24px 28px 80px;
  }
  .dashboard-topbar { padding: 12px 28px; }
}

@media (max-width: 820px) {
  .architecture-shell {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 16px 18px 64px;
  }

  .architecture-nav {
    position: static;
    max-height: none;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px;
  }

  .architecture-nav .nav-header,
  .architecture-nav strong,
  .nav-filter,
  .nav-group { grid-column: 1 / -1; }

  .dashboard-topbar { padding: 10px 18px; }

  .reference-grid,
  .reference-grid.compact,
  .signature-grid,
  .surface-detail-grid,
  .system-map,
  .artifact-grid,
  .status-grid {
    grid-template-columns: 1fr;
  }

  .doc-row,
  .matrix-row,
  .task-dag-row,
  .spec-row,
  .module-directory-row,
  .sources-list li,
  .spec-block:nth-child(2) .spec-row,
  .spec-block:nth-child(3) .spec-row,
  .criterion,
  .workflow-step {
    grid-template-columns: 1fr;
  }

  .section-heading,
  .surface-reference-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .contract-chip-list { justify-content: flex-start; }

  .matrix-row.header,
  .task-dag-row.header,
  .spec-row.header,
  .module-directory-row.header { display: none; }

  .matrix-row > div::before,
  .task-dag-row > div::before,
  .spec-row > div::before,
  .module-directory-row > div::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
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
  if (window.location.protocol === "file:") {
    markAutoRefreshUnavailable();
    return;
  }
  checkForDashboardUpdate();
  pollTimer = window.setInterval(checkForDashboardUpdate, pollMs);
  console.info("makeitreal:auto-reload");
})();
`;
}
