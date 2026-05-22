// Shared utilities for Architecture Dossier section templates.
// Pure refactor — extracted from render-dashboard-html.mjs.

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderTextList(values = []) {
  if (!values || values.length === 0) {
    return '<p class="empty">None recorded.</p>';
  }
  return `<ul class="clean-list">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

export function humanizeIdentifier(value) {
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

export function conciseTitleFromText(value, { preferFunction = true } = {}) {
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

export function nonExternalModules(modules = []) {
  return modules.filter((moduleInterface) => moduleInterface.owner !== "external.provider");
}

export function titleIntroBeforeUnitSections(value) {
  return String(value ?? "")
    .split(/\bUnit\s+\d+\b/i)[0]
    .trim();
}

export function countLabel(count) {
  return new Map([
    [1, "One"],
    [2, "Two"],
    [3, "Three"],
    [4, "Four"],
    [5, "Five"]
  ]).get(count) ?? String(count);
}

export function architecturePacketTitle({ rawTitle, modules, dependencyEdges = [] }) {
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

export function httpSurface(surface) {
  const match = String(surface?.name ?? "").match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)$/i);
  if (!match) {
    return null;
  }
  return {
    method: match[1].toUpperCase(),
    path: match[2]
  };
}

export function surfaceSignature(surface) {
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

export function referenceTitle(model) {
  const blueprint = model.blueprint ?? {};
  const dossier = blueprint.systemDossier ?? {};
  const rawTitle = dossier.title ?? blueprint.title ?? model.run.workItemId;
  const modules = dossier.modules ?? [];
  if (modules.length > 1) {
    return architecturePacketTitle({ rawTitle, modules, dependencyEdges: dossier.dependencyEdges ?? [] });
  }
  return conciseTitleFromText(rawTitle) || "Blueprint";
}

export function referenceSummary({ blueprint, dossier }) {
  const modules = dossier.modules ?? [];
  if (modules.length > 1) {
    const moduleNames = modules.map((moduleInterface) => moduleInterface.moduleName).filter(Boolean).join(", ");
    const contractCount = new Set((dossier.contractSurfaces ?? []).flatMap((surface) => surface.contractIds ?? [])).size;
    const contractLabel = contractCount === 1 ? "1 contract" : `${contractCount} contracts`;
    return `${modules.length} responsibility units: ${moduleNames}. Review module placement, public signatures, ${contractLabel}, and Done evidence as one architecture packet.`;
  }
  return (blueprint.summary ?? [])[0] ?? "No user-visible behavior recorded.";
}

export function verificationLabel(status = {}) {
  if (status.phase === "done") {
    return "Verified and synced";
  }
  const verification = (status.evidenceSummary ?? []).find((item) => String(item.kind ?? "").includes("verification"));
  if (verification?.ok === true) {
    return "Verification passed";
  }
  return status.nextAction ?? "Pending review";
}

export function verificationTileLabel(status = {}) {
  return status.phase === "done" || (status.evidenceSummary ?? []).some((item) => String(item.kind ?? "").includes("verification")) ? "Verification" : "Next Step";
}

export function relativeImportPath(ownedPath) {
  const path = String(ownedPath ?? "").trim();
  if (!path) {
    return "./module";
  }
  const concretePath = path.includes("*") ? path.replace(/\/?\*\*?.*$/, "") || path : path;
  return concretePath.startsWith(".") ? concretePath : `./${concretePath}`;
}

export function sampleValueForType(type) {
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

export function sampleValueForInput(input) {
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

export function safeIdentifier(value, fallback = "result") {
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

export function declaredRequestBodyFields(surface) {
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

export function requestBodyDeclaration(surface) {
  const fields = declaredRequestBodyFields(surface);
  if (fields.length === 0) {
    return `/* ⚠ No request body fields declared for ${surface.name} */\nconst requestBody = {};\n\n`;
  }
  const body = fields
    .map((input) => `  ${input.name}: ${sampleValueForInput(input)}`)
    .join(",\n");
  return `const requestBody = {\n${body}\n};\n\n`;
}

export function usageSnippet({ moduleInterface, surface }) {
  const http = httpSurface(surface);
  if (http) {
    const outputName = safeIdentifier(surface.signature.outputs[0].name, "responseBody");
    const hasRequestBody = http.method !== "GET" && http.method !== "DELETE";
    const requestBody = hasRequestBody ? requestBodyDeclaration(surface) : "";
    const bodyLine = hasRequestBody ? `,\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify(requestBody)` : "";
    return `${requestBody}const httpResponse = await fetch("${http.path}", {\n  method: "${http.method}"${bodyLine}\n});\n\nif (!httpResponse.ok) {\n  throw new Error(\`HTTP \${httpResponse.status}\`);\n}\n\nconst ${outputName} = await httpResponse.json();`;
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
    return `${importComment}import { ${surface.name} } from "${importPath}";\n\nconst ${outputName} = ${surface.name}(${args});`;
  }
  return `// ${surface.name} is the declared public surface owned by ${moduleInterface?.moduleName ?? "this responsibility unit"}.\n// Call it only through the Blueprint contract; do not read implementation internals.\nconst ${outputName} = ${surface.name}(${args});`;
}

export function renderCodeBlock(code, language = "js") {
  return `<pre class="code-block" data-language="${escapeHtml(language)}"><code>${escapeHtml(code)}</code></pre>`;
}

export function renderFileTreeNode(node = {}) {
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

export function renderFileTree(tree) {
  if (!tree?.name) {
    return '<p class="empty">No owned paths declared.</p>';
  }
  return `<div class="file-tree" role="tree">
    <ul>${renderFileTreeNode(tree)}</ul>
  </div>`;
}

export function typeBadgeHtml(type) {
  const normalized = String(type ?? "").toLowerCase();
  const knownTypes = ["string", "number", "boolean", "object", "array", "integer"];
  const matched = knownTypes.find((known) => normalized.includes(known));
  if (!matched) {
    return "";
  }
  return `<span class="type-badge" style="display:inline-block;background:#1c6b50;color:#e6edf3;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;margin-right:6px;">${escapeHtml(matched)}</span>`;
}

export function constraintNoteHtml(description) {
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

export function renderSchemaField(field = {}, role = "field") {
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

export function renderSchemaSection(title, fields = [], role = "field") {
  return `<section>
    <h4>${escapeHtml(title)}</h4>
    ${fields.length === 0
      ? '<p class="empty">None declared.</p>'
      : `<ul>${fields.map((field) => renderSchemaField(field, role)).join("")}</ul>`}
  </section>`;
}

export function renderSchemaDisplay(surface = {}) {
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

export function renderSourcesList(sources = []) {
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

export function renderTestResults(evidence = []) {
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

export function renderKeyValueGrid(items = []) {
  return `<div class="reference-grid compact">${items.map((item) => `<div>
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(item.value)}</strong>
  </div>`).join("")}</div>`;
}

export function formatSignatureMeta(item, valueKeys = []) {
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

export function renderSignatureRow(item, valueKeys = []) {
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

export function renderSignatureTable(title, items = [], valueKeys = []) {
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

export function renderSpecTable(title, items = [], columns = []) {
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

export function surfaceKindLabel(surface) {
  const http = httpSurface(surface);
  return http ? `${http.method} ${http.path}` : surface.kind;
}

export function renderSurfaceSummary({ moduleInterface, surface }) {
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

export function moduleSurfaces(dossier = {}) {
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

export function surfaceDisplayName({ moduleInterface, surface }) {
  return `${moduleInterface.moduleName}: ${surface.name}`;
}

export function signatureInputs(surface) {
  return surface.signature?.inputs ?? [];
}

export function signatureOutputs(surface) {
  return surface.signature?.outputs ?? [];
}

export function signatureErrors(surface) {
  return surface.signature?.errors ?? [];
}

export function findSurfaceByImport({ dossier, dependency }) {
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

export function firstPublicSurface(dossier = {}) {
  const modules = dossier.modules ?? [];
  for (const moduleInterface of modules) {
    for (const surface of moduleInterface.publicSurfaces ?? []) {
      return { moduleInterface, surface };
    }
  }
  return null;
}

export function publicSurfaceCount(moduleInterfaces = []) {
  return moduleInterfaces.reduce((total, moduleInterface) => total + (moduleInterface.publicSurfaces ?? []).length, 0);
}

export function mermaidLabel(value) {
  return String(value ?? "")
    .replaceAll('"', "'")
    .replaceAll("\n", " ")
    .trim() || "Unnamed";
}

export function mermaidNodeId(index) {
  return `n${index}`;
}

export function mermaidParticipants(messages = []) {
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

export function mermaidDiagramCard({ title, description, diagram }) {
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

export function anchorSlug(value, fallback = "item") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

export function moduleAnchor(module, index) {
  return `module-${index}-${anchorSlug(module.moduleName ?? module.responsibilityUnitId, "module")}`;
}

export function surfaceAnchor(module, surface, moduleIndex, surfaceIndex) {
  return `${moduleAnchor(module, moduleIndex)}-surface-${surfaceIndex}-${anchorSlug(surface.name, "surface")}`;
}

export function harnessSequence(sequence = {}) {
  const text = [
    ...(sequence.participants ?? []),
    ...(sequence.messages ?? []).flatMap((message) => [message.from, message.to, message.label])
  ].join(" ").toLowerCase();
  return text.includes("make it real")
    || text.includes("implementation responsibility unit")
    || text.includes("request planned work")
    || text.includes("assign work.");
}

export function sequenceMermaid(sequences = []) {
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

export function renderCodeList(values = [], emptyText = "None declared.") {
  const uniqueValues = [...new Set((values ?? []).filter(Boolean))];
  if (uniqueValues.length === 0) {
    return `<span class="empty">${escapeHtml(emptyText)}</span>`;
  }
  return uniqueValues.map((value) => `<code>${escapeHtml(value)}</code>`).join("");
}

export function renderTextChips(values = [], emptyText = "None declared.") {
  const uniqueValues = [...new Set((values ?? []).filter(Boolean))];
  if (uniqueValues.length === 0) {
    return `<span class="empty">${escapeHtml(emptyText)}</span>`;
  }
  return uniqueValues.map((value) => `<span>${escapeHtml(value)}</span>`).join("");
}

export function renderWorkflowGraph(scenario = {}) {
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

export function scenarioMermaid(scenario = {}) {
  return sequenceMermaid([scenario]);
}

export function renderScenarioVisualization(scenario = {}) {
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

export function renderAcceptance(criteria = [], workItems = []) {
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

export function requireSystemDossier(model) {
  if (!model.blueprint || !model.blueprint.systemDossier) {
    throw new Error("HARNESS_PREVIEW_MODEL_INVALID: blueprint.systemDossier is required.");
  }
  return model.blueprint.systemDossier;
}
