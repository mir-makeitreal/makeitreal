# Make It Real — Complete Product Plan

**Date:** 2026-05-19
**Version:** 1.0
**Status:** REVIEWED — incorporating feedback, ready for execution
**Target:** GitHub 10k stars, best-in-class Claude Code plugin

---

## Executive Summary

Make It Real is a Claude Code plugin that implements "Blueprint First" development.
When you give Claude Code a broad goal, it FIRST architects the solution — responsibility
boundaries, module interfaces, contracts — then decomposes into a DAG of work items
where each sub-agent implements ONLY their piece perfectly. Unit Test success = QA success
because contracts guarantee integration.

**Current state:** 272 passing tests, 55 source modules, working Kanban state machine,
gate system, hook enforcement, blueprint fingerprinting, orchestrator native Claude Code
Task path, completion policies. Plugin structure exists at plugins/makeitreal/.

**What's missing:** No README, no docs, hardcoded regex heuristics in plan-generator.mjs
(1880 lines of regex pattern matching), no recursive sub-agents (NEEDS_DECOMPOSE exists
only as a concept in plans, zero code), no Claude-driven blueprint generation, no
real-project validation, dashboard is a 4018-line HTML template.

This plan covers ALL 8 major systems. The previous 3 review rounds spent 6500+ lines
debating dashboard rendering (~5% of the product). This plan covers the other 95%.

---

## 1. BLUEPRINT GENERATION ENGINE

### Current State

The plan generator (`src/plan/plan-generator.mjs`, 1880 lines) is entirely deterministic
regex-based. The pipeline:

1. **Classify request** via regex:
   - `isApiLike()` — 5 regex patterns detect REST/HTTP/OpenAPI intent
   - `isModuleIoLike()` — regex for function/module/parser intent
   - `isOpsLike()` — regex for deployment/healthcheck intent
   - `componentProfileFromRequest()` — regex for React/Vue components
   - `hasPublicApiContractIntent()` — 5 regex patterns for API surfaces

2. **Generate profile** from classification:
   - `apiProfileFromRequest()` — hardcoded resource matching (books, orders, users, etc.)
   - `moduleProfileFromRequest()` — infers inputs/outputs via regex
   - `componentProfileFromRequest()` — infers props/stories/ARIA via regex

3. **Emit fixed-shape artifacts**: prd.json, design-pack.json, responsibility-units.json,
   work-items/*.json, work-item-dag.json, contracts/*.json, board.json

The responsibility decomposer (`src/plan/responsibility-decomposer.mjs`, 830 lines)
splits by detecting "Unit N:" markers in request text, extracting function references,
and building explicit unit decompositions with PM/integration-evidence nodes.

### Gap

- **Regex can't understand intent.** "build auth with email/password" could mean full-stack
  auth, a single endpoint, a password-reset flow, or a Firebase integration. Regex picks
  one pattern.
- **Architecture is template-driven.** Every API request gets the same 2-node graph.
  Complex multi-service architectures can't be expressed.
- **Resource matching is hardcoded.** The 11 known resources (books, orders, users, etc.)
  in `resourcePathFromRequest()` are exhaustive. Anything novel gets the slug.
- **Field inference is limited.** `knownFields` is a fixed 13-item array (customerId,
  orderId, email, password, title, author, isbn, limit, cursor, items, shippingAddress,
  query). Everything else is missed.
- **No project context.** The generator never reads the user's existing codebase.
  No package.json inspection, no file tree, no existing pattern detection.

### Plan

**Phase 1: Modularize plan-generator.mjs (no logic changes)**

Split the 1880-line monolith into focused modules:
- `src/plan/classify-request.mjs` — all regex classifiers
- `src/plan/api-profile.mjs` — API-specific profile generation
- `src/plan/module-profile.mjs` — module-specific profile generation
- `src/plan/component-profile.mjs` — component-specific profile generation
- `src/plan/artifact-emitter.mjs` — JSON artifact writing
- `src/plan/plan-generator.mjs` — thin orchestrator calling the above

Every existing test must pass unchanged. This is pure refactoring.

**Phase 2: Project context gathering**

New module: `src/plan/project-context.mjs`
- Read package.json for dependencies, test script, build script
- Scan top-level directory structure
- Detect frameworks (Express, Fastify, React, Vue, etc.)
- Find existing route/migration/test patterns
- Detect existing MIR contracts from prior runs
- Output: `ProjectContext` object consumed by both regex and Claude paths

**Phase 3: Claude-driven blueprint generation (hybrid)**

New module: `src/plan/claude-blueprint.mjs`

Pipeline:
```
User request + ProjectContext
    → System prompt + BlueprintProposal JSON schema
    → Claude API call (structured output)
    → BlueprintProposal JSON
    → Deterministic validation (blueprint-validator.mjs)
    → Deterministic normalization → canonical artifacts
    → Existing gate system validates as usual
```

The BlueprintProposal schema is already designed in blueprint-pipeline-evolution.md.
Key sections: intent, architecture (nodes + edges), responsibilityUnits, contracts
(openapi/module-io/component/event/migration kinds), workItems (DAG with dependsOn),
sequences.

Validation rules (all deterministic, no AI):
- UNIQUE_NODE_IDS, UNIQUE_WORK_ITEM_IDS
- EDGES_REFERENCE_DECLARED_NODES
- DAG_IS_ACYCLIC (topological sort on workItems.dependsOn)
- CONTRACTS_REFERENCED_EXIST (all refs point to declared contracts)
- NO_OVERLAPPING_OWNERSHIP (RU allowedPaths don't overlap)
- WORK_ITEMS_WITHIN_RU_PATHS
- ALLOWED_PATHS_ARE_VALID (reuse invalidAllowedPathPattern())
- EVERY_RU_HAS_WORK_ITEMS
- VERIFICATION_COMMANDS_PARSE (reuse normalizeVerificationCommand())
- WORK_ITEM_COUNT_WITHIN_LIMITS (max 12)
- DEPENDENCY_DEPTH_WITHIN_LIMITS (longest path <= 5)

Normalization: deterministic transform from BlueprintProposal → existing artifact shapes.
The existing gate system (src/gates/index.mjs) validates the output identically.

**Phase 4: Fallback and migration**

- `--offline` flag uses regex path (existing behavior)
- Default: Claude path with automatic fallback to regex if Claude call fails
- A/B comparison mode: generate both, compare contract coverage
- Eventual: remove regex heuristics once Claude path proves stable

### Dependencies

- Phase 1: No dependencies (pure refactoring)
- Phase 2: No dependencies (adds new module)
- Phase 3: Requires Phase 1-2, requires Claude API access configuration
- Phase 4: Requires Phase 3 running in production

### Effort Estimate

- Phase 1: 2 days (mechanical split, test-preserved)
- Phase 2: 2 days (project context scanner)
- Phase 3: 5 days (Claude integration, validator, normalizer)
- Phase 4: 1 day (fallback wiring)
- **Total: 10 days**

### Acceptance Criteria

- [ ] plan-generator.mjs is < 200 lines (orchestrator only)
- [ ] All 272 existing tests pass after modularization
- [ ] `generatePlan("build auth with email/password", {mode: "claude"})` produces valid
      artifacts that pass all gates
- [ ] `generatePlan("build a GraphQL federation gateway", {mode: "claude"})` produces
      reasonable artifacts (novel domain, impossible with regex)
- [ ] `--offline` flag reproduces exact current behavior
- [ ] BlueprintProposal validation catches cyclic DAGs, overlapping ownership, missing
      contracts, invalid paths
- [ ] At least 20 new tests for validator rules

---

## 2. CONTRACT SYSTEM

### Current State

Contracts exist as OpenAPI specs validated by `src/adapters/openapi-contract.mjs` (362
lines). The system validates:
- OpenAPI 3.x version, info + paths objects present
- Every operation has operationId, request schema, success response schema, error responses
- Request/response examples match their declared schemas
- Baseline comparison (no removed paths/operations/responses)

Module surface contracts are validated by `src/adapters/module-surface-conformance.mjs`
which checks that declared public surfaces exist in the actual codebase.

The contract-to-work-item binding works through:
- `workItem.contractIds` — which contracts this item implements
- `workItem.doneEvidence` — requires `verification` + `wiki-sync` + `openapi-conformance`
- Gate system (`src/gates/index.mjs`) enforces at Ready and Done transitions
- `validateChangedPaths()` ensures sub-agents only edit files in allowedPaths
- Completion policies (COMPLETION_POLICIES in orchestrator.mjs) require role-specific
  reports + review evidence for each node kind

### Gap

- **Only OpenAPI and module-surface contracts exist.** No event contracts, no migration
  contracts, no component contracts, no GraphQL contracts.
- **"Unit Test = QA" is aspirational.** The system enforces that verification commands
  pass, but doesn't actually generate contract-derived tests. The contract says "POST
  /users returns 201 with {id, email}" but nobody auto-generates the test that proves it.
- **No contract-to-test generation.** Sub-agents write their own tests based on reading
  the contract JSON. There's no mechanical derivation.
- **No cross-boundary integration test generation.** The integration-evidence node
  relies on a sub-agent reading contracts and manually checking. No automated wire-up.
- **Contract evolution is limited.** Only OpenAPI baseline comparison exists. No
  semantic versioning, no breaking-change detection for module-io contracts.

### Plan

**Phase 1: Contract kind expansion**

Expand the contract system to support all kinds declared in BlueprintProposal:
- `openapi` — already implemented
- `module-io` — function signature + error code contracts (partially exists in
  module-surface-conformance.mjs, needs formalization)
- `component` — prop types + render state contracts
- `event` — event name + payload schema contracts
- `migration` — schema change description contracts

Each kind gets:
- A JSON schema definition
- A validator module (`src/adapters/{kind}-contract.mjs`)
- A conformance checker (does the implementation match?)
- Registration in the gate system

**Phase 2: Contract-derived test scaffolding**

New module: `src/contracts/test-scaffold.mjs`

For each contract kind, generate test file skeletons:

OpenAPI contract `POST /users {email, password} → 201 {id, email}` generates:
```javascript
test("POST /users with valid credentials returns 201", async () => {
  const response = await request(app).post("/users")
    .send({ email: "test@example.com", password: "Password1!" });
  assert.strictEqual(response.status, 201);
  assert.ok(response.body.id);
  assert.strictEqual(response.body.email, "test@example.com");
});

test("POST /users with invalid email returns 400", async () => {
  const response = await request(app).post("/users")
    .send({ email: "not-an-email", password: "Password1!" });
  assert.strictEqual(response.status, 400);
});
```

Module-io contract `normalizeBook(input) → {title, author, year?}` generates:
```javascript
test("normalizeBook returns normalized book with required fields", () => {
  const result = normalizeBook({ title: "  Foo  ", author: "  Bar  " });
  assert.strictEqual(result.title, "Foo");
  assert.strictEqual(result.author, "Bar");
});
```

The scaffold is placed in the work item's allowedPaths test directory. The sub-agent
fills in the implementation to make these tests pass. This is how "Unit Test = QA" works:
the ENGINE generates the tests from the contract, the sub-agent makes them pass.

**Phase 3: Cross-boundary integration test generation**

For work items with dependencyContracts, generate integration test stubs that exercise
the declared contract surface between provider and consumer. These go into the
integration-evidence work item's verification commands.

**Phase 4: Contract evolution engine**

- Semantic diff for all contract kinds (not just OpenAPI baseline)
- Breaking change detection with explicit approval workflow
- Contract version history in `.makeitreal/contracts/history/`

### Dependencies

- Phase 1: No blockers
- Phase 2: Requires contract kind expansion (Phase 1)
- Phase 3: Requires Phase 2 + orchestrator supporting multiple work item verification
- Phase 4: Requires stable contract system (Phase 1-3)

### Effort Estimate

- Phase 1: 4 days (4 new contract kinds + validators)
- Phase 2: 4 days (test scaffold generation for each kind)
- Phase 3: 2 days (integration test wiring)
- Phase 4: 2 days (evolution engine)
- **Total: 12 days**

### Acceptance Criteria

- [ ] All 5 contract kinds (openapi, module-io, component, event, migration) are
      validated by the gate system
- [ ] `generateTestScaffold(contract)` produces runnable test files for openapi and
      module-io contracts
- [ ] Sub-agent receives pre-generated test files in their workspace and only needs
      to implement code that passes them
- [ ] Integration evidence node receives cross-boundary test stubs
- [ ] Contract baseline comparison works for module-io contracts (function signature
      changes detected)
- [ ] At least 30 new tests covering contract validation and scaffold generation

---

## 3. RECURSIVE ORCHESTRATION

### Current State

The orchestrator (`src/orchestrator/orchestrator.mjs`, 1045 lines) supports:
- `orchestratorTick()` — scripted simulator mode (for tests)
- `startNativeClaudeTask()` — starts Claude Code native Task sub-agents
- `finishNativeClaudeTask()` — processes sub-agent completion reports
- Completion policies for 3 node kinds: implementation, domain-pm, integration-evidence
- Native role mapping (implementation-worker, spec-reviewer, quality-reviewer,
  verification-reviewer)
- Retry with exponential backoff on failure
- Board state transitions through full Kanban lifecycle

The responsibility decomposer already creates multi-node DAGs with PM → implementation
→ integration-evidence structure. The board + dependency graph already enforce ordering.

### Gap

- **No NEEDS_DECOMPOSE protocol.** Zero code exists. The concept is mentioned in plans
  but never implemented. Sub-agents cannot signal "this work item is too large, I need
  to split it."
- **No recursive spawning.** Sub-agents complete their work item or fail. They cannot
  create child work items that spawn their own sub-agents.
- **No depth limits.** No concept of decomposition depth in the orchestrator.
- **No parent-child work item relationships.** `workItem.dependsOn` exists but
  `parentWorkItemId` does not.
- **No dynamic board modification.** The board is created by the plan generator and
  never modified during execution (except lane transitions).

### Plan

**Phase 1: NEEDS_DECOMPOSE protocol**

Add new agent report status alongside DONE, NEEDS_CONTEXT, BLOCKED:

```javascript
// In orchestrator.mjs finishNativeClaudeTask():
if (policyReport.status === "NEEDS_DECOMPOSE") {
  // Validate the suggestedSplit
  const split = policyReport.childWorkProposal;
  // ... validate and materialize
}
```

The childWorkProposal field already exists in the report schema (line 140 of
orchestrator.mjs: `childWorkProposal: candidate.childWorkProposal ?? null`).

When a sub-agent returns NEEDS_DECOMPOSE:
1. Validate depth < MAX_DEPTH (configurable, default 2)
2. Validate the suggestedSplit against BlueprintProposal schema (subset)
3. Run deterministic validation (acyclic, unique IDs, valid paths, no ownership overlap
   with sibling work items)
4. Materialize child work items on the board
5. Set parent work item to "Waiting for Children" lane (new lane)
6. When all children reach Done, auto-transition parent to Verifying

**Phase 2: Board mutation during execution**

New module: `src/board/board-mutator.mjs`

Operations:
- `materializeChildWorkItems(boardDir, parentWorkItemId, childWorkItems)`
- `reparentWorkItem(boardDir, workItemId, newParentId)`
- `completeParentWhenChildrenDone(boardDir, parentWorkItemId)`

Each mutation:
1. Validates against existing board state
2. Updates board.json atomically
3. Updates work-item-dag.json
4. Emits board event
5. Updates runtime state

**Phase 3: Parent-child relationships**

Add to work item schema:
- `parentWorkItemId: string | null` — who spawned this
- `childWorkItemIds: string[]` — what this spawned
- `decompositionDepth: number` — 0 for root, increments per level

The gate system validates:
- Children's allowedPaths ⊆ parent's allowedPaths
- Children's contractIds ⊆ parent's contractIds ∪ new contracts
- Depth < MAX_DEPTH

**Phase 4: New Kanban lane for decomposed work**

Add "Decomposing" lane between Running and Verifying:
```
Running → Decomposing (when NEEDS_DECOMPOSE)
Decomposing → Verifying (when all children Done)
```

The existing lane system (src/kanban/lanes.mjs) needs:
- New lane: "Decomposing"
- New transitions: Running → Decomposing, Decomposing → Verifying
- Gate: `childrenComplete` for Decomposing → Verifying

### Dependencies

- Phase 1: Requires understanding of finishNativeClaudeTask flow
- Phase 2: No external dependencies
- Phase 3: Requires Phase 1-2
- Phase 4: Requires Phase 3

### Effort Estimate

- Phase 1: 3 days (protocol + validation)
- Phase 2: 2 days (board mutation engine)
- Phase 3: 2 days (parent-child schema + gates)
- Phase 4: 1 day (new lane + transitions)
- **Total: 8 days**

### Acceptance Criteria

- [ ] Sub-agent returning `{status: "NEEDS_DECOMPOSE", childWorkProposal: {...}}` causes
      child work items to appear on the board
- [ ] Depth limit is enforced: depth 3 returns error
- [ ] Child work items are dispatched to sub-agents that complete independently
- [ ] Parent auto-transitions to Verifying when all children reach Done
- [ ] Dashboard shows expandable parent-child hierarchy
- [ ] At least 15 new tests for NEEDS_DECOMPOSE flow
- [ ] E2E test: request → plan → start → NEEDS_DECOMPOSE → children complete → parent Done

---

## 4. PLUGIN ARCHITECTURE (Claude Code Integration)

### Current State

The plugin structure exists at `plugins/makeitreal/` with a full mirror of dev-harness
source (50 files). The integration works through:

**Hooks** (`hooks/claude/`):
- `pre-tool-use.mjs` — intercepts Edit/Write/MultiEdit/Bash, enforces path boundaries
- `stop.mjs` — captures session end state
- `user-prompt-submit.mjs` — intercepts user prompts

Hook installation (`src/hooks/claude-settings.mjs`):
- Writes to `.claude/settings.local.json`
- Configures UserPromptSubmit, PreToolUse, Stop hooks
- Each hook runs via `HARNESS_RUN_DIR=... node hooks/claude/xxx.mjs`

**CLI** (`bin/harness.mjs`):
- Commands: plan, design render, contracts openapi, gate, verify, wiki sync, status,
  orchestrator, blueprint review, kanban, doctor, hooks
- Invoked as `makeitreal-engine <command> [args]`

**Plugin sync** (`scripts/sync-plugin-engine.mjs`, `scripts/validate-claude-plugin.mjs`):
- Copies engine source into plugin directory
- Validates the plugin structure

### Gap

- **No slash commands.** The existing CLI works but Claude Code plugins typically expose
  `/command` syntax. No `/makeitreal:plan`, `/makeitreal:launch`, etc.
- **No skills.** No `.claude/skills/` integration for teaching Claude how to use MIR.
- **No marketplace packaging.** The plugin isn't packaged for `claude plugin install`.
- **Install experience is manual.** Users must clone the repo, run install hooks, etc.
- **No configuration UI.** No `makeitreal.config.json` with IDE-style config.
- **No project detection.** Doesn't auto-detect project type to suggest defaults.

### Plan

**Phase 1: Slash command registration**

Create Claude Code slash command definitions:
```
/makeitreal:plan <request>     — Generate a blueprint
/makeitreal:approve            — Approve the current blueprint
/makeitreal:launch             — Start sub-agent execution
/makeitreal:status             — Show current run status
/makeitreal:dashboard          — Open the live dashboard
/makeitreal:demo <template>    — Generate a demo blueprint from templates
/makeitreal:doctor             — Diagnose configuration issues
```

Each slash command maps to the existing CLI but with Claude Code integration (reads
from current session, writes to project .makeitreal/).

**Phase 2: Skills integration**

Create `.claude/skills/makeitreal.md` that teaches Claude:
- What MIR is and when to use it
- How to interpret blueprint artifacts
- How to follow the Blueprint First workflow
- How to report status correctly (the JSON report format)
- When to signal NEEDS_DECOMPOSE vs BLOCKED vs NEEDS_CONTEXT

**Phase 3: One-command install**

```bash
npx makeitreal init
```

This should:
1. Create `.makeitreal/` directory structure
2. Install Claude hooks in `.claude/settings.local.json`
3. Add `.makeitreal` to `.gitignore`
4. Create `makeitreal.config.json` with detected project defaults
5. Print getting-started instructions

**Phase 4: Marketplace packaging**

Package as a Claude Code plugin with:
- `plugin.json` manifest
- Version pinning
- Auto-update mechanism
- Plugin settings UI

### Dependencies

- Phase 1: Requires existing CLI commands (already exist)
- Phase 2: No blockers
- Phase 3: Requires Phase 1-2
- Phase 4: Requires Claude Code marketplace API (external dependency)

### Effort Estimate

- Phase 1: 3 days
- Phase 2: 1 day
- Phase 3: 2 days
- Phase 4: 2 days (dependent on marketplace availability)
- **Total: 8 days**

### Acceptance Criteria

- [ ] `/makeitreal:plan "build auth with email/password"` generates a blueprint in the
      current project
- [ ] `/makeitreal:launch` starts sub-agent execution visible in dashboard
- [ ] `npx makeitreal init` sets up a fresh project in < 30 seconds
- [ ] Skills file correctly guides Claude through the workflow
- [ ] Plugin sync passes: `npm run plugin:validate` succeeds
- [ ] Hook status: `makeitreal-engine hooks status` shows all hooks installed

---

## 5. VISUALIZATION & UX

### Current State

**Dashboard** (`src/preview/render-dashboard-html.mjs`):
- Generates a single HTML file with embedded CSS/JS (4018 lines)
- Static snapshot, no live updates
- Shows: architecture diagram, work item DAG, contract details, responsibility map,
  Kanban board, evidence summary
- No interactivity beyond basic styling

**Preview model** (`src/preview/preview-model.mjs`):
- Generates structured preview data: workItems, contracts, architecture, evidence
- Already outputs JSON suitable for a React app

**Operator summary** (`src/status/operator-summary.mjs`):
- Phase detection: planning-required, approval-required, blocked, launch-ready,
  running, verifying, human-review, failed-fast, rework-required, done
- Blocker diagnosis with actionable next steps
- Evidence summary

**CLI output**: JSON to stdout, no formatting.

### Gap (settled decisions from FINAL-ARCHITECTURE-v3.md)

- Dashboard needs to be React Flow + live WebSocket (settled)
- One rendering path: localhost server, no file:/// tier (settled)
- Server: zero-dep Node.js HTTP+WS like superpowers (settled)
- Client: React 19 + React Flow + Zustand, pre-built dist/ committed (settled)
- CLI output needs human-readable formatting (not settled)

### Plan

**Phase 1: Live server** (2 days)

New module: `src/dashboard/server.mjs`

Zero-dependency Node.js HTTP server:
- Serves pre-built React app from dist/
- WebSocket for live updates (fs.watch on preview-model.json)
- REST API endpoints:
  - `GET /api/model` — current preview model
  - `GET /api/status` — operator summary
  - `POST /api/blueprint/review` — approve/reject blueprint
  - `GET /api/events` — SSE stream of board events
- Auto-opens browser on start
- Graceful shutdown

**Phase 2: React dashboard** (6 days)

9 components from react-component-library-spec.md:
- HeroSection — run title, phase badge, next action button
- TopologyGraph — architecture nodes + contract edges (React Flow)
- TaskDAG — work item dependency graph with lane colors (React Flow)
- ContractPanel — OpenAPI/module-io contract display
- ResponsibilityMap — RU boundaries with owned files
- SequenceDiagram — call flow for complex interactions
- KanbanBoard — live lane transitions
- FileTree — owned files per work item
- DetailDrawer — click-to-inspect any entity

Cross-panel linking via Zustand selection store. Dark mode default.
Bundle committed to repo as dist/ (no runtime build step for users).

**Phase 3: CLI formatting** (1 day)

New module: `src/cli/formatter.mjs`

- Colored phase indicators (green=done, yellow=running, red=blocked)
- Compact Kanban board in terminal (ASCII table)
- Progress bar for multi-item runs
- Error messages with actionable next steps
- `--json` flag preserves machine-readable output

**Phase 4: Operator reports** (1 day)

- Summary report after run completes: what was built, evidence collected, time spent
- Exportable HTML report for stakeholder sharing
- Git diff summary: all files changed across all work items

### Dependencies

- Phase 1: No blockers
- Phase 2: Requires Phase 1 (server), requires React Flow (npm install)
- Phase 3: No blockers (independent of dashboard)
- Phase 4: Requires Phase 1 (server for HTML export)

### Effort Estimate

- Phase 1: 2 days
- Phase 2: 6 days
- Phase 3: 1 day
- Phase 4: 1 day
- **Total: 10 days**

### Acceptance Criteria

- [ ] `makeitreal-engine dashboard` opens browser with live React Flow dashboard
- [ ] Dashboard updates in real-time as sub-agents progress
- [ ] Click any node/edge to see details in drawer
- [ ] Blueprint approval works from browser (POST /api/blueprint/review)
- [ ] CLI shows colored status output by default, JSON with --json
- [ ] Dashboard loads in < 2 seconds, handles 20+ work items smoothly

---

## 6. DOCUMENTATION & DEVELOPER EXPERIENCE

### Current State

- **No README.** Zero documentation.
- **No docs directory.** No getting-started guide, no concept docs.
- **2 example fixtures**: `examples/canonical/` (feature-auth) and `examples/kanban/`
- **42 test files** with good coverage but no doc comments explaining what they test
- **7 plan documents** in `.hermes/plans/` (internal, not user-facing)

### Gap

This is a 10k-star goal. The README alone determines whether someone tries the tool.
Current state: they'd clone a repo with no README and have no idea what it does.

### Plan

**Phase 1: README.md** (2 days)

Structure (proven pattern from 10k+ star repos):
```
# Make It Real 🏗️

One sentence: what it does.

[3-second GIF showing: type request → blueprint appears → sub-agents work → done]

## The Problem
Claude Code is powerful but chaotic. Give it "build auth" and you get...

## The Solution
Blueprint First: architect → contract → decompose → verify.

## Quick Start
npx makeitreal init
/makeitreal:plan "build auth with email/password"
/makeitreal:approve
/makeitreal:launch

## How It Works
[Pipeline diagram: Request → Blueprint → Contracts → DAG → Sub-agents → Done]

## Key Concepts
- Blueprints: ...
- Contracts: ...
- Responsibility Units: ...
- "Unit Test = QA": ...

## Comparison
| Feature | Vanilla Claude | Cursor | Make It Real |
|---------|---------------|--------|-------------|
| Architecture first | ❌ | ❌ | ✅ |
| Contract enforcement | ❌ | ❌ | ✅ |
| Parallel sub-agents | ❌ | ❌ | ✅ |
| ...

## Examples
- [Todo App](examples/todo-app/) — simple CRUD
- [Auth System](examples/auth-system/) — multi-module with contracts
- [Monorepo](examples/monorepo/) — multi-package with cross-boundary contracts

## License
MIT
```

**Phase 2: docs/ directory** (3 days)

- `docs/getting-started.md` — install, first blueprint, approve, launch, verify
- `docs/how-it-works.md` — full pipeline walkthrough with diagrams
- `docs/concepts/blueprints.md` — what blueprints are, artifact structure
- `docs/concepts/contracts.md` — contract kinds, enforcement, "Unit Test = QA"
- `docs/concepts/responsibility-units.md` — boundaries, ownership, path enforcement
- `docs/concepts/kanban.md` — lane lifecycle, gates, transitions
- `docs/concepts/orchestration.md` — sub-agents, native tasks, completion policies
- `docs/api-reference.md` — CLI commands, configuration options
- `docs/troubleshooting.md` — common errors, doctor command, recovery

**Phase 3: Example blueprints** (2 days)

3 complete examples that users can run immediately:

1. **todo-app** — Simple CRUD app, single responsibility unit, module-io contracts
2. **auth-system** — Multi-module: API endpoint + password hasher + session store +
   migration. Cross-boundary contracts. 4-node DAG.
3. **monorepo** — Multi-package workspace with shared contracts. Shows recursive
   decomposition.

Each example includes:
- Input request
- Generated artifacts (prd, design-pack, contracts, work items, DAG)
- Expected output (what files sub-agents would create)
- Running instructions

**Phase 4: asciicast GIF** (0.5 days)

Record with asciinema:
- Start with empty project
- Run `/makeitreal:plan "build a REST API for managing books"`
- Show blueprint generation (artifacts appearing)
- Approve blueprint
- Launch sub-agents
- Dashboard showing progress
- All work items reach Done

Convert to GIF, embed in README.

### Dependencies

- Phase 1: Requires knowing the install experience (Plugin Phase 3)
- Phase 2: No blockers (describes existing + planned functionality)
- Phase 3: Requires working plan generator
- Phase 4: Requires working demo flow end-to-end

### Effort Estimate

- Phase 1: 2 days
- Phase 2: 3 days
- Phase 3: 2 days
- Phase 4: 0.5 days
- **Total: 7.5 days**

### Acceptance Criteria

- [ ] README has: tagline, GIF, problem/solution, quick start, comparison table, examples
- [ ] New user can go from clone → working demo in < 5 minutes following docs
- [ ] 3 example blueprints run end-to-end with `npm run check`
- [ ] API reference covers all CLI commands with examples
- [ ] Troubleshooting covers the 10 most common error codes

---

## 7. VALIDATION STRATEGY

### Current State

- 272 unit/integration tests across 42 test files
- E2E test (`test/e2e.test.mjs`) runs full pipeline on canonical example
- Phase 2 E2E test (`test/phase2-e2e.test.mjs`) tests orchestrator flow
- `npm run check` runs: tests → design render → contracts → gate Ready → verify →
  wiki sync → gate Done on the canonical example

### Gap

- **Only tested on fixture data.** The canonical example (feature-auth) and kanban
  example are hand-crafted fixtures. Never tested on a real project.
- **No diverse request testing.** The plan generator is tested with a handful of
  known request patterns. Never tested with ambiguous, novel, or adversarial requests.
- **No performance testing.** Unknown how the system handles large projects (100+ files,
  20+ work items).
- **No Claude integration testing.** All Claude interactions are mocked in tests.
- **No user testing.** No external users have tried the tool.

### Plan

**Phase 1: Request diversity testing** (2 days)

Create a test suite of 50+ diverse requests:
- Simple: "add a health endpoint", "create a utils module"
- Medium: "build auth with email/password", "add search with pagination"
- Complex: "build a multi-tenant SaaS dashboard with role-based access"
- Adversarial: "do everything", "fix bugs", "make it faster"
- Framework-specific: "add a React component with Storybook", "create Express middleware"
- Novel: "build a WebSocket chat server", "create a CLI tool with subcommands"

For each request, validate:
- Plan generator produces valid artifacts
- All gates pass
- Artifacts are internally consistent
- Contract coverage is reasonable

**Phase 2: Real project validation** (5 days)

Test on 3 real open-source projects:

1. **Express starter** (small): Clone express-generator output, run MIR to add auth
2. **Next.js app** (medium): Clone a Next.js starter, run MIR to add dashboard features
3. **Monorepo** (large): Clone a turborepo starter, run MIR to add a new package with
   cross-package contracts

For each project:
- Does MIR correctly detect project context?
- Does the blueprint make architectural sense?
- Can sub-agents actually implement the work items?
- Do verification commands pass?
- Is the total time reasonable?

**Phase 3: Claude integration testing** (2 days)

Test the Claude-driven blueprint generation with actual Claude API calls:
- Response parsing and validation
- Error handling (rate limits, malformed responses, timeouts)
- Quality comparison: Claude vs regex for the same request
- Cost tracking per blueprint generation

**Phase 4: Beta testing** (ongoing)

Recruit 5-10 early users:
- Set up feedback channel (GitHub Discussions or Discord)
- Collect: install friction, first-run experience, blueprint quality, overall value
- Track: time-to-first-blueprint, completion rate, error frequency

### Dependencies

- Phase 1: Requires plan generator (existing)
- Phase 2: Requires Claude-driven generation (Blueprint Engine Phase 3)
- Phase 3: Requires Claude integration (Blueprint Engine Phase 3)
- Phase 4: Requires documentation (Docs Phase 1-2) + working install (Plugin Phase 3)

### Effort Estimate

- Phase 1: 2 days
- Phase 2: 5 days
- Phase 3: 2 days
- Phase 4: ongoing (not counted in timeline)
- **Total: 9 days**

### Acceptance Criteria

- [ ] 50+ diverse requests all produce valid artifacts
- [ ] MIR successfully runs on 3 real open-source projects
- [ ] Claude-driven generation handles error cases gracefully
- [ ] Sub-agents successfully implement at least 1 real feature end-to-end
- [ ] No regressions: all 272 original tests still pass
- [ ] Performance: blueprint generation < 30 seconds, dashboard loads < 2 seconds

---

## 8. RELEASE PLAN

### v0.2 — "It Works" (Current → +4 weeks)

**Goal:** A developer can install MIR, generate a blueprint, approve it, and launch
sub-agents on a real project. The blueprint uses Claude for generation.

Contains:
- Blueprint Engine Phases 1-3 (modularized generator, project context, Claude hybrid)
- Contract System Phase 1 (expanded contract kinds)
- Plugin Phase 1-2 (slash commands, skills)
- Visualization Phase 1 (live server)
- Docs Phase 1 (README)
- Validation Phase 1 (request diversity testing)

**Ship criteria:**
- `/makeitreal:plan` generates a Claude-driven blueprint
- `/makeitreal:launch` starts sub-agents
- Live server shows progress
- README exists with quick start

### v0.3 — "It's Good" (+4 weeks → +8 weeks)

**Goal:** Contract-derived tests prove sub-agent work. Dashboard is interactive.
Recursive decomposition works.

Contains:
- Contract System Phases 2-3 (test scaffolding, integration tests)
- Recursive Orchestration Phases 1-4 (NEEDS_DECOMPOSE, full flow)
- Visualization Phases 2-3 (React dashboard, CLI formatting)
- Docs Phases 2-3 (full docs, example blueprints)
- Validation Phase 2 (real project testing)

**Ship criteria:**
- Sub-agents receive contract-derived tests and pass them
- NEEDS_DECOMPOSE creates child work items that complete
- React Flow dashboard with live updates
- 3 example blueprints
- Successfully runs on a real Express project

### v1.0 — "10k Stars" (+8 weeks → +12 weeks)

**Goal:** Polish, performance, viral mechanics. Ready for public launch.

Contains:
- Blueprint Engine Phase 4 (fallback removal)
- Contract System Phase 4 (evolution engine)
- Plugin Phases 3-4 (one-command install, marketplace)
- Visualization Phase 4 (operator reports)
- Docs Phase 4 (asciicast GIF)
- Validation Phases 3-4 (Claude integration testing, beta)

**Ship criteria:**
- `npx makeitreal init` → working demo in < 2 minutes
- asciicast GIF in README
- 3 real project validations documented
- Comparison page showing MIR vs vanilla Claude Code
- Performance optimized for 20+ work item projects
- Zero known blockers

### 10k Star Strategy

1. **README is the product.** GIF → problem → solution → 3-line quick start → comparison table.
2. **Demo in 30 seconds.** `/makeitreal:demo todo-app` generates a complete blueprint
   with dashboard.
3. **Viral mechanic:** `.makeitreal/` directory in your project. When someone opens
   your PR, they see the blueprint that generated it.
4. **Comparison content:** "I gave Claude Code the same prompt with and without MIR.
   Here's what happened." Blog post / X thread / HN post.
5. **Community examples:** Users share their blueprints. Best ones become built-in
   templates.
6. **Integration with existing ecosystem:** Works with any Claude Code project. No
   lock-in, no framework requirements.

---

## Unified Timeline

```
Week 1-2: Foundation
├─ Stream A: Blueprint Engine Phase 1 (modularize) ─────── 2 days
├─ Stream A: Blueprint Engine Phase 2 (project context) ── 2 days
├─ Stream B: Contract System Phase 1 (kind expansion) ──── 4 days
├─ Stream C: Docs Phase 1 (README) ─────────────────────── 2 days
├─ Stream C: Plugin Phase 2 (skills) ───────────────────── 1 day
└─ Stream D: Visualization Phase 1 (live server) ────────── 2 days

Week 3-4: Core Intelligence
├─ Stream A: Blueprint Engine Phase 3 (Claude hybrid) ──── 5 days
├─ Stream B: Plugin Phase 1 (slash commands) ───────────── 3 days
├─ Stream C: Validation Phase 1 (request diversity) ────── 2 days
└─ Stream A: Blueprint Engine Phase 4 (fallback) ────────── 1 day

>>> v0.2 RELEASE <<<

Week 5-6: Contract Power
├─ Stream A: Contract System Phase 2 (test scaffold) ───── 4 days
├─ Stream B: Recursive Orch Phases 1-2 (protocol + board) ─ 5 days
├─ Stream C: Visualization Phase 2 (React dashboard) ───── 6 days [start]
└─ Stream D: Docs Phase 2 (concept guides) ─────────────── 3 days

Week 7-8: Integration
├─ Stream A: Contract System Phase 3 (cross-boundary) ──── 2 days
├─ Stream B: Recursive Orch Phases 3-4 (hierarchy + lanes)─ 3 days
├─ Stream C: Visualization Phase 2 (React dashboard) ───── 6 days [finish]
├─ Stream C: Visualization Phase 3 (CLI formatting) ────── 1 day
├─ Stream D: Docs Phase 3 (example blueprints) ──────────── 2 days
└─ Stream D: Validation Phase 2 (real projects) ──────────── 5 days [start]

>>> v0.3 RELEASE <<<

Week 9-10: Polish
├─ Stream A: Contract System Phase 4 (evolution) ────────── 2 days
├─ Stream B: Plugin Phase 3 (one-command install) ────────── 2 days
├─ Stream C: Visualization Phase 4 (operator reports) ──── 1 day
├─ Stream D: Validation Phase 2 (real projects) ──────────── 5 days [finish]
└─ Stream D: Validation Phase 3 (Claude integration) ────── 2 days

Week 11-12: Launch
├─ Stream A: Plugin Phase 4 (marketplace) ─────────────── 2 days
├─ Stream B: Docs Phase 4 (GIF, final polish) ─────────── 0.5 days
├─ Stream C: Validation Phase 4 (beta) ────────────────── ongoing
└─ Stream D: 10k star launch preparation ──────────────── 2 days

>>> v1.0 RELEASE <<<
```

### Dependency Graph (Critical Path)

```
Blueprint Engine Ph1 (modularize)
  → Blueprint Engine Ph2 (project context)
    → Blueprint Engine Ph3 (Claude hybrid) ← CRITICAL PATH
      → Contract System Ph2 (test scaffold)
        → Contract System Ph3 (cross-boundary)
          → Validation Ph2 (real projects) ← CRITICAL PATH
            → v1.0

Visualization Ph1 (server)
  → Visualization Ph2 (React dashboard) ← LONGEST STREAM (6 days)
    → v0.3

Plugin Ph1 (slash commands) + Plugin Ph2 (skills)
  → Plugin Ph3 (install)
    → Docs Ph4 (GIF)
      → v1.0

Recursive Orch Ph1-4 is independent until Validation Ph2
```

### Total Effort

| Area                     | Days  |
|--------------------------|-------|
| Blueprint Engine         | 10    |
| Contract System          | 12    |
| Recursive Orchestration  | 8     |
| Plugin Architecture      | 8     |
| Visualization & UX       | 10    |
| Documentation & DX       | 7.5   |
| Validation Strategy      | 9     |
| **Total (sequential)**   | **64.5** |
| **With 3 parallel streams** | **~22 working days** |

### Risk Mitigation

1. **Claude API reliability.** Mitigation: regex fallback is always available.
   Blueprint Engine Phase 4 only removes regex after Claude path is proven stable.

2. **React Flow complexity.** Mitigation: pre-built dist/ means no runtime build
   issues. If React Flow is too heavy, fall back to a simpler graph library.

3. **Recursive orchestration edge cases.** Mitigation: depth limit of 2, validation
   at every decomposition. Start with scripted simulator tests before real Claude agents.

4. **Real project failures.** Mitigation: start with simple Express projects, work up
   to complex monorepos. Blueprint quality is gated by validation rules.

5. **10k stars is ambitious.** Mitigation: the README + GIF + comparison content is
   the highest-leverage work. Ship that first (v0.2) and iterate based on feedback.

---

## Architecture of the Architecture

How all pieces fit together:

```
USER types: "build auth with email/password"
  │
  ▼
PLUGIN (slash command) receives request
  │
  ▼
BLUEPRINT ENGINE
  ├─ Project Context Scanner reads codebase
  ├─ Claude generates BlueprintProposal (or regex fallback)
  ├─ Validator checks structural correctness
  ├─ Normalizer emits canonical artifacts
  │   ├─ prd.json
  │   ├─ design-pack.json
  │   ├─ responsibility-units.json
  │   ├─ contracts/*.json
  │   ├─ work-items/*.json
  │   └─ work-item-dag.json
  └─ Gate system validates Ready gate
  │
  ▼
USER approves blueprint (terminal or dashboard)
  │
  ▼
CONTRACT SYSTEM
  ├─ Generates test scaffolds from contracts
  ├─ Places tests in work item allowedPaths
  └─ Integration test stubs for cross-boundary items
  │
  ▼
ORCHESTRATOR launches sub-agents
  ├─ Follows DAG ordering (dependency graph)
  ├─ Each sub-agent gets: prompt + allowedPaths + contracts + test stubs
  ├─ Pre-tool-use hook enforces path boundaries
  ├─ Sub-agent implements code to pass contract-derived tests
  ├─ If NEEDS_DECOMPOSE: recursive spawning with depth limits
  ├─ Completion policy validates: report + reviews + boundary + evidence
  └─ Board transitions: Ready → Running → Verifying → Done
  │
  ▼
VERIFICATION (gate system)
  ├─ Verification commands pass (npm test, etc.)
  ├─ OpenAPI conformance (implementation matches spec)
  ├─ Module surface conformance (exports match contract)
  ├─ Wiki sync (documentation updated)
  └─ Done gate validates all evidence
  │
  ▼
DASHBOARD shows progress in real-time
  ├─ React Flow: architecture graph, task DAG
  ├─ Kanban board with live lane transitions
  ├─ Contract details, responsibility map
  └─ Operator summary with next actions

RESULT: "Unit Test = QA" because:
  1. Contracts define the interface
  2. Tests are derived FROM the contracts
  3. Sub-agents implement code that passes those tests
  4. Gate system verifies conformance
  5. No sub-agent can edit files outside its boundary
  6. Integration tests prove cross-boundary contracts hold
```

This is the complete product. Not a dashboard. Not a planning tool. A development
methodology implemented as a Claude Code plugin.
