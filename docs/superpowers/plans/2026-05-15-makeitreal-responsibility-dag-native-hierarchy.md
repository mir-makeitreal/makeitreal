# Make It Real Responsibility DAG Native Hierarchy Implementation Plan

> **For agentic workers:** This plan is self-contained. Execute it task-by-task from the repository files and commands listed below; no external skill, plugin, or prior chat context is required.

**Goal:** Replace Make It Real's primary-work-item execution authority with a graph-wide responsibility DAG that drives Blueprint approval, native Claude Code Task packets, scoped hooks, graph-wide gates, Architecture Dossier review, and Done evidence.

**Architecture:** Add one canonical `work-item-dag.json` artifact, validate it against `board.workItems[]`, and make every Ready/Done decision iterate required DAG nodes instead of using `findPrimaryWorkItem()` authority. Keep the existing engine, board, gates, hooks, and native `nativeTasks[]` path; add conservative decomposition, native packet persistence, explicit reviewer-role mapping, node-kind lifecycle rules, and Dossier sections that show approval scope, dependency graph, task DAG, and worker topology.

**Tech Stack:** Node ESM, Node test runner, Make It Real JSON artifacts, Claude Code plugin skill markdown, static Architecture Dossier HTML/CSS/JS.

---

## Current Problem

The current harness has strong primitives:

- PRD and design-pack validation.
- Responsibility unit and contract checks.
- `nativeTasks[]` launch for unblocked Ready work.
- Pre-tool hook path enforcement.
- Parent-session native Task provenance checks.
- Reviewer evidence and verification evidence.

The remaining defect is authority drift:

- `src/plan/plan-generator.mjs` still generates one primary `workItem`.
- `src/gates/index.mjs` loads `findPrimaryWorkItem()` and validates one item.
- `src/orchestrator/orchestrator.mjs` promotes the primary item through Ready.
- `board.workItemDAG` exists as a small projection, not a canonical artifact.
- Architecture Dossier does not yet show graph-wide approval scope or worker topology.
- Launch skill text still permits reviewer-type generic fallback.
- Native/project-root semantics are not fully separated from legacy `.makeitreal/workspaces`.

This plan implements the approved design in [2026-05-15-makeitreal-responsibility-dag-native-hierarchy-design.md](../specs/2026-05-15-makeitreal-responsibility-dag-native-hierarchy-design.md).

---

## File Map

Create:

- `src/domain/work-item-dag.mjs`
  - Owns loading, validation, graph/board parity checks, topological ordering, required-node selection, path-overlap detection, and projection to `board.workItemDAG`.

- `src/plan/responsibility-decomposer.mjs`
  - Owns deterministic conversion from request/profile/allowed paths into responsibility units, module interfaces, work items, and DAG nodes/edges.

- `src/orchestrator/native-packets.mjs`
  - Owns persisted zero-context native Task packets and packet validation.

- `src/orchestrator/native-role-mapping.mjs`
  - Owns `native-role-mapping.json`, evidence role mapping validation, and report metadata persistence rules.

- `test/work-item-dag.test.mjs`
  - Graph schema, parity, path overlap, topological order, and required-node tests.

- `test/native-packets.test.mjs`
  - Packet validation and project-root/workspace rejection tests.

- `test/native-role-mapping.test.mjs`
  - Reviewer mapping validation and no generic fallback tests.

Modify:

- `src/domain/artifacts.mjs`
  - Load `work-item-dag.json` and expose graph-aware helpers.

- `src/blueprint/fingerprint.mjs`
  - Include `work-item-dag.json` in Blueprint fingerprints.

- `src/plan/plan-generator.mjs`
  - Replace one-off work item assembly with decomposer output.
  - Write `work-item-dag.json`.
  - Generate `board.workItemDAG` from canonical graph projection.

- `src/gates/index.mjs`
  - Replace primary-item Ready/Done validation with graph-wide validation.

- `src/status/board-status.mjs`
  - Report launchable graph nodes from graph-aware Ready state.

- `src/status/operator-summary.mjs`
  - Summarize graph blockers without exposing raw internals.

- `src/orchestrator/orchestrator.mjs`
  - Promote all graph-eligible nodes.
  - Return `nativeTasks[]` with packet paths, hook context, and reviewer assignments.

- `src/orchestrator/board-completion.mjs`
  - Apply node-kind lifecycle rules and graph-wide Done conditions.

- `src/orchestrator/review-evidence.mjs`
  - Persist `evidenceRole`, `nativeSubagentType`, and `mappingSource`.

- `src/orchestrator/dynamic-role-handoff.mjs`
  - Align report schemas with persisted packet definitions.

- `hooks/claude/pre-tool-use.mjs`
  - Add hook-input carrier support and scoped read checks.

- `hooks/claude/stop.mjs`
  - Use graph-wide Done gate results.

- `src/project/run-state.mjs`
  - Add `enforcement: "attached" | "detached"` current-run state.

- `src/domain/system-dossier.mjs`
  - Add approval scope, task DAG, worker topology, and dependency graph projections.

- `src/preview/preview-model.mjs`
  - Include graph-aware Dossier fields.

- `src/preview/render-dashboard-html.mjs`
  - Render Approval Scope, Task DAG, Worker Topology, graph-aware module pages, and diagnostics.

- `plugins/makeitreal/skills/launch/SKILL.md`
- `plugins/mir/skills/launch/SKILL.md`
- `plugins/makeitreal/commands/launch.md`
- `plugins/mir/commands/launch.md`
  - Remove generic reviewer fallback wording.
  - Require native packet/role mapping validation and project-root native edits.

- `docs/architecture.md`
- `docs/claude-code-runner.md`
  - Document canonical DAG, native hierarchy, hook scope carrier, role mapping, and workspace semantics.

Existing tests to extend:

- `test/plan-generator.test.mjs`
- `test/gates-cli.test.mjs`
- `test/blueprint-gates.test.mjs`
- `test/board-status-audit.test.mjs`
- `test/orchestrator.test.mjs`
- `test/board-completion.test.mjs`
- `test/claude-hooks.test.mjs`
- `test/preview.test.mjs`
- `test/makeitreal-plugin.test.mjs`
- `test/prompt-discipline.test.mjs`
- `test/e2e.test.mjs`
- `test/phase2-e2e.test.mjs`

Do not modify:

- Marketplace identity.
- Public command surface.
- Browser mutation controls.
- Legacy scripted simulator behavior except to mark it as legacy-only.

---

## Design Contract

Implementation must preserve these invariants:

1. `work-item-dag.json` is the canonical DAG artifact.
2. `board.workItemDAG` is a projection regenerated from `work-item-dag.json`.
3. `designPack.workItemId` is display/backward-compatibility metadata, not graph-aware gate authority.
4. One-node work is still represented by the same DAG schema.
5. Ready and Done gates iterate all `requiredForDone` nodes.
6. Native launch returns only `nativeTasks[]`.
7. Every native Task has a persisted packet.
8. Every native Task has hook-visible scope.
9. Missing reviewer role mapping fails before launch.
10. No generic reviewer fallback appears in plugin skills or command docs.
11. Native attempts edit the project root, not `.makeitreal/workspaces`.
12. PM nodes, when present, are read-only coordination nodes.
13. Child work that broadens scope invalidates Blueprint approval and requires revision.
14. Dossier shows approval scope, graph topology, contracts, module pages, and evidence.
15. Tests and docs must not claim unit tests alone prove integration unless graph-level contract evidence exists.

## Commit Protocol For This Plan

Each task ends with a commit checkpoint. The one-line intent text shown in the
task is a suggested first line only. Use the repository Lore commit protocol for
every checkpoint: include a short body, relevant `Constraint:` and `Rejected:`
trailers when they add value, `Confidence:`, `Scope-risk:`, `Tested:`, and
`Not-tested:`. Do not add external co-author trailers unless the human explicitly
asks for them.

---

## Task 1: Lock Canonical DAG Tests

**Files:**
- Create: `test/work-item-dag.test.mjs`
- Create: `src/domain/work-item-dag.mjs`

- [ ] **Step 1: Write failing tests for canonical DAG validation**

Create `test/work-item-dag.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectBoardDag,
  requiredDagNodeIds,
  topologicalDagNodeIds,
  validateWorkItemDag
} from "../src/domain/work-item-dag.mjs";

const workItems = [
  {
    id: "work.orders-repository",
    responsibilityUnitId: "ru.orders-repository",
    allowedPaths: ["src/data/orders/**"],
    contractIds: ["contract.orders.persistence"],
    dependsOn: [],
    doneEvidence: [{ kind: "verification", path: "evidence/work.orders-repository.verification.json" }],
    verificationCommands: [{ file: "node", args: ["--test"] }]
  },
  {
    id: "work.orders-api",
    responsibilityUnitId: "ru.orders-api",
    allowedPaths: ["src/api/orders/**"],
    contractIds: ["contract.orders.create"],
    dependencyContracts: [{
      contractId: "contract.orders.persistence",
      providerResponsibilityUnitId: "ru.orders-repository",
      surface: "OrdersRepository.create",
      allowedUse: "Use repository contract only."
    }],
    dependsOn: ["work.orders-repository"],
    doneEvidence: [{ kind: "verification", path: "evidence/work.orders-api.verification.json" }],
    verificationCommands: [{ file: "node", args: ["--test"] }]
  }
];

const dag = {
  schemaVersion: "1.0",
  runId: "feature-orders",
  nodes: [
    {
      id: "work.orders-repository",
      kind: "implementation",
      responsibilityUnitId: "ru.orders-repository",
      requiredForDone: true
    },
    {
      id: "work.orders-api",
      kind: "implementation",
      responsibilityUnitId: "ru.orders-api",
      requiredForDone: true
    }
  ],
  edges: [{
    from: "work.orders-repository",
    to: "work.orders-api",
    contractId: "contract.orders.persistence"
  }]
};

test("validates DAG and board parity", () => {
  const result = validateWorkItemDag({ dag, workItems });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects missing work item for DAG node", () => {
  const broken = {
    ...dag,
    nodes: [...dag.nodes, {
      id: "work.missing",
      kind: "implementation",
      responsibilityUnitId: "ru.missing",
      requiredForDone: true
    }]
  };
  const result = validateWorkItemDag({ dag: broken, workItems });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_NODE_WORK_ITEM_MISSING");
});

test("rejects dependency edge drift", () => {
  const drifted = workItems.map((item) => item.id === "work.orders-api"
    ? { ...item, dependsOn: [] }
    : item);
  const result = validateWorkItemDag({ dag, workItems: drifted });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_DEPENDENCY_DRIFT");
});

test("rejects dependency cycles", () => {
  const broken = {
    ...dag,
    edges: [
      ...dag.edges,
      { from: "work.orders-api", to: "work.orders-repository", contractId: "contract.orders.create" }
    ]
  };
  const result = validateWorkItemDag({ dag: broken, workItems });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_CYCLE");
});

test("rejects sibling allowed path overlap", () => {
  const overlapping = [
    workItems[0],
    { ...workItems[1], allowedPaths: ["src/data/orders/create.py"] }
  ];
  const result = validateWorkItemDag({ dag, workItems: overlapping });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_PATH_OVERLAP");
});

test("returns topological and required node ids", () => {
  assert.deepEqual(topologicalDagNodeIds(dag), ["work.orders-repository", "work.orders-api"]);
  assert.deepEqual(requiredDagNodeIds(dag), ["work.orders-repository", "work.orders-api"]);
});

test("projects canonical DAG to board workItemDAG", () => {
  assert.deepEqual(projectBoardDag(dag), {
    nodes: [
      { workItemId: "work.orders-repository", kind: "implementation", requiredForDone: true },
      { workItemId: "work.orders-api", kind: "implementation", requiredForDone: true }
    ],
    edges: [{ from: "work.orders-repository", to: "work.orders-api", contractId: "contract.orders.persistence" }]
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test test/work-item-dag.test.mjs
```

Expected: FAIL with module-not-found for `src/domain/work-item-dag.mjs`.

- [ ] **Step 3: Implement minimal DAG validator**

Create `src/domain/work-item-dag.mjs`:

```js
import { createHarnessError } from "./errors.mjs";

const VALID_NODE_KINDS = new Set(["implementation", "domain-pm", "integration-evidence"]);

function workById(workItems = []) {
  return new Map(workItems.map((item) => [item.id, item]));
}

function nodeById(dag) {
  return new Map((dag.nodes ?? []).map((node) => [node.id, node]));
}

function normalizePattern(pattern) {
  return String(pattern ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

function patternBase(pattern) {
  const normalized = normalizePattern(pattern);
  return normalized.endsWith("/**") ? normalized.slice(0, -3) : normalized;
}

function patternsOverlap(left, right) {
  const a = patternBase(left);
  const b = patternBase(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function createDagError(code, reason, evidence = ["work-item-dag.json"]) {
  return createHarnessError({ code, reason, evidence, recoverable: true });
}

export function requiredDagNodeIds(dag) {
  return (dag.nodes ?? [])
    .filter((node) => node.requiredForDone !== false)
    .map((node) => node.id);
}

export function topologicalDagNodeIds(dag) {
  const nodes = nodeById(dag);
  const outgoing = new Map();
  const indegree = new Map();
  for (const node of dag.nodes ?? []) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of dag.edges ?? []) {
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const ready = [...nodes.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const next of outgoing.get(id) ?? []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
      }
    }
  }
  return ordered;
}

export function projectBoardDag(dag) {
  return {
    nodes: (dag.nodes ?? []).map((node) => ({
      workItemId: node.id,
      kind: node.kind,
      requiredForDone: node.requiredForDone !== false
    })),
    edges: (dag.edges ?? []).map((edge) => ({
      from: edge.from,
      to: edge.to,
      contractId: edge.contractId
    }))
  };
}

export function validateWorkItemDag({ dag, workItems = [] }) {
  const errors = [];
  if (!dag || typeof dag !== "object") {
    return {
      ok: false,
      errors: [createDagError("HARNESS_DAG_INVALID", "work-item-dag.json must contain an object.")]
    };
  }
  if (!Array.isArray(dag.nodes) || dag.nodes.length === 0) {
    errors.push(createDagError("HARNESS_DAG_INVALID", "work-item-dag.json requires non-empty nodes."));
  }
  if (!Array.isArray(dag.edges)) {
    errors.push(createDagError("HARNESS_DAG_INVALID", "work-item-dag.json requires edges array."));
  }

  const workItemsById = workById(workItems);
  const seenNodes = new Set();
  for (const node of dag.nodes ?? []) {
    if (!node.id || seenNodes.has(node.id)) {
      errors.push(createDagError("HARNESS_DAG_NODE_INVALID", `DAG node id is missing or duplicated: ${node.id ?? "(missing)"}.`));
      continue;
    }
    seenNodes.add(node.id);
    if (!VALID_NODE_KINDS.has(node.kind)) {
      errors.push(createDagError("HARNESS_DAG_NODE_KIND_INVALID", `${node.id} has unsupported kind ${node.kind ?? "(missing)"}.`));
    }
    if (!workItemsById.has(node.id)) {
      errors.push(createDagError("HARNESS_DAG_NODE_WORK_ITEM_MISSING", `${node.id} has no matching board work item.`));
    }
  }

  const nodes = nodeById(dag);
  for (const edge of dag.edges ?? []) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      errors.push(createDagError("HARNESS_DAG_EDGE_INVALID", `DAG edge references missing node: ${edge.from} -> ${edge.to}.`));
    }
    const target = workItemsById.get(edge.to);
    if (target && !(target.dependsOn ?? []).includes(edge.from)) {
      errors.push(createDagError("HARNESS_DAG_DEPENDENCY_DRIFT", `${edge.to} must dependOn ${edge.from}.`));
    }
  }

  if (topologicalDagNodeIds(dag).length !== (dag.nodes ?? []).length) {
    errors.push(createDagError("HARNESS_DAG_CYCLE", "work-item-dag.json contains a dependency cycle."));
  }

  for (let leftIndex = 0; leftIndex < workItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < workItems.length; rightIndex += 1) {
      const left = workItems[leftIndex];
      const right = workItems[rightIndex];
      const parentChild = left.parentWorkItemId === right.id || right.parentWorkItemId === left.id;
      if (parentChild) {
        continue;
      }
      for (const leftPath of left.allowedPaths ?? []) {
        for (const rightPath of right.allowedPaths ?? []) {
          if (patternsOverlap(leftPath, rightPath)) {
            errors.push(createDagError("HARNESS_DAG_PATH_OVERLAP", `${left.id} and ${right.id} overlap on ${leftPath} / ${rightPath}.`));
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
node --test test/work-item-dag.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/work-item-dag.mjs test/work-item-dag.test.mjs
git commit -m "Add canonical work item DAG validation"
```

---

## Task 2: Load DAG Artifacts And Fingerprint Them

**Files:**
- Modify: `src/domain/artifacts.mjs`
- Modify: `src/blueprint/fingerprint.mjs`
- Modify: `test/artifacts.test.mjs`
- Modify: `test/blueprint-gates.test.mjs`
- Modify: `examples/canonical/.makeitreal/runs/feature-auth/work-item-dag.json`

- [ ] **Step 1: Add failing artifact loader test**

In `test/artifacts.test.mjs`, add:

```js
test("loads canonical work-item DAG artifact", async () => {
  const artifacts = await loadRunArtifacts(canonicalRunDir);
  assert.equal(artifacts.workItemDag.schemaVersion, "1.0");
  assert.equal(artifacts.workItemDag.nodes[0].id, artifacts.workItems[0].id);
});
```

Expected failure: `artifacts.workItemDag` is undefined.

- [ ] **Step 2: Add canonical fixture DAG**

Create `examples/canonical/.makeitreal/runs/feature-auth/work-item-dag.json`:

```json
{
  "schemaVersion": "1.0",
  "runId": "feature-auth",
  "nodes": [
    {
      "id": "work.feature-auth",
      "kind": "implementation",
      "responsibilityUnitId": "ru.frontend",
      "requiredForDone": true
    }
  ],
  "edges": []
}
```

- [ ] **Step 3: Update artifact loader**

Modify `src/domain/artifacts.mjs` so it reads `work-item-dag.json`:

```js
export async function loadRunArtifacts(runDir) {
  const [prd, designPack, responsibilityUnits, workItemDag] = await Promise.all([
    readJsonFile(path.join(runDir, "prd.json")),
    readJsonFile(path.join(runDir, "design-pack.json")),
    readJsonFile(path.join(runDir, "responsibility-units.json")),
    readJsonFile(path.join(runDir, "work-item-dag.json"))
  ]);
  const workItems = await loadWorkItems(path.join(runDir, "work-items"));
  return { prd, designPack, responsibilityUnits, workItems, workItemDag };
}
```

Keep existing exports and helper names stable.

- [ ] **Step 4: Add fingerprint drift test**

In `test/blueprint-gates.test.mjs`, add a test that edits `work-item-dag.json` after approval and expects Ready to fail:

```js
test("Ready gate rejects work-item DAG drift after Blueprint approval", async () => {
  await withFixture(async ({ runDir }) => {
    await decideBlueprintReview({
      runDir,
      status: "approved",
      reviewedBy: "operator:dag-drift-test",
      now: new Date("2026-05-15T00:00:00.000Z")
    });
    const dagPath = path.join(runDir, "work-item-dag.json");
    const dag = await readJsonFile(dagPath);
    dag.nodes[0].requiredForDone = false;
    await writeJsonFile(dagPath, dag);

    const result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.ok, false);
    assert.match(result.errors.map((error) => error.code).join("\n"), /HARNESS_BLUEPRINT_DRIFT|HARNESS_DAG/);
  });
});
```

- [ ] **Step 5: Include DAG in Blueprint fingerprint**

Modify `src/blueprint/fingerprint.mjs` so fingerprint material includes the parsed `work-item-dag.json`. Use stable JSON serialization already used in the file.

Implementation shape:

```js
const artifactFiles = [
  "prd.json",
  "design-pack.json",
  "responsibility-units.json",
  "work-item-dag.json"
];
```

If the file currently lists explicit paths, add `work-item-dag.json` to the same list.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test test/artifacts.test.mjs test/blueprint-gates.test.mjs test/work-item-dag.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/artifacts.mjs src/blueprint/fingerprint.mjs test/artifacts.test.mjs test/blueprint-gates.test.mjs examples/canonical/.makeitreal/runs/feature-auth/work-item-dag.json
git commit -m "Bind Blueprint fingerprints to canonical work item DAGs"
```

---

## Task 3: Generate DAGs From A Responsibility Decomposer

**Files:**
- Create: `src/plan/responsibility-decomposer.mjs`
- Modify: `src/plan/plan-generator.mjs`
- Modify: `test/plan-generator.test.mjs`

- [ ] **Step 1: Add failing one-node DAG generation test**

In `test/plan-generator.test.mjs`, add:

```js
test("plan generator writes a canonical one-node work item DAG", async () => {
  const result = await generatePlanRun({
    projectRoot: await mkdtemp(path.join(tmpdir(), "makeitreal-plan-dag-")),
    request: "Create src/math.mjs exporting add(a, b) and test/math.test.mjs.",
    verificationCommands: [{ file: "node", args: ["--test", "test/math.test.mjs"] }]
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const dag = await readJsonFile(path.join(result.runDir, "work-item-dag.json"));
  assert.equal(dag.nodes.length, 1);
  assert.equal(dag.nodes[0].id, result.workItemId);
  assert.equal(dag.nodes[0].kind, "implementation");
  assert.deepEqual(dag.edges, []);
  const board = await readJsonFile(path.join(result.runDir, "board.json"));
  assert.deepEqual(board.workItemDAG.nodes[0], {
    workItemId: result.workItemId,
    kind: "implementation",
    requiredForDone: true
  });
});
```

- [ ] **Step 2: Add failing API+persistence decomposition test**

In `test/plan-generator.test.mjs`, add:

```js
test("plan generator creates API plus persistence responsibility DAG from explicit boundaries", async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "makeitreal-api-data-dag-"));
  const result = await generatePlanRun({
    projectRoot,
    request: [
      "Implement POST /orders in src/api/orders/**.",
      "Persist orders through repository contract in src/data/orders/**.",
      "Use tests in test/api/orders/** and test/data/orders/**."
    ].join(" "),
    allowedPaths: [
      "src/api/orders/**",
      "test/api/orders/**",
      "src/data/orders/**",
      "test/data/orders/**"
    ],
    apiKind: "openapi",
    verificationCommands: [{ file: "node", args: ["--test"] }]
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const dag = await readJsonFile(path.join(result.runDir, "work-item-dag.json"));
  assert.equal(dag.nodes.some((node) => node.id === "work.orders-api"), true);
  assert.equal(dag.nodes.some((node) => node.id === "work.orders-repository"), true);
  assert.equal(dag.edges.some((edge) =>
    edge.from === "work.orders-repository"
    && edge.to === "work.orders-api"
    && edge.contractId === "contract.orders.persistence"
  ), true);
});
```

- [ ] **Step 3: Run tests to confirm failure**

Run:

```bash
node --test test/plan-generator.test.mjs --test-name-pattern "work item DAG|API plus persistence"
```

Expected: FAIL because decomposer and `work-item-dag.json` writing are not implemented.

- [ ] **Step 4: Implement decomposer module**

Create `src/plan/responsibility-decomposer.mjs`:

```js
function hasApiPath(paths) {
  return paths.some((item) => /(^|\/)(api|routes?)\//i.test(item));
}

function hasDataPath(paths) {
  return paths.some((item) => /(^|\/)(data|db|repository|repositories)\//i.test(item));
}

function testPathsFor(paths, pattern) {
  return paths.filter((item) => /^test\//.test(item) && pattern.test(item));
}

function implementationPathsFor(paths, pattern) {
  return paths.filter((item) => !/^test\//.test(item) && pattern.test(item));
}

function oneNodePlan({ slug, title, owner, owns, contractId, moduleInterface, workItem }) {
  return {
    responsibilityUnits: [{
      id: workItem.responsibilityUnitId,
      owner,
      owns,
      publicSurfaces: moduleInterface.publicSurfaces.map((surface) => surface.name),
      mayUseContracts: [contractId],
      mustProvideContracts: [contractId]
    }],
    moduleInterfaces: [moduleInterface],
    workItems: [workItem],
    workItemDag: {
      schemaVersion: "1.0",
      runId: `feature-${slug}`,
      nodes: [{
        id: workItem.id,
        kind: "implementation",
        responsibilityUnitId: workItem.responsibilityUnitId,
        requiredForDone: true
      }],
      edges: []
    }
  };
}

export function decomposeResponsibilities({
  slug,
  title,
  owner,
  owns,
  contractId,
  moduleInterface,
  workItem,
  allowedPaths
}) {
  const paths = allowedPaths ?? owns;
  if (!(hasApiPath(paths) && hasDataPath(paths))) {
    return oneNodePlan({ slug, title, owner, owns, contractId, moduleInterface, workItem });
  }

  const apiOwns = [
    ...implementationPathsFor(paths, /(^|\/)(api|routes?)\//i),
    ...testPathsFor(paths, /(^|\/)(api|routes?)\//i)
  ];
  const dataOwns = [
    ...implementationPathsFor(paths, /(^|\/)(data|db|repository|repositories)\//i),
    ...testPathsFor(paths, /(^|\/)(data|db|repository|repositories)\//i)
  ];
  if (apiOwns.length === 0 || dataOwns.length === 0) {
    return oneNodePlan({ slug, title, owner, owns, contractId, moduleInterface, workItem });
  }

  const apiContractId = contractId;
  const persistenceContractId = "contract.orders.persistence";
  const apiWorkItem = {
    ...workItem,
    id: "work.orders-api",
    responsibilityUnitId: "ru.orders-api",
    allowedPaths: apiOwns,
    contractIds: [apiContractId, persistenceContractId],
    dependencyContracts: [{
      contractId: persistenceContractId,
      providerResponsibilityUnitId: "ru.orders-repository",
      surface: "OrdersRepository.create",
      allowedUse: "Use the repository contract only; do not read persistence internals."
    }],
    dependsOn: ["work.orders-repository"]
  };
  const repositoryWorkItem = {
    ...workItem,
    id: "work.orders-repository",
    title: "Implement orders repository contract",
    responsibilityUnitId: "ru.orders-repository",
    allowedPaths: dataOwns,
    contractIds: [persistenceContractId],
    dependencyContracts: [],
    dependsOn: []
  };

  const apiInterface = {
    ...moduleInterface,
    responsibilityUnitId: "ru.orders-api",
    moduleName: "Orders API",
    owns: apiOwns,
    imports: [{
      contractId: persistenceContractId,
      providerResponsibilityUnitId: "ru.orders-repository",
      surface: "OrdersRepository.create",
      allowedUse: "Persist through repository contract only."
    }]
  };
  const repositoryInterface = {
    responsibilityUnitId: "ru.orders-repository",
    moduleName: "Orders Repository",
    owner,
    owns: dataOwns,
    purpose: "Own persistence for orders behind a repository contract.",
    publicSurfaces: [{
      name: "OrdersRepository.create",
      kind: "module",
      contractIds: [persistenceContractId],
      signature: {
        inputs: [{ name: "orderDraft", type: "object", required: true, description: "Validated order draft." }],
        outputs: [{ name: "orderRecord", type: "object", description: "Persisted order record." }],
        errors: [{ code: "ORDER_PERSISTENCE_REJECTED", when: "Persistence contract rejects the request.", handling: "Fail fast; do not fallback to API-local storage." }]
      }
    }],
    imports: []
  };

  return {
    responsibilityUnits: [
      {
        id: "ru.orders-api",
        owner,
        owns: apiOwns,
        publicSurfaces: apiInterface.publicSurfaces.map((surface) => surface.name),
        mayUseContracts: [apiContractId, persistenceContractId],
        mustProvideContracts: [apiContractId]
      },
      {
        id: "ru.orders-repository",
        owner,
        owns: dataOwns,
        publicSurfaces: repositoryInterface.publicSurfaces.map((surface) => surface.name),
        mayUseContracts: [persistenceContractId],
        mustProvideContracts: [persistenceContractId]
      }
    ],
    moduleInterfaces: [apiInterface, repositoryInterface],
    workItems: [apiWorkItem, repositoryWorkItem],
    workItemDag: {
      schemaVersion: "1.0",
      runId: `feature-${slug}`,
      nodes: [
        { id: "work.orders-repository", kind: "implementation", responsibilityUnitId: "ru.orders-repository", requiredForDone: true },
        { id: "work.orders-api", kind: "implementation", responsibilityUnitId: "ru.orders-api", requiredForDone: true }
      ],
      edges: [{ from: "work.orders-repository", to: "work.orders-api", contractId: persistenceContractId }]
    }
  };
}
```

- [ ] **Step 5: Wire plan generator to decomposer**

In `src/plan/plan-generator.mjs`:

1. Import:

```js
import { projectBoardDag } from "../domain/work-item-dag.mjs";
import { decomposeResponsibilities } from "./responsibility-decomposer.mjs";
```

2. After building the current primary `moduleInterface` and `workItem`, call:

```js
const decomposition = decomposeResponsibilities({
  slug,
  title,
  owner,
  owns,
  contractId,
  moduleInterface,
  workItem,
  allowedPaths: owns
});
```

3. Replace design-pack arrays:

```js
responsibilityBoundaries: decomposition.responsibilityUnits.map((unit) => ({
  responsibilityUnitId: unit.id,
  owns: unit.owns,
  mayUseContracts: unit.mayUseContracts
})),
moduleInterfaces: decomposition.moduleInterfaces,
```

4. Replace responsibility-units artifact:

```js
const responsibilityUnits = {
  schemaVersion: "1.1",
  units: decomposition.responsibilityUnits
};
```

5. Write every work item:

```js
for (const item of decomposition.workItems) {
  await writeJsonFile(path.join(runDir, "work-items", `${item.id}.json`), item);
}
await writeJsonFile(path.join(runDir, "work-item-dag.json"), decomposition.workItemDag);
```

6. Pass `projectBoardDag(decomposition.workItemDag)` into `materializeLaunchBoard`.
If `materializeLaunchBoard` currently accepts one `workItem`, change it to
accept `{ workItems, workItemDag }`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test test/plan-generator.test.mjs test/work-item-dag.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/plan/responsibility-decomposer.mjs src/plan/plan-generator.mjs test/plan-generator.test.mjs
git commit -m "Generate responsibility DAGs from plan requests"
```

---

## Task 4: Make Ready And Done Gates Graph-Wide

**Files:**
- Modify: `src/gates/index.mjs`
- Modify: `src/orchestrator/orchestrator.mjs`
- Modify: `test/gates-cli.test.mjs`
- Modify: `test/blueprint-gates.test.mjs`

- [ ] **Step 1: Add failing Ready gate multi-node test**

In `test/blueprint-gates.test.mjs`, add:

```js
test("Ready gate validates every required DAG node", async () => {
  await withFixture(async ({ runDir }) => {
    await addSecondWorkItemAndDagNode(runDir, {
      id: "work.audit-log",
      responsibilityUnitId: "ru.audit-log",
      allowedPaths: [],
      contractIds: ["contract.auth.audit"]
    });
    await decideBlueprintReview({
      runDir,
      status: "approved",
      reviewedBy: "operator:graph-ready-test",
      now: new Date("2026-05-15T00:00:00.000Z")
    });

    const result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.code === "HARNESS_ALLOWED_PATH_INVALID"), true);
  });
});
```

Define `addSecondWorkItemAndDagNode()` inside the test file. It must update
`work-items/work.audit-log.json`, `work-item-dag.json`, `board.json`, and
`responsibility-units.json`.

- [ ] **Step 2: Add failing Done gate multi-node test**

In `test/gates-cli.test.mjs`, add a fixture where the primary item has evidence
but a second `requiredForDone` node is still `Ready`. Assert Done fails with a
graph-node evidence error:

```js
assert.equal(done.status, 1);
assert.match(done.stdout, /HARNESS_GRAPH_NODE_NOT_DONE|HARNESS_VERIFICATION_MISSING/);
```

- [ ] **Step 3: Implement graph-wide Ready gate**

In `src/gates/index.mjs`, replace single work item logic with:

```js
const workItems = artifacts.workItems;
const dagResult = validateWorkItemDag({ dag: artifacts.workItemDag, workItems });
errors.push(...dagResult.errors);

for (const workItem of workItemsForRequiredNodes({ dag: artifacts.workItemDag, workItems })) {
  validateOneReadyWorkItem({ artifacts, workItem, errors });
}
```

Create local helper `validateOneReadyWorkItem()` by moving the current
work-item-specific Ready checks into a function.

- [ ] **Step 4: Implement graph-wide Done gate**

Still in `src/gates/index.mjs`, replace single work item evidence reads with:

```js
for (const workItem of workItemsForRequiredNodes({ dag: artifacts.workItemDag, workItems: artifacts.workItems })) {
  const verification = await readVerificationEvidence(runDir, { workItem });
  errors.push(...verification.errors);
  const wikiSync = await readWikiSyncEvidence(runDir, { workItem });
  errors.push(...wikiSync.errors);
  const openApiConformance = await validateOpenApiConformanceEvidence({ runDir, workItem });
  errors.push(...openApiConformance.errors);
}
```

- [ ] **Step 5: Promote all eligible graph nodes**

In `src/orchestrator/orchestrator.mjs`, replace primary promotion with graph
promotion:

```js
async function promoteReadyGateApprovedWork({ boardDir, board, now }) {
  const gate = await runGates({ runDir: boardDir, target: "Ready" });
  if (!gate.ok) {
    return { ok: false, board, promotedWorkItemIds: [], errors: gate.errors };
  }
  const promotedWorkItemIds = [];
  for (const item of board.workItems ?? []) {
    if (item.lane !== "Contract Frozen") {
      continue;
    }
    const event = transitionLane(board, item.id, "Ready");
    if (!event.ok) {
      return { ok: false, board, promotedWorkItemIds, errors: event.errors };
    }
    promotedWorkItemIds.push(item.id);
  }
  await saveBoard(boardDir, board);
  return { ok: true, board, promotedWorkItemIds, errors: [] };
}
```

If some nodes are blocked by `dependsOn`, they may still be promoted to `Ready`;
`getReadyWorkItems()` will keep them out of launch until dependencies are Done.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test test/blueprint-gates.test.mjs test/gates-cli.test.mjs test/orchestrator.test.mjs test/board-completion.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/gates/index.mjs src/orchestrator/orchestrator.mjs test/blueprint-gates.test.mjs test/gates-cli.test.mjs
git commit -m "Evaluate Ready and Done gates across responsibility DAGs"
```

---

## Task 5: Persist Native Packets And Role Mapping

**Files:**
- Create: `src/orchestrator/native-packets.mjs`
- Create: `src/orchestrator/native-role-mapping.mjs`
- Create: `test/native-packets.test.mjs`
- Create: `test/native-role-mapping.test.mjs`
- Modify: `src/orchestrator/orchestrator.mjs`
- Modify: `src/orchestrator/review-evidence.mjs`

- [ ] **Step 1: Add native packet tests**

Create `test/native-packets.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNativePacket } from "../src/orchestrator/native-packets.mjs";

const packet = {
  schemaVersion: "1.0",
  runDir: "/project/.makeitreal/runs/feature-orders",
  projectRoot: "/project",
  expectedCwd: "/project",
  workItemId: "work.orders-api",
  attemptId: "attempt.001",
  evidenceRole: "implementation-worker",
  hookContext: {
    runDir: "/project/.makeitreal/runs/feature-orders",
    workItemId: "work.orders-api",
    agentPacketPath: "/project/.makeitreal/runs/feature-orders/agent-packets/work.orders-api.attempt.001.json"
  },
  scope: {
    responsibilityUnitId: "ru.orders-api",
    allowedPaths: ["src/api/orders/**"],
    forbiddenPaths: [".makeitreal/**"]
  },
  readScope: {
    requiredReads: ["prd.json", "design-pack.json"],
    forbiddenReads: ["src/data/orders/**"]
  },
  contracts: ["contract.orders.create"],
  dependencyContracts: [],
  verificationCommands: [{ file: "node", args: ["--test"] }],
  reportSchema: "makeitrealReport.v1"
};

test("validates complete native packet", () => {
  assert.equal(validateNativePacket(packet).ok, true);
});

test("rejects missing hook-visible work item scope", () => {
  const result = validateNativePacket({ ...packet, hookContext: { runDir: packet.runDir } });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_PACKET_SCOPE_MISSING");
});

test("rejects native packet expected cwd under legacy workspace", () => {
  const result = validateNativePacket({
    ...packet,
    expectedCwd: "/project/.makeitreal/runs/feature-orders/workspaces/work.orders-api"
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_PACKET_WORKSPACE_INVALID");
});
```

- [ ] **Step 2: Implement native packet validator**

Create `src/orchestrator/native-packets.mjs`:

```js
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createHarnessError } from "../domain/errors.mjs";
import { writeJsonFile } from "../io/json.mjs";

function packetError(code, reason, evidence = ["agent-packets"]) {
  return createHarnessError({ code, reason, evidence, recoverable: true });
}

function underLegacyWorkspace(candidate) {
  return String(candidate ?? "").replaceAll("\\", "/").includes("/.makeitreal/runs/")
    && String(candidate ?? "").replaceAll("\\", "/").includes("/workspaces/");
}

export function validateNativePacket(packet) {
  const errors = [];
  for (const key of ["runDir", "projectRoot", "expectedCwd", "workItemId", "attemptId", "evidenceRole"]) {
    if (!packet?.[key]) {
      errors.push(packetError("HARNESS_NATIVE_PACKET_INVALID", `Native packet requires ${key}.`));
    }
  }
  if (!packet?.hookContext?.runDir || !packet?.hookContext?.workItemId) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_SCOPE_MISSING", "Native packet requires hookContext.runDir and hookContext.workItemId."));
  }
  if (underLegacyWorkspace(packet?.expectedCwd)) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_WORKSPACE_INVALID", "Native packet expectedCwd must be the project root, not a legacy workspace."));
  }
  if (!Array.isArray(packet?.scope?.allowedPaths) || packet.scope.allowedPaths.length === 0) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_SCOPE_MISSING", "Native packet requires non-empty scope.allowedPaths."));
  }
  if (!Array.isArray(packet?.verificationCommands) || packet.verificationCommands.length === 0) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_VERIFICATION_MISSING", "Native packet requires verificationCommands."));
  }
  return { ok: errors.length === 0, errors };
}

export async function writeNativePacket({ runDir, packet }) {
  const validation = validateNativePacket(packet);
  if (!validation.ok) {
    return { ok: false, packetPath: null, errors: validation.errors };
  }
  const packetDir = path.join(runDir, "agent-packets");
  await mkdir(packetDir, { recursive: true });
  const packetPath = path.join(packetDir, `${packet.workItemId}.${packet.attemptId}.${packet.evidenceRole}.json`);
  await writeJsonFile(packetPath, packet);
  return { ok: true, packetPath, errors: [] };
}
```

- [ ] **Step 3: Add native role mapping tests**

Create `test/native-role-mapping.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { requiredEvidenceRoles, validateNativeRoleMapping } from "../src/orchestrator/native-role-mapping.mjs";

const mapping = {
  schemaVersion: "1.0",
  mappings: [
    { evidenceRole: "implementation-worker", nativeSubagentType: "general-purpose", mappingSource: "builtin-default" },
    { evidenceRole: "spec-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
    { evidenceRole: "quality-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
    { evidenceRole: "verification-reviewer", nativeSubagentType: "oh-my-claudecode:verifier", mappingSource: "project-config" }
  ]
};

test("validates required native role mappings", () => {
  assert.deepEqual(requiredEvidenceRoles(), [
    "implementation-worker",
    "spec-reviewer",
    "quality-reviewer",
    "verification-reviewer"
  ]);
  assert.equal(validateNativeRoleMapping(mapping).ok, true);
});

test("rejects missing reviewer mapping", () => {
  const result = validateNativeRoleMapping({
    ...mapping,
    mappings: mapping.mappings.filter((entry) => entry.evidenceRole !== "quality-reviewer")
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_ROLE_MAPPING_MISSING");
});
```

- [ ] **Step 4: Implement role mapping module**

Create `src/orchestrator/native-role-mapping.mjs`:

```js
import { createHarnessError } from "../domain/errors.mjs";

const ROLES = Object.freeze([
  "implementation-worker",
  "spec-reviewer",
  "quality-reviewer",
  "verification-reviewer"
]);

export function requiredEvidenceRoles() {
  return [...ROLES];
}

function mappingError(code, reason) {
  return createHarnessError({ code, reason, evidence: ["native-role-mapping.json"], recoverable: true });
}

export function validateNativeRoleMapping(mapping) {
  const errors = [];
  const entries = mapping?.mappings ?? [];
  for (const role of ROLES) {
    const entry = entries.find((candidate) => candidate.evidenceRole === role);
    if (!entry) {
      errors.push(mappingError("HARNESS_NATIVE_ROLE_MAPPING_MISSING", `Missing native role mapping for ${role}.`));
      continue;
    }
    if (!entry.nativeSubagentType || !entry.mappingSource) {
      errors.push(mappingError("HARNESS_NATIVE_ROLE_MAPPING_INVALID", `${role} mapping requires nativeSubagentType and mappingSource.`));
    }
  }
  return { ok: errors.length === 0, errors };
}

export function defaultNativeRoleMapping() {
  return {
    schemaVersion: "1.0",
    mappings: [
      { evidenceRole: "implementation-worker", nativeSubagentType: "general-purpose", mappingSource: "builtin-default" },
      { evidenceRole: "spec-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
      { evidenceRole: "quality-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
      { evidenceRole: "verification-reviewer", nativeSubagentType: "oh-my-claudecode:verifier", mappingSource: "project-config" }
    ]
  };
}
```

- [ ] **Step 5: Wire native start to packets and mappings**

In `src/orchestrator/orchestrator.mjs`:

- validate or write `native-role-mapping.json` before claims
- write implementation packet after attempt creation
- return `nativeTasks[]` entries with:

```js
{
  workItemId,
  attemptId,
  workerId,
  projectRoot,
  agentPacketPath,
  hookContext: {
    runDir: boardDir,
    workItemId,
    agentPacketPath
  },
  implementationPrompt,
  reviewerPrompts
}
```

Reviewer prompts must include mapping metadata:

```js
{
  role: "spec-reviewer",
  evidenceRole: "spec-reviewer",
  nativeSubagentType: "oh-my-claudecode:critic",
  mappingSource: "project-config",
  prompt
}
```

- [ ] **Step 6: Persist reviewer mapping metadata**

In `src/orchestrator/review-evidence.mjs`, extend normalized review reports:

```js
{
  role,
  evidenceRole: role,
  nativeSubagentType: candidate.nativeSubagentType,
  mappingSource: candidate.mappingSource,
  status,
  summary,
  findings,
  evidence,
  workItemId,
  attemptId
}
```

Keep `role` for backward compatibility; add `evidenceRole` as the new explicit field.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test test/native-packets.test.mjs test/native-role-mapping.test.mjs test/board-completion.test.mjs test/makeitreal-plugin.test.mjs
```

Expected: PASS after plugin tests are updated in Task 9. If plugin tests fail here only because of text expectations, defer those failures to Task 9 and keep code tests passing.

- [ ] **Step 8: Commit**

```bash
git add src/orchestrator/native-packets.mjs src/orchestrator/native-role-mapping.mjs src/orchestrator/orchestrator.mjs src/orchestrator/review-evidence.mjs test/native-packets.test.mjs test/native-role-mapping.test.mjs
git commit -m "Persist zero-context native task packets and role mappings"
```

---

## Task 6: Apply Node-Kind Completion Semantics

**Files:**
- Modify: `src/orchestrator/board-completion.mjs`
- Modify: `test/board-completion.test.mjs`

- [ ] **Step 1: Add failing PM node completion test**

In `test/board-completion.test.mjs`, add:

```js
test("domain PM node completes from pm report without changed files", async () => {
  await withProjectBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    await addDomainPmWorkItem({ boardDir });
    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      concurrency: 1,
      now: new Date("2026-05-15T00:00:00.000Z")
    });
    const task = started.nativeTasks.find((item) => item.workItemId === "work.auth-pm");
    const finished = await finishNativeClaudeTask({
      boardDir,
      workItemId: "work.auth-pm",
      attemptId: task.attemptId,
      resultText: JSON.stringify({
        makeitrealPmReport: {
          role: "domain-pm",
          status: "DONE",
          summary: "No child split required.",
          childWorkProposal: null,
          workItemId: "work.auth-pm",
          attemptId: task.attemptId
        },
        makeitrealReviews: [{
          role: "spec-reviewer",
          status: "APPROVED",
          summary: "PM split is consistent with Blueprint.",
          findings: [],
          evidence: [],
          workItemId: "work.auth-pm",
          attemptId: task.attemptId
        }]
      }),
      now: new Date("2026-05-15T00:00:01.000Z")
    });
    assert.equal(finished.ok, true, JSON.stringify(finished.errors));
  });
});
```

- [ ] **Step 2: Add failing integration-evidence completion test**

Add a test where `kind: "integration-evidence"` has no production code changed
but has a verification command and a verification reviewer report. Completion
must pass after verification succeeds.

- [ ] **Step 3: Implement node-kind branch in completion**

In `src/orchestrator/board-completion.mjs`, derive node kind from
`work-item-dag.json`:

```js
const nodeKind = nodeKindForWorkItem({ dag: artifacts.workItemDag, workItemId });
```

Apply this policy:

```js
const completionPolicy = {
  "implementation": {
    requiresImplementationReport: true,
    requiresChangedFiles: true,
    requiredReviewRoles: ["spec-reviewer", "quality-reviewer", "verification-reviewer"]
  },
  "domain-pm": {
    requiresPmReport: true,
    requiresChangedFiles: false,
    requiredReviewRoles: ["spec-reviewer"]
  },
  "integration-evidence": {
    requiresImplementationReport: false,
    requiresEvidenceReport: true,
    requiresChangedFiles: false,
    requiredReviewRoles: ["verification-reviewer"]
  }
};
```

Validate reports according to this policy before moving to Verifying.

- [ ] **Step 4: Reject native workspace changed files**

In the same file, before accepting changed files:

```js
const workspaceChangedFile = changedFiles.find((filePath) =>
  filePath.replaceAll("\\", "/").includes(".makeitreal/runs/")
  && filePath.replaceAll("\\", "/").includes("/workspaces/")
);
if (workspaceChangedFile) {
  errors.push(createHarnessError({
    code: "HARNESS_NATIVE_WORKSPACE_EDIT_INVALID",
    reason: `Native Claude work must edit the project root, not legacy workspace path: ${workspaceChangedFile}`,
    ownerModule: workItem.responsibilityUnitId ?? null,
    evidence: [workspaceChangedFile],
    recoverable: true
  }));
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/board-completion.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/board-completion.mjs test/board-completion.test.mjs
git commit -m "Complete DAG nodes by explicit lifecycle kind"
```

---

## Task 7: Harden Hooks For Scoped Native Work

**Files:**
- Modify: `hooks/claude/pre-tool-use.mjs`
- Modify: `hooks/claude/stop.mjs`
- Modify: `src/project/run-state.mjs`
- Modify: `test/claude-hooks.test.mjs`

- [ ] **Step 1: Add failing hook-input carrier test**

In `test/claude-hooks.test.mjs`, add:

```js
test("pre-tool-use uses explicit makeitreal hook context for concurrent native work", async () => {
  await withFixture(async ({ runDir }) => {
    const denied = runHook("hooks/claude/pre-tool-use.mjs", {
      cwd: path.dirname(path.dirname(runDir)),
      makeitreal: { runDir, workItemId: "work.feature-auth" },
      tool_name: "Edit",
      tool_input: { file_path: "services/auth/private.ts" }
    });
    assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");

    const allowed = runHook("hooks/claude/pre-tool-use.mjs", {
      cwd: path.dirname(path.dirname(runDir)),
      makeitreal: { runDir, workItemId: "work.feature-auth" },
      tool_name: "Edit",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    });
    assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision, "allow");
  });
});
```

- [ ] **Step 2: Add failing detached enforcement test**

Add:

```js
test("pre-tool-use allows ordinary edits when current run is detached", async () => {
  await withFixture(async ({ projectRoot, runDir }) => {
    await writeJsonFile(path.join(projectRoot, ".makeitreal", "current-run.json"), {
      runDir,
      source: "test",
      enforcement: "detached"
    });
    const result = runHook("hooks/claude/pre-tool-use.mjs", {
      cwd: projectRoot,
      tool_name: "Edit",
      tool_input: { file_path: "unrelated/file.ts" }
    });
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "allow");
  });
});
```

- [ ] **Step 3: Add failing read-scope test**

Add:

```js
test("pre-tool-use denies scoped native read of provider private implementation", async () => {
  await withFixture(async ({ runDir }) => {
    const result = runHook("hooks/claude/pre-tool-use.mjs", {
      makeitreal: {
        runDir,
        workItemId: "work.feature-auth",
        agentPacket: {
          readScope: {
            requiredReads: ["prd.json", "design-pack.json"],
            forbiddenReads: ["services/auth/**"]
          }
        }
      },
      tool_name: "Read",
      tool_input: { file_path: "services/auth/private.ts" }
    });
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /HARNESS_READ_SCOPE_VIOLATION/);
  });
});
```

- [ ] **Step 4: Implement hook context precedence**

In `hooks/claude/pre-tool-use.mjs`, resolve work item scope in this order:

```js
const explicitMakeItReal = input.makeitreal ?? input.tool_input?.makeitreal ?? input.toolInput?.makeitreal ?? null;
const explicitRunDir = explicitMakeItReal?.runDir ?? input.runDir ?? null;
let workItemId = explicitMakeItReal?.workItemId ?? process.env.MAKEITREAL_WORK_ITEM_ID ?? null;
```

If current-run state has `enforcement: "detached"`, return allow before
Blueprint approval checks.

- [ ] **Step 5: Implement read-scope denial**

Treat `Read`, `Grep`, `Glob`, and read-only Bash path extraction as scoped
operations when `input.makeitreal.agentPacket.readScope` exists.

Add helper:

```js
function readScopeViolation({ readScope, changedPaths }) {
  const forbidden = changedPaths.filter((candidate) =>
    (readScope?.forbiddenReads ?? []).some((pattern) => matchesPattern(pattern, candidate))
  );
  return forbidden;
}
```

Use existing or copied `matchesPattern()` semantics from responsibility-boundary
matching.

- [ ] **Step 6: Stop hook uses graph-wide Done gate**

In `hooks/claude/stop.mjs`, keep calling `runGates({ target: "Done" })`. After
Task 4, this is graph-wide. Add one test that a second required node missing
evidence blocks Stop.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test test/claude-hooks.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add hooks/claude/pre-tool-use.mjs hooks/claude/stop.mjs src/project/run-state.mjs test/claude-hooks.test.mjs
git commit -m "Scope Claude hooks by native work item packets"
```

---

## Task 8: Render Graph-Aware Architecture Dossier

**Files:**
- Modify: `src/domain/system-dossier.mjs`
- Modify: `src/preview/preview-model.mjs`
- Modify: `src/preview/render-dashboard-html.mjs`
- Modify: `test/preview.test.mjs`

- [ ] **Step 1: Add failing Dossier assertions**

In `test/preview.test.mjs`, extend the multi-module Dossier test:

```js
assert.equal(dossier.taskDag.nodes.some((node) => node.id === "work.login-ui"), true);
assert.equal(dossier.workerTopology.assignments.some((assignment) => assignment.evidenceRole === "implementation-worker"), true);
assert.equal(dossier.approvalScope.authorizedPaths.includes("web/src/auth/**"), true);
assert.match(html, /Approval Scope/);
assert.match(html, /Task DAG/);
assert.match(html, /Worker Topology/);
assert.match(html, /work\.login-ui/);
assert.match(html, /parent-session native Task/);
```

- [ ] **Step 2: Add Dossier model fields**

In `src/domain/system-dossier.mjs`, add:

```js
function modelTaskDag({ workItemDag, workItems }) {
  const byId = new Map((workItems ?? []).map((item) => [item.id, item]));
  return {
    nodes: (workItemDag?.nodes ?? []).map((node) => ({
      ...node,
      title: byId.get(node.id)?.title ?? node.id,
      lane: byId.get(node.id)?.lane ?? "unknown",
      allowedPaths: byId.get(node.id)?.allowedPaths ?? [],
      contractIds: byId.get(node.id)?.contractIds ?? [],
      dependsOn: byId.get(node.id)?.dependsOn ?? []
    })),
    edges: workItemDag?.edges ?? []
  };
}

function modelApprovalScope({ workItems }) {
  return {
    authorizedPaths: [...new Set((workItems ?? []).flatMap((item) => item.allowedPaths ?? []))],
    authorizedContracts: [...new Set((workItems ?? []).flatMap((item) => item.contractIds ?? []))],
    requiredEvidence: [...new Set((workItems ?? []).flatMap((item) => (item.doneEvidence ?? []).map((evidence) => evidence.kind)))]
  };
}

function modelWorkerTopology({ workItemDag }) {
  return {
    parent: "parent-session native Task controller",
    assignments: (workItemDag?.nodes ?? []).map((node) => ({
      workItemId: node.id,
      kind: node.kind,
      evidenceRole: node.kind === "domain-pm" ? "domain-pm" : "implementation-worker",
      reviewers: node.kind === "domain-pm"
        ? ["spec-reviewer"]
        : node.kind === "integration-evidence"
          ? ["verification-reviewer"]
          : ["spec-reviewer", "quality-reviewer", "verification-reviewer"]
    }))
  };
}
```

Pass `workItemDag` and `workItems` into `buildSystemDossier()`.

- [ ] **Step 3: Update preview model**

In `src/preview/preview-model.mjs`, call:

```js
systemDossier: buildSystemDossier({
  prd,
  designPack,
  responsibilityUnits,
  workItems,
  workItemDag
})
```

- [ ] **Step 4: Render Approval Scope**

In `src/preview/render-dashboard-html.mjs`, add:

```js
function renderApprovalScope(scope) {
  return `<section id="approval-scope" class="architecture-section">
    <div class="section-heading"><div><p class="eyebrow">Review</p><h2>Approval Scope</h2></div></div>
    <div class="doc-table">
      <div class="doc-row"><div class="doc-key">Authorized paths</div><div class="doc-value">${(scope.authorizedPaths ?? []).map((item) => `<code>${escapeHtml(item)}</code>`).join("")}</div></div>
      <div class="doc-row"><div class="doc-key">Authorized contracts</div><div class="doc-value">${(scope.authorizedContracts ?? []).map((item) => `<code>${escapeHtml(item)}</code>`).join("")}</div></div>
      <div class="doc-row"><div class="doc-key">Required evidence</div><div class="doc-value">${(scope.requiredEvidence ?? []).map((item) => `<code>${escapeHtml(item)}</code>`).join("")}</div></div>
    </div>
  </section>`;
}
```

- [ ] **Step 5: Render Task DAG and Worker Topology**

Add renderers:

```js
function renderTaskDag(taskDag) {
  return `<section id="task-dag" class="architecture-section">
    <div class="section-heading"><div><p class="eyebrow">Execution</p><h2>Task DAG</h2></div></div>
    <div class="doc-table">
      ${(taskDag.nodes ?? []).map((node) => `<div class="doc-row">
        <div class="doc-key"><code>${escapeHtml(node.id)}</code></div>
        <div class="doc-value">
          <p><strong>${escapeHtml(node.title)}</strong></p>
          <p>${escapeHtml(node.kind)} · ${escapeHtml(node.lane)} · depends on ${(node.dependsOn ?? []).join(", ") || "none"}</p>
          <p>${(node.allowedPaths ?? []).map((item) => `<code>${escapeHtml(item)}</code>`).join("")}</p>
        </div>
      </div>`).join("")}
    </div>
  </section>`;
}

function renderWorkerTopology(topology) {
  return `<section id="worker-topology" class="architecture-section">
    <div class="section-heading"><div><p class="eyebrow">Execution</p><h2>Worker Topology</h2></div></div>
    <p class="section-note">${escapeHtml(topology.parent ?? "parent-session native Task controller")}</p>
    <div class="doc-table">
      ${(topology.assignments ?? []).map((assignment) => `<div class="doc-row">
        <div class="doc-key"><code>${escapeHtml(assignment.workItemId)}</code></div>
        <div class="doc-value">
          <p>${escapeHtml(assignment.evidenceRole)} through parent-session native Task</p>
          <p>Reviewers: ${(assignment.reviewers ?? []).map((role) => `<code>${escapeHtml(role)}</code>`).join("")}</p>
        </div>
      </div>`).join("")}
    </div>
  </section>`;
}
```

Insert these after System Placement and Dependency Graph, before Contract Surfaces.

- [ ] **Step 6: Run preview tests**

Run:

```bash
node --test test/preview.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/system-dossier.mjs src/preview/preview-model.mjs src/preview/render-dashboard-html.mjs test/preview.test.mjs
git commit -m "Render responsibility DAGs in Architecture Dossiers"
```

---

## Task 9: Remove Generic Reviewer Fallback From Plugin Surface

**Files:**
- Modify: `plugins/makeitreal/skills/launch/SKILL.md`
- Modify: `plugins/mir/skills/launch/SKILL.md`
- Modify: `plugins/makeitreal/commands/launch.md`
- Modify: `plugins/mir/commands/launch.md`
- Modify: `test/makeitreal-plugin.test.mjs`
- Modify: `test/prompt-discipline.test.mjs`

- [ ] **Step 1: Update plugin tests first**

In `test/makeitreal-plugin.test.mjs`, replace assertions that expect generic fallback wording with:

```js
assert.match(launchCommand, /native-role-mapping\.json/);
assert.match(launchCommand, /Missing reviewer role mapping must fail before native Task dispatch/i);
assert.doesNotMatch(launchCommand, /general-purpose.*fallback|retry.*general-purpose/i);
```

Apply the same check to both `makeitreal` and `mir` launch command/skill text.

- [ ] **Step 2: Update launch skills**

Replace reviewer fallback wording with:

```markdown
Reviewer prompts are evidence roles. Before dispatch, validate `native-role-mapping.json`.
Each reviewer prompt must carry `evidenceRole`, `nativeSubagentType`, and `mappingSource`.
Missing reviewer role mapping must fail before native Task dispatch. Do not retry with a generic subagent type.
```

Also add:

```markdown
Native implementation Tasks edit the project root. `.makeitreal/runs/*/workspaces/*` is legacy scripted-simulator state only and must not receive native implementation edits.
```

- [ ] **Step 3: Update command markdown**

Ensure `/makeitreal:launch` and `/mir:launch` command files mention:

- `orchestrator native start`
- `nativeTasks[]`
- `agentPacketPath`
- `hookContext`
- `native-role-mapping.json`
- project-root native edits

- [ ] **Step 4: Run plugin prompt tests**

Run:

```bash
node --test test/makeitreal-plugin.test.mjs test/prompt-discipline.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/makeitreal/skills/launch/SKILL.md plugins/mir/skills/launch/SKILL.md plugins/makeitreal/commands/launch.md plugins/mir/commands/launch.md test/makeitreal-plugin.test.mjs test/prompt-discipline.test.mjs
git commit -m "Remove reviewer fallback from native launch guidance"
```

---

## Task 10: Update Architecture Docs And Verification Evidence Plan

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/claude-code-runner.md`
- Create: `docs/e2e/makeitreal-native-dag-dogfood-template.md`

- [ ] **Step 1: Update architecture docs**

In `docs/architecture.md`, add a section:

```markdown
## Responsibility DAG Authority

`work-item-dag.json` is the canonical execution graph. `board.workItemDAG` is a regenerated projection. Ready and Done gates validate every `requiredForDone` DAG node. `designPack.workItemId` is display metadata and must not be used as graph-aware gate authority.
```

Add another section:

```markdown
## Native Project Root Rule

Native Claude Code Tasks edit the real project root under parent-session hooks. `.makeitreal/runs/*/workspaces/*` is legacy scripted-simulator state only. Native completion rejects attempts that report changed files under run workspaces.
```

- [ ] **Step 2: Update Claude runner docs**

In `docs/claude-code-runner.md`, add:

```markdown
Native launch returns `nativeTasks[]`; every entry includes `agentPacketPath`, `hookContext`, and reviewer assignments from `native-role-mapping.json`. Claude Code must run each prompt through the parent-session native Task UI. If hook-visible scope cannot be carried into Task tool calls, native batch launch fails before mutation.
```

- [ ] **Step 3: Add dogfood template**

Create `docs/e2e/makeitreal-native-dag-dogfood-template.md`:

```markdown
# Make It Real Native DAG Dogfood Evidence Template

Date:
Project:
Make It Real commit:
Claude Code version:

## Scenario

- Feature request:
- Expected responsibility units:
- Expected contracts:
- Expected verification command:

## Plan Evidence

- Run directory:
- PRD present:
- Design pack present:
- Work item DAG present:
- Native role mapping present:
- Blueprint review status:
- Dossier URL:

## Approval Evidence

- Approval method:
- Approval fingerprint:
- Approval result:

## Native Launch Evidence

- `nativeTasks[]` count:
- Agent packet paths:
- Hook context present for each task:
- No `claude --print` process observed:

## Implementation Evidence

- Work item:
- Native subagent type:
- Changed files:
- Boundary check result:
- Report status:

## Review Evidence

- Spec reviewer:
- Quality reviewer:
- Verification reviewer:
- Actual native subagent types:

## Failure/Rework Evidence

- Injected failure:
- Expected Rework or Failed Fast result:
- Replacement attempt:
- Latest passing attempt:

## Done Evidence

- Verification evidence:
- Wiki or skip evidence:
- Dossier refresh:
- Final gate result:
```

- [ ] **Step 4: Run docs/prompt tests**

Run:

```bash
node --test test/prompt-discipline.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/claude-code-runner.md docs/e2e/makeitreal-native-dag-dogfood-template.md
git commit -m "Document native DAG authority and dogfood evidence"
```

---

## Task 11: Full Verification

**Files:**
- No code changes unless verification reveals a concrete failure.

- [ ] **Step 1: Run focused graph/native tests**

Run:

```bash
node --test test/work-item-dag.test.mjs test/native-packets.test.mjs test/native-role-mapping.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run core harness tests**

Run:

```bash
node --test test/blueprint-gates.test.mjs test/design-pack.test.mjs test/boundaries.test.mjs test/claude-hooks.test.mjs test/orchestrator.test.mjs test/board-completion.test.mjs test/board-status-audit.test.mjs test/e2e.test.mjs test/phase2-e2e.test.mjs test/makeitreal-plugin.test.mjs test/preview.test.mjs test/prompt-discipline.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run plugin validation**

Run:

```bash
npm run plugin:validate
```

Expected: PASS.

- [ ] **Step 4: Run full check**

Run:

```bash
npm run check
```

Expected: PASS.

If `npm run check` rewrites canonical fixture artifacts with local paths or
timestamps, inspect those diffs. Revert generated noise only when it is unrelated
to the planned changes; keep intentional fixture updates.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected:

- only intentional files changed
- no whitespace errors
- no untracked generated junk

- [ ] **Step 6: Commit verification cleanup if needed**

If verification required small fixes, commit them:

```bash
git add <changed-files>
git commit -m "Stabilize responsibility DAG verification"
```

---

## Task 12: Real Claude Code Dogfood Evidence

**Files:**
- Create: `docs/e2e/makeitreal-native-dag-dogfood-YYYY-MM-DD.md`

- [ ] **Step 1: Create disposable project**

Run outside this repo:

```bash
mkdir -p /tmp/makeitreal-native-dag-dogfood
cd /tmp/makeitreal-native-dag-dogfood
git init
printf '{"type":"module","scripts":{"test":"node --test"}}\n' > package.json
mkdir -p src/api/orders src/data/orders test/api/orders test/data/orders
git add .
git commit -m "Initial dogfood project"
```

- [ ] **Step 2: Run Make It Real plan in Claude Code**

In a real Claude Code parent session, run:

```text
/mir:plan Implement POST /orders in src/api/orders/** and repository persistence in src/data/orders/**. Use tests in test/api/orders/** and test/data/orders/**. Verification command is npm test.
```

Record:

- run directory
- Dossier URL
- `work-item-dag.json`
- `native-role-mapping.json`
- `blueprint-review.json`

- [ ] **Step 3: Approve naturally**

Reply in natural language:

```text
승인합니다. 진행하세요.
```

Record:

- approval decision
- fingerprint
- no keyword-only hardcoded classification evidence if visible

- [ ] **Step 4: Launch and run native Tasks**

Run:

```text
/mir:launch
```

Record:

- `nativeTasks[]`
- `agentPacketPath`
- `hookContext`
- actual native subagent type per role
- no `claude --print` process

- [ ] **Step 5: Verify implementation and review evidence**

After native Tasks complete, inspect:

```bash
find .makeitreal/runs -maxdepth 4 -type f | sort
```

Record:

- attempts JSON
- implementation report
- reviewer reports
- verification evidence
- wiki or skip evidence

- [ ] **Step 6: Force one failure path**

Run a second small work item where the implementation Task attempts an
out-of-bound edit or reviewer rejects a missing contract. Record:

- hook denial or review rejection
- Rework or Failed Fast state
- replacement attempt
- latest passing attempt

- [ ] **Step 7: Save dogfood report**

Create `docs/e2e/makeitreal-native-dag-dogfood-YYYY-MM-DD.md` from the template
in Task 10. Include absolute paths only when needed for evidence; avoid secrets
or private tokens.

- [ ] **Step 8: Commit dogfood evidence**

```bash
git add docs/e2e/makeitreal-native-dag-dogfood-YYYY-MM-DD.md
git commit -m "Record native DAG dogfood evidence"
```

---

## Final Acceptance Checklist

- [ ] `work-item-dag.json` is canonical and fingerprinted.
- [ ] `board.workItemDAG` is only a projection.
- [ ] One-node and multi-node plans use the same DAG path.
- [ ] Ready gate validates all required DAG nodes.
- [ ] Done gate validates all required DAG nodes by node kind.
- [ ] Native launch returns `nativeTasks[]` with packet paths and hook context.
- [ ] Missing reviewer mapping fails before dispatch.
- [ ] No launch docs recommend generic reviewer fallback.
- [ ] Hooks enforce scoped concurrent mutation and scoped reads.
- [ ] Detach state allows ordinary Claude Code work without weakening Done.
- [ ] Native attempts edit project root and reject legacy workspace changes.
- [ ] Dossier shows Approval Scope, Task DAG, Worker Topology, module pages, and evidence.
- [ ] `node --test ...` focused and core suites pass.
- [ ] `npm run plugin:validate` passes.
- [ ] `npm run check` passes.
- [ ] Real Claude Code dogfood evidence exists.
