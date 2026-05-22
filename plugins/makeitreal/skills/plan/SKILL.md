---
name: plan
description: Use when a feature request needs Make It Real PRD, architecture, responsibility boundaries, contracts, design-pack artifacts, or Kanban work decomposition before implementation.
---

# Make It Real Plan

Create a zero-context implementation packet before any code changes. The packet must be specific enough for another agent or machine to verify implementation against it. The user-facing action is `/makeitreal:plan`.

**YOU (Claude Code) are the architect.** Generate the BlueprintProposal JSON yourself from the project context and user request. The engine only validates and saves — it does not do the architecture thinking.

Subcommands:

- `/makeitreal:plan` with no request starts interactive intake through Claude Code `AskUserQuestion`, then generates the Blueprint from the collected canonical request.
- `/makeitreal:plan <request>` generates reviewable PRD/Blueprint artifacts and seeds pending approval.
- Native Claude Code conversational review is the normal path: after the Blueprint is shown, the `UserPromptSubmit` hook injects the pending-review protocol, the current Claude Code session classifies the user's reply as `approved`, `rejected`, `revision_requested`, or `none`, and clear review decisions are recorded as `makeitreal:interactive-review:native-claude`.
- `/makeitreal:plan approve` is the explicit/scriptable control that approves the current Blueprint through the internal `blueprint approve` command.
- `/makeitreal:plan reject` is the explicit/scriptable control that rejects the current Blueprint through the internal `blueprint reject` command.

## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Prompt Discipline

### Conditional Grill

Ask a short clarification round only when the plan cannot honestly define ownership, contracts, or verification. Keep it to the missing decision: owner, allowed paths, public contract, or real verification command. If the missing piece can be inferred from existing project files, inspect those files first instead of interviewing the user.

When `/makeitreal:plan` is invoked without a request, clarification is not optional. Use `AskUserQuestion` to collect the missing feature request before calling the engine. Continue with one focused `AskUserQuestion` at a time until the request is specific enough to name intended behavior, responsibility boundary, contract/API/IO expectation, and verification expectation.

Do not invent placeholders to pass Ready. If no honest verification command exists, report the blocked Ready gate and the exact missing command shape.

### Dynamic Intake

Do not use a fixed question script. Treat request intake as an adaptive spec-refinement loop: read the current repo context, surface assumptions, derive the next question from the single most important ambiguity, then converge as soon as the Blueprint can be reviewed.

Use `AskUserQuestion` as the HITL UI, not as a canned questionnaire. The next question should be generated from one of these missing facts:

- intended user-visible behavior and success criteria;
- responsibility unit and exactly-one owner;
- cross-boundary contract, API, schema, or IO surface;
- allowed path scope and files that must not be touched;
- real verification evidence, including test/build/static/contract checks.

Borrow the spec-first shape: clarify objective, success criteria, project constraints, and boundaries before planning. Borrow the task-breakdown shape: prefer vertical slices, explicit dependencies, acceptance criteria, and checkpoints. Borrow context-engineering discipline: inspect relevant local files before asking and keep intake focused on the current missing decision.

After each answer, restate only the updated assumption that affects the plan. If the answer creates a conflict with existing code or prior user direction, surface that conflict and ask the next `AskUserQuestion` about the conflict rather than silently choosing a side.

### Read-Only Parallel Reconnaissance

When the request is broad, cross-cutting, or likely to require repo discovery before a good question can be asked, use read-only `Task` subagents before asking the operator. Task subagents are for reconnaissance only during planning: they may inspect files, map responsibilities, find existing patterns, and report candidate boundaries, but they must not edit files or start implementation.

Use parallel reconnaissance only when it reduces uncertainty. Good split points are independent domains, such as current architecture, tests/verification commands, public API or IO contracts, and naming/path conventions. Synthesize subagent findings into one operator-facing summary before asking the next `AskUserQuestion`.

Do not outsource the actual planning decision to subagents. The leader owns the canonical request, Blueprint wording, and the final question shown to the operator.

### Operator-Facing Questions

Do not expose internal harness terms in `AskUserQuestion` prompts unless the user is explicitly developing Make It Real itself or asks for internals. Avoid raw terms such as board, orchestrator, owner, responsibility unit, lane, claim, gate, and run directory in user-facing choices.

Translate internal concepts into the user's domain language:

- say "Which part of the product/codebase should this change belong to?" instead of "which owner/responsibility unit owns this?";
- say "Should this be one end-to-end slice or split into separate work packages?" instead of "vertical slice vs board domains?";
- say "What files or areas should be safe to change?" instead of "allowed paths";
- say "How should we prove it works?" instead of "verification evidence".

The Blueprint may still contain precise internal fields required by the engine. The conversation should present those fields as a plain-language summary first, with raw identifiers only when useful for an advanced user or for copyable commands.

### Operator-Facing Blueprint Report

After a plan is generated, present the Blueprint as a reviewable development plan, not as an engine status dump. Do not lead with raw engine fields such as `planOk`, `implementationReady`, `HARNESS_*` codes, fingerprint hashes, run ids, run directories, owner ids, contract ids, lane names, or allowed-path lists.

Use the user's language and prefer compact Markdown tables for reviewable content. The primary report should follow this shape:

- **What will be delivered** - show the intended outcome, concrete deliverables, product/codebase value, and acceptance evidence.
- **Scope boundaries** - show what is in scope, what is intentionally out of scope, and what code areas are expected to change.
- **Work packages** - show each work package, its purpose, dependencies, and verification method in plain project language.
- **How we will prove it works** - show test, contract, static analysis, manual review, or evidence expectations.
- **Review decisions** - show only decisions the operator needs to approve, reject, or revise before launch.
- **Dashboard and next action** - include the dashboard URL and the conversational or explicit command path for approval, revision, or rejection.

Diagnostics are secondary. Only mention raw engine fields when the plan failed, the user asks for details, or the detail is necessary for a copyable command. Pending Blueprint approval is normal review state; say "Blueprint review is waiting for approval" rather than exposing `HARNESS_BLUEPRINT_APPROVAL_PENDING` as the headline.

### Review Decision UX

After the operator-facing Blueprint report, ask a final Claude Code `AskUserQuestion` review question. This question UI should make the normal choices obvious: approve and launch, request changes, or reject. Keep the wording in the user's language and allow free-form feedback for revisions.

All review paths must converge on the current Claude Code session as the review judge and the same `blueprint-review.json` authority:

- question UI answer: classify the full answer against the Blueprint report in the current Claude Code session, then call the internal `blueprint review --prompt <operator answer> --decision-json <native judgment>` command with that native judgment;
- later chat reply: rely on the `UserPromptSubmit` hook, which injects the reply, previous assistant message, and native review protocol back into the current Claude Code session;
- explicit slash command: keep `/makeitreal:plan approve` and `/makeitreal:plan reject` only as scriptable controls.

Do not branch on option labels, button text, keywords, or short replies such as "yes". The current Claude Code session owns the approval, rejection, revision-request, or no-op classification and records non-noop decisions through `blueprint review --prompt <operator answer> --decision-json <native judgment>`. Always include both `--prompt` and `--decision-json`; always include `decision` and `launchRequested`; include `confidence` and `reason` when available, but they are evidence metadata and the engine can default them if omitted. If the question is dismissed, report that the operator can still answer naturally in chat; do not force `/makeitreal:plan approve`.

### Shared Language

Before producing the Blueprint, normalize the user's words into project language:

- responsibility unit names, independent of programming language or framework;
- domain terms that must appear in PRD acceptance criteria;
- public contract names and IO/schema names;
- forbidden ambiguous words that need replacement before launch;
- naming conventions visible in nearby source files.

The generated plan should be readable by a zero-context agent and by a human reviewer. Acceptance criteria must be concrete enough to verify from tests, generated contracts, AST/static checks, or equivalent evidence.

### Boundary Proposal

For broad requests, prefer vertical slice work items when one team can own the full slice from contract to verification. When a single owner would hide real team boundaries, fail fast with `HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS` and surface the engine's `suggestedBoundaries`.

When reporting `suggestedBoundaries`, show each proposed owner, allowed path set, contract ID, and verification command. Treat it as a review proposal, not automatic approval.

## Architecture: Claude Code Generates, Engine Validates

The primary workflow is:

1. **You (Claude Code) read project context** — file tree, package.json, existing code, existing patterns
2. **You generate a BlueprintProposal JSON** — following the schema and rules below
3. **You pipe the JSON to the engine** — the engine validates and saves artifacts
4. **You present the Blueprint for review** — using the operator-facing report format above

### How to Import a BlueprintProposal

After generating the BlueprintProposal JSON, write it to a temporary file and pipe it to the engine:

```bash
cat /tmp/blueprint-proposal.json | makeitreal-engine blueprint import "$RUN_DIR" --runner claude-code
```

Or inline:

```bash
echo '<BlueprintProposal JSON>' | makeitreal-engine blueprint import "$RUN_DIR" --runner claude-code
```

The engine will:
1. Parse and validate the JSON against all structural rules
2. Normalize into canonical artifacts (PRD, design-pack, work-items, contracts, etc.)
3. Write artifacts to `$RUN_DIR`
4. Create board.json, trust-policy.json, runtime-state.json
5. Seed blueprint-review.json for pending approval
6. Render the design preview/dashboard
7. Return `{ok, runDir, runId, workItemCount, errors}`

If validation fails, the engine returns structured errors. Fix the proposal and retry.

Optional flags:
- `--slug <id>` or `--run <id>` — set a stable run ID
- `--runner claude-code|scripted-simulator` — runner mode for trust policy (default: claude-code)

### BlueprintProposal JSON Schema

Generate a JSON object with this exact structure:

```json
{
  "intent": {
    "title": "Human-readable title",
    "summary": "1-3 sentence description",
    "goals": ["Measurable outcome 1", "Measurable outcome 2"],
    "nonGoals": ["Explicit exclusion"],
    "userVisibleBehavior": ["Observable behavior when done"],
    "acceptanceCriteria": [
      {
        "id": "AC-001",
        "statement": "Concrete acceptance criterion",
        "verifiedBy": "wi.work-item-id"
      }
    ],
    "assumptions": [
      {
        "assumption": "Description",
        "confidence": "high|medium|low",
        "ifWrong": "Consequence"
      }
    ]
  },
  "architecture": {
    "style": "Architecture style description",
    "rationale": "Why this architecture",
    "nodes": [
      {
        "id": "node-id",
        "label": "Human label",
        "kind": "service|module|database|external|queue|ui-component",
        "responsibilityUnitId": "ru.unit-id",
        "description": "What this node does"
      }
    ],
    "edges": [
      {
        "from": "node-id-a",
        "to": "node-id-b",
        "contractId": "contract.id",
        "label": "relationship description",
        "style": "sync|async|event|import"
      }
    ]
  },
  "responsibilityUnits": [
    {
      "id": "ru.unit-id",
      "label": "Human label",
      "owner": "team.implementation",
      "owns": ["src/path/**", "test/path/**"],
      "mustProvideContracts": ["contract.id"],
      "mayUseContracts": ["contract.other-id"],
      "responsibility": "What this unit is responsible for"
    }
  ],
  "contracts": [
    {
      "contractId": "contract.id",
      "kind": "openapi|module-io|component|event|migration",
      "title": "Contract title",
      "provider": "ru.unit-id",
      "consumers": ["ru.other-unit"],
      "surface": {}
    }
  ],
  "workItems": [
    {
      "id": "wi.work-item-id",
      "title": "Work item title",
      "kind": "implementation|domain-pm|integration-evidence",
      "responsibilityUnitId": "ru.unit-id",
      "contractIds": ["contract.id"],
      "dependsOn": [],
      "allowedPaths": ["src/path/**", "test/path/**"],
      "estimatedComplexity": "trivial|small|medium|large",
      "decomposable": false,
      "verificationCommands": [
        {"command": "npm test -- --grep pattern", "purpose": "Run relevant tests"}
      ],
      "deliverables": ["src/path/file.mjs"],
      "acceptanceCriteriaIds": ["AC-001"]
    }
  ],
  "sequences": [
    {
      "title": "Sequence title",
      "participants": ["Component A", "Component B"],
      "steps": [
        {"from": "Component A", "to": "Component B", "action": "method call", "data": "payload description"}
      ]
    }
  ]
}
```

### Architecture Generation Rules

- Every work item must have explicit `allowedPaths` (glob patterns for files it may touch)
- Every cross-boundary dependency must be declared as a contract
- The work item DAG must be acyclic — `dependsOn` references must not form cycles
- Work items should be vertical slices when possible
- Verification must be concrete: actual test commands, not "write tests"
- If a work item is too large for one agent session, mark it `decomposable: true`
- Do NOT invent file paths that don't exist unless the work item creates them
- Do NOT assume frameworks/libraries not visible in project context
- When uncertain, mark assumptions explicitly in the `assumptions` array
- Maximum 12 work items
- Maximum dependency chain depth of 5
- Work item `allowedPaths` must be within their responsibility unit's `owns` paths
- Responsibility unit `owns` paths must not overlap across units
- All `contractId` references in edges, work items, and RUs must be declared in `contracts`
- All architecture edge `from`/`to` must reference declared node `id`s
- Acceptance criteria IDs must match pattern `AC-NNN`

### Validation Rules (engine enforces these)

The engine runs these checks on import. If any error-severity rule fails, the import is rejected:

| Rule | Severity | What it checks |
|------|----------|---------------|
| UNIQUE_NODE_IDS | error | No duplicate architecture node IDs |
| UNIQUE_WORK_ITEM_IDS | error | No duplicate work item IDs |
| EDGES_REFERENCE_DECLARED_NODES | error | Edge from/to reference existing nodes |
| DAG_IS_ACYCLIC | error | Work item dependency graph has no cycles |
| CONTRACTS_REFERENCED_EXIST | error | All referenced contractIds are declared |
| NO_OVERLAPPING_OWNERSHIP | error | RU owns paths don't overlap |
| WORK_ITEMS_WITHIN_RU_PATHS | error | WI allowedPaths within parent RU owns |
| ALLOWED_PATHS_ARE_VALID | error | Path patterns are valid globs |
| VERIFICATION_COMMANDS_PARSE | error | Verification commands are well-formed |
| WORK_ITEM_COUNT_WITHIN_LIMITS | error | At most 12 work items |
| EVERY_RU_HAS_WORK_ITEMS | warning | Every RU has at least one work item |
| EVERY_CONTRACT_HAS_PROVIDER_WORK_ITEM | warning | Every contract has an implementing WI |
| ACCEPTANCE_CRITERIA_COVERED | warning | All ACs are referenced by some WI |
| DEPENDENCY_DEPTH_WITHIN_LIMITS | warning | Dependency chain depth ≤ 5 |

## Fallback: Engine-Generated Plan (offline mode)

When the `blueprint import` path is unavailable or for scripted/offline use, the legacy engine path is still available:

```bash
makeitreal-engine plan "${CLAUDE_PROJECT_DIR:-$PWD}" --request "<canonical request>" --runner claude-code --verify '{"file":"npm","args":["test"]}'
```

Use `$ARGUMENTS` as the canonical request only when it is non-empty. If `$ARGUMENTS` is empty, collect the canonical request through `AskUserQuestion` first. Do not run the engine with an empty `--request`.

Derive the structured verification command from the project context. `--verify` must be JSON with `file` and `args`, not a shell string. Keep `--runner claude-code` for normal Claude Code plugin use so the generated trust policy can launch real Claude Code through `/makeitreal:launch`; use the scripted simulator only for fixture tests or explicit dry runs. If no honest command exists yet, report the blocked Ready gate instead of inventing a placeholder. Use `--run`, `--owner`, `--allowed-path`, or `--api` only when the request or project context makes those values explicit.

Never pass a generated placeholder such as `--allowed-path modules/<slug>/**` when the request already names concrete files or directories. Concrete requested paths are the responsibility boundary; guessed module workspaces create false path-boundary failures during launch.

## Post-Import Steps

After a successful `blueprint import` creates `preview/index.html`, run:

```bash
makeitreal-engine dashboard open "$RUN_DIR" --project-root "${CLAUDE_PROJECT_DIR:-$PWD}"
```

Report the returned `dashboardUrl` so the operator can reopen the Kanban/Blueprint dashboard manually if the OS browser launch is skipped or blocked.

## Required Artifacts

- PRD with goals, non-goals, acceptance criteria, and user-visible behavior.
- Design pack covering system architecture, state-transition flow, API or IO contracts, responsibility boundaries, call stack, and sequence diagrams.
- Responsibility map with exactly one owner per executable work item.
- Boundary contracts for cross-module communication.
- Kanban work items with dependencies, allowed paths, verification commands, and Done evidence.
- Launch board, trust policy, and runtime state seed so the approved plan can be launched from the current run without fixture-only state.

## Rules

- Do not implement during planning.
- Do not assume language-specific module boundaries unless the project requires them.
- Cross-domain teams must be able to work from contracts without reading each other's implementation.
- If the request spans multiple domains, either split it into vertical slice work items with one owner each or ask for explicit boundaries. Do not collapse frontend/backend/data ownership into one generic module.
- Generated OpenAPI, schemas, AST checks, or equivalent contract evidence must be planned before launch.
- Run the internal Ready gate when artifacts exist and report any blocking codes.
- A reviewable plan can be waiting for Blueprint approval without being an implementation failure. Treat pending approval as normal review state in user-facing reports; keep raw engine field names out of the primary summary.
- Do not launch or implement until the user has reviewed and approved the Blueprint. Approval may arrive through Native Claude Code conversational review or the explicit `/makeitreal:plan approve` control, but both must write `blueprint-review.json`.
- If the current Claude Code session classifies the user's reply as approval plus launch intent, first record the decision with `blueprint review --decision-json` using `launchRequested:true`, then execute the launch skill's native Task sequence in the same session. Do not ask the operator to type `/makeitreal:launch`.
- After approval, launch owns the `Contract Frozen -> Ready` promotion through the Ready gate; do not mutate board lanes manually.
- `/makeitreal:plan <request>` may be the first Make It Real command in a project. It creates `.makeitreal/runs/...`, records the current run, and writes the git ignore entry automatically.
