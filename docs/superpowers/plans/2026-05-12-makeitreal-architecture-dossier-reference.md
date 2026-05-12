# Make It Real Architecture Dossier Reference Implementation Plan

> **For agentic workers:** This plan is self-contained. Execute it task-by-task from the repository files and commands listed below; no external skill, plugin, or prior chat context is required.

**Goal:** Replace the noisy Make It Real preview dashboard with a read-only Architecture Dossier that reads like SDK/API documentation and helps developers review module placement, responsibility boundaries, scenario flows, contract surfaces, human review decisions, and verification evidence without reading implementation code.

**Architecture:** Keep the preview as static, read-only HTML generated from canonical Make It Real artifacts. Extend the existing `systemDossier` model with review-oriented architecture fields, then render a single-column documentation page using lightweight internal primitives inspired by AI Elements patterns: schema display, file tree, workflow graph fallback, test results, sources, and code blocks. Runtime state, Kanban, raw artifacts, and engine details move into a collapsed Diagnostics section.

**Tech Stack:** Node ESM, Make It Real design-pack artifacts, static HTML/CSS/JS, Mermaid, Node test runner.

---

## Scope

This plan changes only the generated preview/reference surface. It does not change orchestration, Claude native Task launching, hooks, plugin installation, marketplace packaging, or agent execution semantics.

The output remains read-only. The browser may show source links and copyable snippets, but it must not approve, launch, retry, reconcile, mutate Kanban state, or call `makeitreal-engine` from browser JavaScript.

## External Patterns To Borrow

Use AI Elements as a pattern reference, not as a runtime dependency.

- `Schema Display`: API/function contract surface layout with parameters, request/response body, nested properties, required flags, and errors.
- `File Tree`: owned paths, changed files, and evidence artifacts as hierarchical paths instead of comma-separated strings.
- `Workflow`: node/edge visualization for scenarios that become hard to read in Mermaid, especially branch, parallel, retry, or compensation flows.
- `Test Results`: pass/fail/skip evidence display without progress bars, scores, or animated running state.
- `Sources`: compact citation/source block for `prd.json`, `design-pack.json`, `work-items/*.json`, `contracts/*.json`, and evidence files.
- `Code Block`: usage snippets and command evidence with filename/language labels.

Do not borrow chat, prompt input, toolbar edit/delete, streaming shimmer, or mutating attachment controls.

## File Structure

- Modify: `src/domain/system-dossier.mjs`
  - Owns derived Architecture Dossier data.
  - Add system placement, scenario index/details, review decisions, source references, schema surfaces, owned file trees, and verification evidence summary helpers.

- Modify: `src/preview/preview-model.mjs`
  - Owns the preview model passed to the renderer.
  - Preserve existing fields while exposing the new `blueprint.systemDossier` shape.

- Modify: `src/preview/render-dashboard-html.mjs`
  - Owns generated static HTML, CSS, and browser JS.
  - Rename the user-facing surface to Architecture Dossier.
  - Replace three-column dashboard layout and numeric cards with single-column documentation flow.
  - Add internal rendering primitives for schema display, file tree, sources, test results, workflow graph, scenarios, and diagnostics.

- Modify: `test/preview.test.mjs`
  - Owns regression tests for preview model and rendered HTML/CSS/JS.
  - Add tests for the new information architecture and negative tests to prevent dashboard/KPI/runtime-first regressions.

- Modify: `README.md`
  - Update dashboard wording to Architecture Dossier / Blueprint Reference.
  - Clarify that the browser surface is read-only and review-oriented.

- Modify: `docs/architecture.md`
  - Document the preview/dossier contract and the diagnostics boundary.

Do not create new runtime dependencies. Do not add React, Vite, AI Elements, React Flow, or shadcn to this static preview tranche.

---

### Task 1: Lock The Architecture Dossier Acceptance Tests First

**Files:**
- Modify: `test/preview.test.mjs`

- [ ] **Step 1: Add a regression test for single-column Architecture Dossier IA**

Append this test after the existing multi-module preview test:

```js
test("preview renders an Architecture Dossier instead of a dashboard", async () => {
  await withFixture(async ({ runDir }) => {
    await addMultiModuleSystemDossierFixture(runDir);
    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);

    const html = await readFile(path.join(runDir, "preview", "index.html"), "utf8");

    for (const label of [
      "Architecture Dossier",
      "System Placement",
      "Responsibility Map",
      "Scenario Index",
      "Contract Surfaces",
      "Module References",
      "Review Decisions",
      "Verification Evidence",
      "Diagnostics"
    ]) {
      assert.match(html, new RegExp(label));
    }

    assert.doesNotMatch(html, /<div class="reference-grid"/);
    assert.doesNotMatch(html, /data-live-module-count/);
    assert.doesNotMatch(html, /data-live-contract-count/);
    assert.doesNotMatch(html, /data-live-edge-count/);
    assert.doesNotMatch(html, /<aside class="runtime-rail/);
    assert.doesNotMatch(html, /<h3>Kanban<\/h3>/);
    assert.match(html, /<details class="diagnostics-panel"/);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "Architecture Dossier instead of a dashboard"
```

Expected:

```text
not ok ... preview renders an Architecture Dossier instead of a dashboard
```

The failure should mention missing `Architecture Dossier` or still-present dashboard classes such as `reference-grid` / `runtime-rail`.

- [ ] **Step 3: Add a regression test for AI Elements-inspired primitives**

Append this test after the previous test:

```js
test("preview renders documentation primitives for schemas files sources workflows and evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await addMultiModuleSystemDossierFixture(runDir);
    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);

    const html = await readFile(path.join(runDir, "preview", "index.html"), "utf8");

    for (const label of [
      "schema-display",
      "file-tree",
      "sources-list",
      "test-results",
      "workflow-graph",
      "code-block"
    ]) {
      assert.match(html, new RegExp(label));
    }

    assert.match(html, /POST \/auth\/login/);
    assert.match(html, /requestBody/);
    assert.match(html, /AuthSessionResult/);
    assert.match(html, /api\/src\/auth/);
    assert.match(html, /design-pack\.json/);
    assert.match(html, /prd\.json/);
    assert.match(html, /contracts\/auth-login\.openapi\.json/);
  });
});
```

- [ ] **Step 4: Run the primitive test and verify it fails**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "documentation primitives"
```

Expected:

```text
not ok ... preview renders documentation primitives for schemas files sources workflows and evidence
```

The current renderer should not yet emit the primitive class names.

---

### Task 2: Extend The System Dossier Model

**Files:**
- Modify: `src/domain/system-dossier.mjs`
- Test: `test/preview.test.mjs`

- [ ] **Step 1: Add model assertions for the new dossier fields**

Inside the existing `preview renders a multi-module system Blueprint dossier` test, after `const dossier = previewModel.blueprint.systemDossier;`, add:

```js
assert.equal(dossier.systemPlacement.title, "Authentication vertical slice");
assert.deepEqual(dossier.systemPlacement.modules.map((module) => module.moduleName), ["Auth UI", "Auth Service"]);
assert.equal(dossier.scenarioIndex[0].title, "Login session creation");
assert.equal(dossier.scenarioIndex[0].visualizationKind, "mermaid");
assert.equal(dossier.scenarioDetails[0].participants.includes("Auth UI"), true);
assert.equal(dossier.reviewDecisions.some((decision) => decision.includes("Auth UI")), true);
assert.equal(dossier.sources.some((source) => source.path === "design-pack.json"), true);
assert.equal(dossier.modules[0].ownedFileTree.name, "web");
assert.equal(dossier.contractSurfaces.some((surface) => surface.name === "POST /auth/login"), true);
```

- [ ] **Step 2: Run the model assertion and verify it fails**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "multi-module system Blueprint dossier"
```

Expected:

```text
not ok ... TypeError: Cannot read properties of undefined
```

The failure should be for `systemPlacement`, `scenarioIndex`, `sources`, `ownedFileTree`, or `contractSurfaces`.

- [ ] **Step 3: Add pure helper functions to `src/domain/system-dossier.mjs`**

Add these helpers above `export function buildSystemDossier`:

```js
function fileTreeFromPaths(paths = []) {
  const root = { name: "root", type: "folder", children: [] };
  for (const pathValue of uniqueText(paths)) {
    const parts = pathValue.split("/").filter(Boolean);
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      const type = index === parts.length - 1 && !part.endsWith("**") ? "file" : "folder";
      let child = cursor.children.find((candidate) => candidate.name === part);
      if (!child) {
        child = { name: part, type, children: [] };
        cursor.children.push(child);
      }
      cursor = child;
    }
  }
  return root.children.length === 1 ? root.children[0] : root;
}

function modelSystemPlacement({ prd, moduleInterfaces, dependencyEdges }) {
  return {
    title: prd.title,
    summary: (prd.userVisibleBehavior ?? [])[0] ?? "",
    modules: moduleInterfaces.map((moduleInterface) => ({
      responsibilityUnitId: moduleInterface.responsibilityUnitId,
      moduleName: moduleInterface.moduleName,
      purpose: moduleInterface.purpose ?? "",
      owner: moduleInterface.owner ?? null
    })),
    edges: dependencyEdges.map((edge) => ({
      from: edge.from,
      fromLabel: edge.fromLabel,
      to: edge.to,
      toLabel: edge.toLabel,
      contractId: edge.contractId,
      surface: edge.surface ?? null
    }))
  };
}

function scenarioVisualizationKind(sequence = {}) {
  if (["workflow", "mermaid", "text"].includes(sequence.visualization?.kind)) {
    return sequence.visualization.kind;
  }
  const labels = (sequence.messages ?? []).map((message) => String(message.label ?? "").toLowerCase());
  const hasBranch = labels.some((label) => /branch|parallel|retry|compensat|failure|error/.test(label));
  return hasBranch || (sequence.messages ?? []).length > 7 ? "workflow" : "mermaid";
}

function modelScenarioIndex(sequences = []) {
  return sequences.map((sequence, index) => ({
    id: sequence.id ?? `scenario-${index + 1}`,
    title: sequence.title ?? `Scenario ${index + 1}`,
    visualizationKind: scenarioVisualizationKind(sequence),
    participants: sequence.participants ?? [],
    messageCount: (sequence.messages ?? []).length
  }));
}

function modelScenarioDetails(sequences = []) {
  return sequences.map((sequence, index) => ({
    id: sequence.id ?? `scenario-${index + 1}`,
    title: sequence.title ?? `Scenario ${index + 1}`,
    visualizationKind: scenarioVisualizationKind(sequence),
    participants: sequence.participants ?? [],
    messages: sequence.messages ?? [],
    steps: (sequence.messages ?? []).map((message, stepIndex) => ({
      index: stepIndex + 1,
      from: message.from,
      to: message.to,
      label: message.label
    }))
  }));
}

function modelReviewDecisions({ moduleInterfaces, contracts }) {
  const moduleDecisions = moduleInterfaces.map((moduleInterface) =>
    `Confirm ${moduleInterface.moduleName} is the sole owner of ${uniqueText(moduleInterface.owns ?? []).join(", ") || moduleInterface.responsibilityUnitId}.`
  );
  const contractDecisions = contracts
    .filter((contract) => contract.contractId)
    .map((contract) => `Confirm ${contract.contractId} is the complete cross-boundary contract for its consumers.`);
  return uniqueText([...moduleDecisions, ...contractDecisions]);
}

function modelSources({ contracts }) {
  return [
    { label: "PRD", path: "prd.json", kind: "prd" },
    { label: "Design Pack", path: "design-pack.json", kind: "design-pack" },
    { label: "Responsibility Units", path: "responsibility-units.json", kind: "responsibility-units" },
    ...contracts
      .filter((contract) => contract.path)
      .map((contract) => ({ label: contract.contractId, path: contract.path, kind: contract.kind }))
  ];
}

function modelContractSurfaces(moduleInterfaces = []) {
  return moduleInterfaces.flatMap((moduleInterface) =>
    (moduleInterface.publicSurfaces ?? []).map((surface) => ({
      moduleName: moduleInterface.moduleName,
      responsibilityUnitId: moduleInterface.responsibilityUnitId,
      name: surface.name,
      kind: surface.kind,
      description: surface.description ?? "",
      contractIds: surface.contractIds ?? [],
      signature: surface.signature
    }))
  );
}
```

- [ ] **Step 4: Update `buildSystemDossier` to expose the new fields**

Replace the body of `buildSystemDossier` with:

```js
export function buildSystemDossier({ prd, designPack, responsibilityUnits }) {
  const contracts = modelContracts(designPack.apiSpecs ?? []);
  const moduleInterfaces = modelModuleInterfaces({ designPack, responsibilityUnits });
  const dependencyEdges = modelDependencyEdges({ designPack, contracts });
  const modules = moduleInterfaces.map((moduleInterface) => ({
    responsibilityUnitId: moduleInterface.responsibilityUnitId,
    moduleName: moduleInterface.moduleName,
    owner: moduleInterface.owner,
    purpose: moduleInterface.purpose,
    owns: moduleInterface.owns,
    ownedFileTree: fileTreeFromPaths(moduleInterface.owns),
    publicSurfaces: moduleInterface.publicSurfaces,
    imports: moduleInterface.imports
  }));

  return {
    title: prd.title,
    summary: prd.userVisibleBehavior ?? [],
    goals: prd.goals ?? [],
    modules,
    systemPlacement: modelSystemPlacement({ prd, moduleInterfaces, dependencyEdges }),
    dependencyEdges,
    contractMatrix: modelContractMatrix({ designPack, contracts, moduleInterfaces }),
    contractSurfaces: modelContractSurfaces(moduleInterfaces),
    scenarioIndex: modelScenarioIndex(designPack.sequences ?? []),
    scenarioDetails: modelScenarioDetails(designPack.sequences ?? []),
    signalFlows: designPack.sequences ?? [],
    callStacks: designPack.callStacks ?? [],
    stateTransitions: designPack.stateFlow?.transitions ?? [],
    reviewDecisions: modelReviewDecisions({ moduleInterfaces, contracts }),
    sources: modelSources({ contracts }),
    deliveryScope: {
      ownedPaths: uniqueText((designPack.responsibilityBoundaries ?? []).flatMap((boundary) => boundary.owns ?? [])),
      responsibilityUnitIds: uniqueText((designPack.responsibilityBoundaries ?? []).map((boundary) => boundary.responsibilityUnitId)),
      acceptanceCriteriaIds: (prd.acceptanceCriteria ?? []).map((criterion) => criterion.id ?? "AC")
    },
    designPatterns: [
      {
        name: "Contract-first responsibility boundary",
        rationale: "Adjacent modules may rely only on declared public surfaces and contract IDs."
      },
      {
        name: "Fail-fast contract mismatch",
        rationale: "Undeclared IO, imports, or fallback behavior must revise the Blueprint instead of being hidden in implementation."
      }
    ]
  };
}
```

- [ ] **Step 5: Run the model test and verify it passes**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "multi-module system Blueprint dossier"
```

Expected:

```text
ok ... preview renders a multi-module system Blueprint dossier
```

---

### Task 3: Add Static Documentation Primitives

**Files:**
- Modify: `src/preview/render-dashboard-html.mjs`
- Test: `test/preview.test.mjs`

- [ ] **Step 1: Add `renderSourcesList`**

Add this function near the existing renderer helper functions:

```js
function renderSourcesList(sources = []) {
  if (sources.length === 0) {
    return '<p class="empty">No source artifacts declared.</p>';
  }
  return `<div class="sources-list">${sources.map((source) => `<div class="source-item">
    <strong>${escapeHtml(source.label ?? source.path)}</strong>
    <code>${escapeHtml(source.path)}</code>
    <span>${escapeHtml(source.kind ?? "source")}</span>
  </div>`).join("")}</div>`;
}
```

- [ ] **Step 2: Add `renderFileTree`**

Add:

```js
function renderFileTreeNode(node, depth = 0) {
  if (!node) {
    return "";
  }
  const children = node.children ?? [];
  const prefix = node.type === "folder" ? "dir" : "file";
  return `<li class="file-tree-node ${escapeHtml(prefix)}" style="--depth:${depth}">
    <span>${escapeHtml(node.name)}</span>
    ${children.length > 0 ? `<ul>${children.map((child) => renderFileTreeNode(child, depth + 1)).join("")}</ul>` : ""}
  </li>`;
}

function renderFileTree(tree) {
  if (!tree) {
    return '<p class="empty">No owned paths declared.</p>';
  }
  return `<ul class="file-tree">${renderFileTreeNode(tree)}</ul>`;
}
```

- [ ] **Step 3: Add `renderSchemaDisplay`**

Add:

```js
function renderSchemaFields(title, fields = []) {
  if (fields.length === 0) {
    return "";
  }
  return `<section class="schema-section">
    <h4>${escapeHtml(title)}</h4>
    <div class="schema-fields">${fields.map((field) => `<div class="schema-field">
      <code>${escapeHtml(field.name ?? field.code ?? "field")}</code>
      <span>${escapeHtml(field.type ?? field.when ?? "")}</span>
      ${field.required ? "<strong>required</strong>" : ""}
      <p>${escapeHtml(field.description ?? field.handling ?? "")}</p>
    </div>`).join("")}</div>
  </section>`;
}

function renderSchemaDisplay(surface) {
  const signature = surface.signature ?? { inputs: [], outputs: [], errors: [] };
  return `<article class="schema-display">
    <header>
      <span>${escapeHtml(surface.kind ?? "surface")}</span>
      <code>${escapeHtml(surface.name)}</code>
    </header>
    ${surface.description ? `<p>${escapeHtml(surface.description)}</p>` : ""}
    ${renderSchemaFields("Parameters", signature.inputs ?? [])}
    ${renderSchemaFields("Returns", signature.outputs ?? [])}
    ${renderSchemaFields("Errors", signature.errors ?? [])}
  </article>`;
}
```

- [ ] **Step 4: Add `renderTestResults`**

Add:

```js
function evidenceStatus(item = {}) {
  if (item.ok === true) {
    return "passed";
  }
  if (item.ok === false) {
    return "failed";
  }
  return "skipped";
}

function renderTestResults(evidence = []) {
  if (evidence.length === 0) {
    return '<p class="empty">No verification evidence recorded yet.</p>';
  }
  return `<div class="test-results">${evidence.map((item) => {
    const status = evidenceStatus(item);
    return `<div class="test-result ${escapeHtml(status)}">
      <strong>${escapeHtml(item.kind ?? "evidence")}</strong>
      <span>${escapeHtml(status)}</span>
      <p>${escapeHtml(item.summary ?? "")}</p>
      ${item.path ? `<code>${escapeHtml(item.path)}</code>` : ""}
    </div>`;
  }).join("")}</div>`;
}
```

- [ ] **Step 5: Add `renderWorkflowGraph` and scenario helpers**

Add:

```js
function renderWorkflowGraph(scenario) {
  const steps = scenario.steps ?? [];
  if (steps.length === 0) {
    return '<p class="empty">No workflow steps declared.</p>';
  }
  return `<div class="workflow-graph">${steps.map((step, index) => `<div class="workflow-node">
    <span>${index + 1}</span>
    <strong>${escapeHtml(step.from)} -> ${escapeHtml(step.to)}</strong>
    <p>${escapeHtml(step.label)}</p>
  </div>`).join("")}</div>`;
}

function renderScenarioVisualization(scenario) {
  if (scenario.visualizationKind === "workflow") {
    return renderWorkflowGraph(scenario);
  }
  return mermaidDiagramCard({
    title: scenario.title,
    description: "Scenario sequence generated from declared participants and messages.",
    diagram: sequenceMermaid([{
      title: scenario.title,
      participants: scenario.participants,
      messages: scenario.messages
    }])
  });
}

function renderScenarioIndex(scenarios = []) {
  if (scenarios.length === 0) {
    return '<p class="empty">No scenarios declared.</p>';
  }
  return `<ol class="scenario-index">${scenarios.map((scenario) => `<li>
    <a href="#${escapeHtml(anchorSlug(scenario.id, "scenario"))}">${escapeHtml(scenario.title)}</a>
    <span>${escapeHtml(scenario.visualizationKind)}</span>
  </li>`).join("")}</ol>`;
}

function renderScenarioDetails(scenarios = []) {
  if (scenarios.length === 0) {
    return '<p class="empty">No scenario details declared.</p>';
  }
  return scenarios.map((scenario) => `<article id="${escapeHtml(anchorSlug(scenario.id, "scenario"))}" class="scenario-reference">
    <h3>${escapeHtml(scenario.title)}</h3>
    <p><code>${escapeHtml((scenario.participants ?? []).join(" -> "))}</code></p>
    ${renderScenarioVisualization(scenario)}
    <ol class="scenario-steps">${(scenario.steps ?? []).map((step) => `<li>
      <strong>${escapeHtml(step.from)} -> ${escapeHtml(step.to)}</strong>
      <p>${escapeHtml(step.label)}</p>
    </li>`).join("")}</ol>
  </article>`).join("");
}
```

- [ ] **Step 6: Run primitive test and confirm it still fails only because sections are not wired**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "documentation primitives"
```

Expected:

```text
not ok ... documentation primitives
```

The primitive functions exist but are not yet called by `renderDashboardHtml`.

---

### Task 4: Replace Dashboard Layout With Single-Column Architecture Dossier

**Files:**
- Modify: `src/preview/render-dashboard-html.mjs`
- Test: `test/preview.test.mjs`

- [ ] **Step 1: Add Architecture Dossier section renderers**

Add these functions before `export function renderDashboardHtml`:

```js
function renderSystemPlacement(dossier = {}) {
  const placement = dossier.systemPlacement ?? {};
  return `<section id="system-placement" class="dossier-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Architecture</p>
        <h2>System Placement</h2>
      </div>
    </div>
    <p class="section-note">${escapeHtml(placement.summary ?? "")}</p>
    ${mermaidDiagramCard({
      title: "Module Placement",
      description: "Declared module placement and cross-boundary contracts.",
      diagram: systemMapMermaid(dossier)
    })}
  </section>`;
}

function renderResponsibilityMap(dossier = {}) {
  return `<section id="responsibility-map" class="dossier-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Boundaries</p>
        <h2>Responsibility Map</h2>
      </div>
    </div>
    <div class="responsibility-map">${(dossier.modules ?? []).map((module) => `<article class="responsibility-unit">
      <h3>${escapeHtml(module.moduleName)}</h3>
      <p>${escapeHtml(module.purpose ?? "Declared responsibility unit.")}</p>
      <h4>Owned paths</h4>
      ${renderFileTree(module.ownedFileTree)}
    </article>`).join("")}</div>
  </section>`;
}

function renderContractSurfaces(dossier = {}) {
  return `<section id="contract-surfaces" class="dossier-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Contracts</p>
        <h2>Contract Surfaces</h2>
      </div>
    </div>
    <div class="schema-display-list">${(dossier.contractSurfaces ?? []).map(renderSchemaDisplay).join("")}</div>
  </section>`;
}

function renderReviewDecisions(dossier = {}) {
  const decisions = dossier.reviewDecisions ?? [];
  return `<section id="review-decisions" class="dossier-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Review</p>
        <h2>Review Decisions</h2>
      </div>
    </div>
    ${decisions.length === 0 ? '<p class="empty">No explicit review decisions derived.</p>' : `<ol class="review-decisions">${decisions.map((decision) => `<li>${escapeHtml(decision)}</li>`).join("")}</ol>`}
  </section>`;
}

function renderScenariosReference(dossier = {}) {
  return `<section id="scenarios" class="dossier-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Scenarios</p>
        <h2>Scenario Reference</h2>
      </div>
    </div>
    ${renderScenarioIndex(dossier.scenarioIndex ?? [])}
    ${renderScenarioDetails(dossier.scenarioDetails ?? [])}
  </section>`;
}

function renderSourcesSection(dossier = {}) {
  return `<section id="sources" class="dossier-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Traceability</p>
        <h2>Sources</h2>
      </div>
    </div>
    ${renderSourcesList(dossier.sources ?? [])}
  </section>`;
}
```

- [ ] **Step 2: Replace the body layout in `renderDashboardHtml`**

Replace the current `<main class="dossier-shell">...</main>` body with this layout:

```js
  <main class="architecture-shell">
    ${renderDossierNav(dossier)}

    <article class="architecture-main">
      <header id="overview" class="architecture-hero">
        <p class="eyebrow">Make It Real Architecture Dossier</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="summary-line">${escapeHtml(primarySummary)}</p>
        <p class="source-line"><code>${escapeHtml(model.run.prdId)} · ${escapeHtml(model.run.workItemId)} · generated ${escapeHtml(model.generatedAt)}</code></p>
      </header>

      ${renderSystemPlacement(dossier)}
      ${renderResponsibilityMap(dossier)}
      ${renderScenariosReference(dossier)}
      ${renderContractSurfaces(dossier)}

      <section id="modules" class="dossier-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Reference</p>
            <h2>Module References</h2>
          </div>
        </div>
        ${renderModuleReference(dossier.modules)}
      </section>

      ${renderReviewDecisions(dossier)}

      <section id="evidence" class="dossier-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Proof</p>
            <h2>Verification Evidence</h2>
          </div>
        </div>
        <h3>Acceptance Criteria</h3>
        ${renderAcceptance(blueprint.acceptanceCriteria)}
        <h3>Evidence</h3>
        ${renderTestResults(model.status.evidenceSummary)}
      </section>

      ${renderSourcesSection(dossier)}

      <section id="diagnostics" class="dossier-section">
        ${renderDeveloperDiagnostics(model, model.status)}
        ${renderOperatorCockpit(model.operatorCockpit, model.board, model.status)}
      </section>
    </article>
  </main>
```

- [ ] **Step 3: Update `renderDossierNav` labels**

Change `renderDossierNav` so it returns:

```js
function renderDossierNav(dossier = {}) {
  return `<nav class="dossier-nav architecture-nav" aria-label="Architecture Dossier sections">
    <p class="eyebrow">Make It Real</p>
    <strong>Architecture Dossier</strong>
    <label class="nav-filter">
      <span>Filter reference</span>
      <input type="search" data-nav-filter placeholder="Module, surface, contract">
    </label>
    <a href="#overview" class="active">Overview</a>
    <a href="#system-placement">System Placement</a>
    <a href="#responsibility-map">Responsibility Map</a>
    <a href="#scenarios">Scenarios</a>
    <a href="#contract-surfaces">Contract Surfaces</a>
    <a href="#modules">Module References</a>
    ${renderModuleNav(dossier)}
    <a href="#review-decisions">Review Decisions</a>
    <a href="#evidence">Evidence</a>
    <a href="#sources">Sources</a>
    <a href="#diagnostics">Diagnostics</a>
  </nav>`;
}
```

- [ ] **Step 4: Run the Architecture Dossier IA test**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "Architecture Dossier instead of a dashboard"
```

Expected:

```text
ok ... preview renders an Architecture Dossier instead of a dashboard
```

---

### Task 5: Replace Dashboard CSS With Documentation CSS

**Files:**
- Modify: `src/preview/render-dashboard-html.mjs`
- Test: `test/preview.test.mjs`

- [ ] **Step 1: Add CSS assertions**

In `preview renders an Architecture Dossier instead of a dashboard`, after reading `html`, add:

```js
const css = await readFile(path.join(runDir, "preview", "preview.css"), "utf8");
assert.match(css, /\.architecture-shell/);
assert.match(css, /\.architecture-main/);
assert.match(css, /\.schema-display/);
assert.match(css, /\.file-tree/);
assert.match(css, /\.sources-list/);
assert.match(css, /\.test-results/);
assert.match(css, /\.workflow-graph/);
assert.doesNotMatch(css, /grid-template-columns: minmax\(220px, 260px\) minmax\(0, 1fr\) minmax\(300px, 340px\)/);
assert.doesNotMatch(css, /\.runtime-rail/);
```

- [ ] **Step 2: Run the test and verify CSS assertions fail**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "Architecture Dossier instead of a dashboard"
```

Expected:

```text
not ok ... Missing expected pattern: /\.architecture-shell/
```

- [ ] **Step 3: Add documentation CSS**

Inside `renderDashboardCss`, add these rules after the existing shared typography rules:

```css
.architecture-shell {
  display: grid;
  grid-template-columns: minmax(210px, 250px) minmax(0, 920px);
  gap: 22px;
  max-width: 1240px;
  margin: 0 auto;
  padding: 22px;
}

.architecture-main {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.architecture-hero {
  border-bottom: 1px solid var(--line);
  padding: 10px 0 20px;
}

.architecture-hero h1 {
  max-width: 880px;
}

.source-line {
  color: var(--muted);
}

.schema-display-list,
.responsibility-map,
.scenario-reference,
.test-results,
.sources-list {
  display: grid;
  gap: 12px;
}

.schema-display,
.responsibility-unit,
.scenario-reference,
.test-result,
.source-item {
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  background: var(--panel);
  padding: 14px;
}

.schema-display header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  border-bottom: 1px solid var(--soft-line);
  margin: -14px -14px 12px;
  padding: 10px 14px;
  background: var(--soft);
}

.schema-display header span,
.scenario-index span,
.test-result span,
.source-item span {
  border: 1px solid var(--soft-line);
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.schema-section {
  margin-top: 12px;
}

.schema-fields {
  display: grid;
  gap: 6px;
}

.schema-field {
  display: grid;
  grid-template-columns: minmax(130px, .8fr) minmax(100px, .6fr) auto minmax(220px, 1.6fr);
  gap: 10px;
  align-items: start;
  border-top: 1px solid var(--soft-line);
  padding: 8px 0;
}

.schema-field p {
  margin: 0;
  color: var(--muted);
}

.file-tree {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 13px;
}

.file-tree ul {
  margin: 0;
  padding-left: 18px;
  list-style: none;
}

.file-tree-node > span::before {
  content: "file ";
  color: var(--muted);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
}

.file-tree-node.dir > span::before {
  content: "dir ";
}

.scenario-index {
  display: grid;
  gap: 8px;
  margin: 0 0 16px;
  padding-left: 20px;
}

.scenario-index li {
  padding: 6px 0;
}

.scenario-steps {
  display: grid;
  gap: 8px;
}

.workflow-graph {
  display: grid;
  gap: 8px;
  margin: 12px 0;
}

.workflow-node {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  border: 1px solid var(--soft-line);
  border-radius: 8px;
  padding: 10px;
  background: var(--soft);
}

.workflow-node > span {
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

.review-decisions {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 22px;
}

.test-result.passed span { color: var(--ok); }
.test-result.failed span { color: var(--bad); }
.test-result.skipped span { color: var(--warn); }

.source-item {
  display: grid;
  grid-template-columns: minmax(120px, .8fr) minmax(180px, 1.4fr) auto;
  gap: 10px;
  align-items: center;
}
```

- [ ] **Step 4: Remove or neutralize obsolete layout CSS**

Delete or leave unused but harmless old rules only if tests still pass. The important behavioral requirement is that the generated HTML no longer uses:

```html
<aside class="runtime-rail ...">
<div class="reference-grid" ...>
```

Do not spend time deleting every stale CSS selector unless it reduces test failures or confusion.

- [ ] **Step 5: Run the CSS test**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "Architecture Dossier instead of a dashboard"
```

Expected:

```text
ok ... preview renders an Architecture Dossier instead of a dashboard
```

---

### Task 6: Keep Runtime State In Diagnostics Only

**Files:**
- Modify: `src/preview/render-dashboard-html.mjs`
- Test: `test/preview.test.mjs`

- [ ] **Step 1: Add a runtime-boundary test**

Append:

```js
test("preview keeps Kanban and runtime state inside Diagnostics", async () => {
  await withFixture(async ({ runDir }) => {
    await addMultiModuleSystemDossierFixture(runDir);
    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);

    const html = await readFile(path.join(runDir, "preview", "index.html"), "utf8");
    const diagnosticsIndex = html.indexOf('id="diagnostics"');
    const kanbanIndex = html.indexOf("Run Status & Kanban");

    assert.notEqual(diagnosticsIndex, -1);
    assert.notEqual(kanbanIndex, -1);
    assert.equal(kanbanIndex > diagnosticsIndex, true);
    assert.doesNotMatch(html.slice(0, diagnosticsIndex), /Run Status & Kanban/);
    assert.doesNotMatch(html.slice(0, diagnosticsIndex), /data-live-kanban/);
    assert.doesNotMatch(html.slice(0, diagnosticsIndex), /copy-command/);
  });
});
```

- [ ] **Step 2: Run the runtime-boundary test**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs --test-name-pattern "runtime state inside Diagnostics"
```

Expected:

```text
ok ... preview keeps Kanban and runtime state inside Diagnostics
```

If it fails because `Run Status & Kanban` appears above Diagnostics, move `renderOperatorCockpit(...)` into the Diagnostics section only.

---

### Task 7: Update Live Refresh JavaScript For Removed Counter Cards

**Files:**
- Modify: `src/preview/render-dashboard-html.mjs`
- Test: `test/preview.test.mjs`

- [ ] **Step 1: Remove live counter update assertions**

In tests that currently assert these selectors, remove or replace them:

```js
data-live-module-count
data-live-contract-count
data-live-edge-count
data-live-verification-tile-label
data-live-verification-label
```

Keep assertions for:

```js
preview-model.json
updateRuntime
data-live-kanban
copy-command
```

because diagnostics still auto-refresh runtime state.

- [ ] **Step 2: Remove stale JS updates**

In the generated `preview.js` string inside `render-dashboard-html.mjs`, remove lines equivalent to:

```js
setTextAll("[data-live-module-count]", (dossier.modules ?? []).length);
setTextAll("[data-live-contract-count]", (dossier.contractMatrix ?? []).length);
setTextAll("[data-live-edge-count]", (dossier.dependencyEdges ?? []).length);
setTextAll("[data-live-verification-tile-label]", verificationTileLabel(model.status));
setTextAll("[data-live-verification-label]", verificationLabel(model.status));
```

- [ ] **Step 3: Run preview tests**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs
```

Expected:

```text
ok ...
```

---

### Task 8: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update README wording**

Search:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
rg -n "dashboard|Dashboard|Blueprint Reference|preview" README.md
```

Replace user-facing dashboard language with Architecture Dossier language. Add this paragraph near the preview/dashboard section:

```md
Make It Real renders a read-only Architecture Dossier for each run. The dossier is not a project-management dashboard. It is a software architecture review packet generated from `prd.json`, `design-pack.json`, `responsibility-units.json`, `work-items/*.json`, contracts, and evidence. It prioritizes system placement, responsibility boundaries, scenario references, contract surfaces, module references, review decisions, and verification evidence. Runtime status, Kanban, and raw artifacts are available only under Diagnostics.
```

- [ ] **Step 2: Update architecture docs**

Search:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
rg -n "dashboard|Dashboard|preview|Architecture Dossier" docs/architecture.md
```

Add this subsection to the preview/control-plane area:

```md
### Architecture Dossier Preview Contract

The generated browser preview is a read-only Architecture Dossier. It must help developers review a Blueprint without reading implementation code. The first-class sections are:

- Overview
- System Placement
- Responsibility Map
- Scenario Reference
- Contract Surfaces
- Module References
- Review Decisions
- Verification Evidence
- Sources
- Diagnostics

Diagnostics is the only place where runtime phase, Kanban, raw artifacts, current-run details, and next-command copy affordances appear. The main document must not present numeric dashboard cards, health scores, progress indicators, or mutating controls.
```

- [ ] **Step 3: Run docs grep check**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
rg -n "health score|progress score|data-live-module-count|runtime-rail" README.md docs/architecture.md src/preview/render-dashboard-html.mjs test/preview.test.mjs
```

Expected:

```text
```

No matches.

---

### Task 9: Run Full Verification

**Files:**
- No code edits in this task.

- [ ] **Step 1: Run focused preview tests**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node --test test/preview.test.mjs
```

Expected:

```text
ok ...
```

- [ ] **Step 2: Run full release check**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
npm run release:check
```

Expected:

```text
tests ... pass
```

The command should also render the canonical preview, run gates, verify evidence, sync wiki evidence, and reach Done for the canonical fixture.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
git diff --check
```

Expected:

```text
```

No output.

- [ ] **Step 4: Inspect generated preview manually**

Run:

```bash
cd /Users/eugene/Workspace/52g-tools/dev-harness
node bin/harness.mjs design render examples/canonical/.makeitreal/runs/feature-auth
```

Expected:

```json
{"command":"design render","ok":true,...}
```

Open:

```text
examples/canonical/.makeitreal/runs/feature-auth/preview/index.html
```

Confirm:

- The page title or first heading says `Architecture Dossier`.
- The body is single-column documentation, not card-heavy dashboard layout.
- System Placement and Scenario Reference are visible before runtime Diagnostics.
- Contract Surfaces use schema-display style.
- Owned paths use file-tree style.
- Sources list `prd.json`, `design-pack.json`, and contract files.
- Kanban appears only inside Diagnostics.

---

## Self-Review

Spec coverage:

- Architecture Dossier naming: Task 4 and Task 8.
- Single-column documentation layout: Task 4 and Task 5.
- Remove numeric dashboard cards: Task 1, Task 4, Task 7.
- System placement overview: Task 2 and Task 4.
- Scenario index with separate detailed scenarios: Task 2, Task 3, Task 4.
- Mermaid default plus workflow-style fallback: Task 2 and Task 3.
- Schema Display for contract surfaces: Task 3 and Task 4.
- File Tree for owned paths: Task 2, Task 3, Task 4.
- Sources/provenance: Task 2, Task 3, Task 4.
- Test Results style evidence without progress score: Task 3 and Task 4.
- Runtime/Kanban only in Diagnostics: Task 6.
- Documentation updates: Task 8.
- Full verification: Task 9.

Placeholder scan:

- No unresolved placeholder markers.
- No task-list stub markers.
- No deferred-implementation wording.
- No cross-task shortcut wording.
- No undefined function names in snippets; all new renderer/model helper names are defined before use in this plan.

Type consistency:

- `systemPlacement`, `scenarioIndex`, `scenarioDetails`, `reviewDecisions`, `sources`, `contractSurfaces`, and `ownedFileTree` are added in `buildSystemDossier`.
- Renderer helpers consume the exact model field names defined in Task 2.
- Test assertions use the same field names as the model and renderer snippets.
