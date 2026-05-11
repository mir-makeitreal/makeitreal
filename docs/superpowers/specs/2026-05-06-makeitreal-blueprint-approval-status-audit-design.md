# Make It Real Blueprint Approval and Status Audit Design

Date: 2026-05-06
Scope: Make It Real engine and Claude Code plugin
Status: Autoresearch review candidate

## Goal

Make It Real must require explicit human approval of the generated Blueprint before any implementation-capable state is reachable, and it must expose a compact operator status view that explains Blueprint and gate blockers with stable evidence.

This phase closes the current MVP gap where PRD/design-pack artifacts exist, but preview generation can be confused with approval. A rendered Blueprint proves that the engine can show the plan. It does not prove that the user accepted the responsibility boundaries, contracts, verification plan, or implementation scope.

## Product Positioning

Make It Real is not a prompt-only skill, a generic swarm, or a clone of Symphony, Ruflo, OMC, or Superpowers.

Make It Real is a contract-first engineering harness for Claude Code:

- PRD and Blueprint artifacts are machine-readable source of truth.
- Work is split into language-neutral responsibility units, not framework-specific modules.
- Cross-boundary communication is allowed only through declared contracts.
- Subagents should receive small atomic work packets instead of broad repository context.
- The orchestrator owns state transitions; agents own only their assigned work.
- Missing evidence, stale approval, invalid contracts, and unsupported runtime paths fail fast.
- Completion requires verification evidence and live wiki sync.

## Current Baseline

The MVP already has:

- PRD and design-pack generation in `src/plan/plan-generator.mjs`.
- Architecture preview rendering in `src/preview/render-preview.mjs`.
- Ready and Done gate validation in `src/gates/index.mjs`.
- Kanban state transitions in `src/kanban/lanes.mjs` and `src/kanban/state-engine.mjs`.
- Board claim and dependency checks in `src/board/claim-store.mjs` and `src/board/dependency-graph.mjs`.
- Claude mutating-tool boundary hooks in `hooks/claude/pre-tool-use.mjs`.
- Stop hook Done gate enforcement in `hooks/claude/stop.mjs`.
- Real Claude Code E2E evidence in `docs/e2e-claude-code-evaluation-2026-05-06.md`.

The verified E2E proves a local pure-module vertical slice. It does not yet prove multi-module chains, API drift, or explicit Blueprint approval before implementation.

## Design Decisions

### 1. Ready Means Implementation-Safe

`Ready` must mean the work item can be claimed and executed. Therefore a work item without approved Blueprint evidence must not pass the Ready gate.

The Kanban transition `Contract Frozen -> Ready` must require these evidence gates:

- `design`
- `contract`
- `responsibility`
- `blueprintApproval`

This is separate from any existing `blueprint` artifact/preview check. A Blueprint can exist and render successfully while `blueprintApproval` is still pending.

Rejected alternative: allow `Ready` and block only at `claim`.
Reason: that makes Ready semantically ambiguous and weakens operator status.

### 2. Plan Can Succeed While Ready Gate Fails

`/makeitreal:plan` should generate artifacts, render the Blueprint, seed review evidence, and record the current run even when the Ready gate fails because approval is pending.

This is a deliberate distinction:

- Planning success: the run packet exists and can be reviewed.
- Ready success: the run packet is approved and executable.

The public command result must expose the distinction explicitly:

```json
{
  "ok": true,
  "planOk": true,
  "implementationReady": false,
  "readyGate": {
    "ok": false,
    "target": "Ready",
    "errors": [
      { "code": "HARNESS_BLUEPRINT_APPROVAL_PENDING" }
    ]
  },
  "currentRunUpdated": true
}
```

Exit semantics:

- `plan` exits `0` when `planOk === true`, even if `implementationReady === false` only because Blueprint approval is pending.
- `plan` exits `1` when planning itself fails, including missing verification plan, invalid allowed paths, ambiguous boundaries, malformed contracts, or non-approval Ready blockers.
- `status` exits `0` when the current run can be resolved and read, even if `gateAudit.ok === false`.
- `status` exits `1` only when the current run cannot be resolved/read or the status command itself fails.

Deterministic `plan` matrix:

| Case | Packet generated | `planOk` | `implementationReady` | `currentRunUpdated` | Previous current-run pointer | Exit |
| --- | --- | --- | --- | --- | --- | --- |
| Generator fails before a usable `runDir` exists, for example empty request, ambiguous responsibility domains, invalid allowed path, malformed verification command | false | false | false | false | preserved | 1 |
| Packet and preview are valid, and the only Ready blocker is `HARNESS_BLUEPRINT_APPROVAL_PENDING` | true | true | false | true | replaced with the new run | 0 |
| Packet was written, but Ready has any non-approval blocker, for example missing verification plan, invalid contract binding, unsafe work-item shape, or missing preview | true | false | false | false | preserved | 1 |
| Packet is valid and Blueprint is already approved, for example after `blueprint approve` reruns the Ready audit | true | true | true | true | replaced with the approved run | 0 |

`planOk` means the run packet is reviewable and all non-approval planning invariants passed. `implementationReady` means the Ready gate passed. `currentRunUpdated` must be true only when `planOk === true`; a failed plan must not displace a previously active run.

Rejected alternative: fail the plan command when approval is pending.
Reason: users need a recorded current run and status surface to review and approve the Blueprint.

### 3. Approval Is Evidence, Not Preview

Approval must be stored as a first-class artifact, not inferred from `preview/index.html`.

File: `<runDir>/blueprint-review.json`

```json
{
  "schemaVersion": "1.0",
  "runId": "feature-auth",
  "workItemId": "work.feature-auth",
  "prdId": "prd.auth",
  "blueprintFingerprint": "sha256:...",
  "status": "pending",
  "reviewSource": "makeitreal:plan",
  "reviewedBy": null,
  "reviewedAt": null,
  "decisionNote": null
}
```

Allowed statuses:

- `pending`
- `approved`
- `rejected`

Derived status:

- `stale` when the stored fingerprint does not match the current Blueprint fingerprint.

`stale` is not stored as a status value because it is a derived integrity result.

### 3.1. Approval Provenance Is Operator-Controlled

Only the internal `blueprint approve` and `blueprint reject` commands may write `blueprint-review.json` after the initial pending evidence is seeded. Direct edits to the review file are treated as control-plane mutation and must be blocked by Claude hooks when they occur inside an agent runner context.

Approval commands must reject execution when runner environment variables are present:

- `MAKEITREAL_WORK_ITEM_ID`
- `MAKEITREAL_BOARD_DIR`
- `MAKEITREAL_WORKSPACE`

This prevents a claimed worker from approving its own implementation authority.

Approval commands require `--by <reviewer>`. The plugin passes a deterministic operator identity such as `operator:${USER}` or `operator:local`.

Review decisions must store:

- `reviewSource: "makeitreal:plan approve"` or `reviewSource: "makeitreal:plan reject"`
- `reviewedBy`
- `reviewedAt`
- `decisionNote`

An approval can move from `pending`, `rejected`, or derived `stale` to `approved`, but only through the operator command and only against the current Blueprint fingerprint.

Approval command output must use the canonical JSON envelope:

```json
{
  "ok": true,
  "command": "blueprint approve",
  "runDir": "/repo/.makeitreal/runs/feature-auth",
  "reviewPath": "/repo/.makeitreal/runs/feature-auth/blueprint-review.json",
  "status": "approved",
  "blueprintFingerprint": "sha256:...",
  "reviewedBy": "operator:eugene",
  "errors": []
}
```

`blueprint approve` and `blueprint reject` exit `0` only when the review artifact is written successfully. They exit `1` for missing `--by`, runner environment presence, malformed existing review JSON, stale mismatch during validation, unreadable run packet, or invalid status transition.

All failed approval/rejection attempts must be no-write:

- `blueprint-review.json` remains byte-identical when it existed before the command.
- no `.makeitreal/current-run.json` update occurs
- no `board.json`, `events.jsonl`, `claims/**`, runtime state, evidence, or `.makeitreal/**` file is written

### 4. Fingerprint Binds Approval to the Actual Blueprint

The approval fingerprint must cover every artifact that defines the approved implementation contract:

- `prd.json`
- `design-pack.json`
- `responsibility-units.json`
- `board.json` when board-driven execution uses the run packet as its scheduling authority
- all `work-items/*.json`
- all `contracts/*.json`

The fingerprint must be deterministic:

- Sort file paths.
- Parse JSON and write stable JSON before hashing.
- Include file path plus normalized content in the digest.
- Use `sha256:<hex>`.

If any covered artifact changes after approval, Ready and claim gates fail with stale approval.

Board-driven execution must use the same approval authority chain.

This phase supports single-run boards only: one `board.json` maps to exactly one Blueprint run packet. Mixed boards that route different work items to different run packets must be rejected in this phase with `HARNESS_BLUEPRINT_AUDIT_UNLINKED`.

Run resolution precedence:

1. Co-located packet wins when `boardDir` contains `prd.json`, `design-pack.json`, `responsibility-units.json`, `work-items/`, and `blueprint-review.json`. In this case `runDir === boardDir`.
2. If no co-located packet exists, `board.json.blueprintRunDir` may point to the run packet. The path must be project-relative or absolute, must stay inside the allowed project/root policy, and the linked packet must validate.
3. If both a co-located packet and `board.json.blueprintRunDir` exist, the link must resolve to `boardDir`; otherwise claim/tick/status report `HARNESS_BLUEPRINT_APPROVAL_DRIFT`.
4. If the link is present but missing, unreadable, outside policy, or does not contain a valid run packet, claim/tick/status report `HARNESS_BLUEPRINT_AUDIT_UNLINKED`.
5. If no co-located packet and no link exists, `board status` preserves lane counts and returns `audit.skipped: true` with `HARNESS_BLUEPRINT_AUDIT_UNLINKED`; `board claim` and `orchestrator tick` reject with the same code.

`board.json` is included in the approval fingerprint whenever `runDir === boardDir` or when the resolved run packet contains the authoritative `board.json` used for scheduling. If a linked external board points at a run packet that does not own the board file, the board is not included in that run packet fingerprint; in that layout, stale/drift authority comes from validating the linked packet plus the board-to-run binding. Adding/removing work items or contracts inside the resolved packet is always stale after approval.

### 5. Status Is a Read-Only Projection

Status must not mutate orchestration state.

It should read current-run state, Blueprint review evidence, gate results, board state where available, attempts, events, verification evidence, and wiki evidence. It should return a compact snapshot that answers:

- Is this run approved to implement?
- If not, why?
- Which gate blocks launch?
- What exact command or workflow step comes next?

Status must call the canonical validators and state loaders directly:

- Blueprint review validation comes from `validateBlueprintApproval()`.
- Ready gate audit comes from `runGates({ target: "Ready" })`.
- Board eligibility comes from the board state and dependency graph loaders.

Status must not infer eligibility from attempts, events, claims, or runtime bookkeeping. Those streams are useful evidence, but they are not gate authority.

## New Domain Modules

### `src/blueprint/fingerprint.mjs`

Responsibility:

- Compute the deterministic Blueprint fingerprint for a run directory.

Public API:

```js
export async function computeBlueprintFingerprint({ runDir })
```

Returns:

```js
{
  ok: true,
  fingerprint: "sha256:...",
  files: ["prd.json", "design-pack.json", "..."],
  errors: []
}
```

Failure returns harness error envelopes.

### `src/blueprint/review.mjs`

Responsibility:

- Create pending review evidence.
- Approve or reject review evidence.
- Validate review evidence against current run artifacts.

Public API:

```js
export async function seedBlueprintReview({ runDir, now })
export async function decideBlueprintReview({ runDir, status, reviewedBy, decisionNote, reviewSource, env, now })
export async function readBlueprintReview({ runDir })
export async function validateBlueprintApproval({ runDir })
export async function resolveBlueprintRunDir({ boardDir, workItem })
```

`validateBlueprintApproval()` returns:

```js
{
  ok: false,
  status: "pending",
  stale: false,
  reviewPath: ".../blueprint-review.json",
  errors: [
    {
      code: "HARNESS_BLUEPRINT_APPROVAL_PENDING",
      reason: "Blueprint review is pending user approval.",
      evidence: ["blueprint-review.json"],
      recoverable: true
    }
  ]
}
```

### `src/status/run-status.mjs`

Responsibility:

- Build a read-only operator status projection for the current run.
- Compose Blueprint review state and gate audit state without becoming a new orchestrator.

Public API:

```js
export async function readRunStatus({ projectRoot, runDir, now })
```

Returns:

```json
{
  "ok": true,
  "command": "status",
  "projectRoot": "/repo",
  "runDir": "/repo/.makeitreal/runs/feature-auth",
  "blueprint": {
    "status": "pending",
    "stale": false,
    "reviewedBy": null,
    "reviewedAt": null,
    "fingerprint": "sha256:..."
  },
  "gateAudit": {
    "ok": false,
    "target": "Ready",
    "checks": [
      {
        "gate": "blueprint",
        "ok": false,
        "errors": [
          { "code": "HARNESS_BLUEPRINT_APPROVAL_PENDING" }
        ]
      }
    ]
  },
  "nextCommand": "/makeitreal:plan approve"
}
```

### `src/status/board-status.mjs`

Responsibility:

- Extend board status with audit data when the board has enough run artifacts to evaluate Blueprint approval.
- Keep lane counts stable for existing consumers.

Public API:

```js
export async function readBoardStatus({ boardDir, now })
```

Returns the current lane count payload plus:

```json
{
  "audit": {
    "ok": false,
    "blueprintBlockedWorkItemIds": ["work.login-ui"],
    "staleBlueprintWorkItemIds": [],
    "gateFailures": [
      {
        "workItemId": "work.login-ui",
        "code": "HARNESS_BLUEPRINT_APPROVAL_PENDING",
        "evidence": ["blueprint-review.json"]
      }
    ]
  }
}
```

When no Blueprint authority can be resolved, the function preserves the current lane count payload and returns a skipped audit instead of guessing:

```json
{
  "audit": {
    "ok": false,
    "skipped": true,
    "code": "HARNESS_BLUEPRINT_AUDIT_UNLINKED",
    "reason": "Board is not linked to a Blueprint run packet."
  }
}
```

## CLI and Plugin Surface

### User-Facing Skills

Keep the public surface compact:

- `/makeitreal:setup`
- `/makeitreal:plan`
- `/makeitreal:launch`
- `/makeitreal:status`
- `/makeitreal:verify`

No new normal user-facing top-level command is required.

### Plan Approval UX

Use `/makeitreal:plan approve` and `/makeitreal:plan reject` as user-facing skill arguments, backed by internal engine commands.

Internal engine commands:

```text
blueprint approve <runDir> --by <reviewer> [--note <text>]
blueprint reject <runDir> --by <reviewer> [--note <text>]
```

Rationale:

- Approval belongs to the planning phase.
- It avoids exposing low-level gate commands to normal users.
- It gives hooks and launch a concrete artifact to enforce.

### Status UX

`makeitreal-engine status <projectRoot>` should return the current run state plus Blueprint and gate audit.

The plugin skill should summarize:

- Current run.
- Blueprint status.
- Stale or rejected reason when present.
- Ready gate blockers.
- Next workflow command.

## Launch Packet and Handoff Contract

Approval must shape the execution packet, not only the gate result.

Before any real or simulated implementation runner receives work, the engine must validate Blueprint approval for the resolved run packet. If approval is missing, pending, rejected, stale, drifted, invalid, or unlinked, launch/tick fails before runner-input staging.

The worker packet must be self-sufficient and approval-bearing. For Claude Code runner workspaces, `.makeitreal/source/` must include:

- `prd.json`
- `design-pack.json`
- `responsibility-units.json`
- `work-item.json`
- `board.json`
- `blueprint-review.json`
- every resolved `contracts/*.json` artifact
- `trust-policy.json` when present

`handoff.json` must include:

- `blueprintReview.status`
- `blueprintReview.blueprintFingerprint`
- `blueprintReview.reviewedBy`
- `blueprintReview.reviewedAt`
- `blueprintReview.reviewSource`
- `contractArtifacts`
- `sourceArtifacts`

The staged packet is the low-context subagent contract. A worker must be able to understand its PRD slice, responsibility owner, allowed paths, contract IDs, verification commands, and approval authority without reading unrelated repository history or parent chat context.

Pre-approval no-write rule:

- no `.makeitreal/handoff.json`
- no `.makeitreal/prompt.md`
- no `.makeitreal/source/**`
- no attempt directory or attempt event
- no runner process spawn
- no claim, lane, event, runtime, verification, or wiki mutation

This applies to native `orchestrator native start/finish`, scripted fixture paths, and any future launch surface.

## Gate Enforcement

### Ready Gate

`runGates({ target: "Ready" })` must validate Blueprint approval.

Failure codes:

- `HARNESS_BLUEPRINT_APPROVAL_MISSING`
- `HARNESS_BLUEPRINT_APPROVAL_PENDING`
- `HARNESS_BLUEPRINT_APPROVAL_REJECTED`
- `HARNESS_BLUEPRINT_APPROVAL_STALE`
- `HARNESS_BLUEPRINT_APPROVAL_DRIFT`
- `HARNESS_BLUEPRINT_REVIEW_INVALID`
- `HARNESS_BLUEPRINT_AUDIT_UNLINKED`

### Board Claim

`claimWorkItem()` must reject claim attempts when the work item is not Blueprint-approved.

This protects board-driven execution paths even if a caller bypasses run-level Ready gate output.

Blocked claims must be no-write:

- no claim file is created
- no lane transition occurs
- no event is appended
- no runtime state is updated

### Orchestrator Tick

`orchestratorTick()` already claims through `claimWorkItem()`. Once claim enforces approval, tick inherits the block.

Blocked ticks must be no-write:

- no dispatch is attempted
- no claim is created
- no running state is created
- no `work_started` event is appended

### Claude Pre-Tool Hook

`pre-tool-use.mjs` must deny mutating tools when the active run is not Blueprint-approved.

Non-mutating reads can remain allowed if they do not write files, because users and agents need to inspect artifacts before approval.

Hook ordering:

1. Resolve the active run.
2. Determine whether the tool request is mutating.
3. Allow non-mutating reads.
4. For mutating requests, validate Blueprint approval first.
5. If approval is valid, run path-boundary checks for `Bash`, `Edit`, `Write`, and related mutating tools.

Blueprint approval failures take precedence over path-boundary failures for mutating pre-approval requests. This keeps the operator-facing blocker stable: a worker cannot mutate anything before the Blueprint is approved, regardless of the path.

### Stop Hook

`stop.mjs` continues to enforce Done gate. It should include Blueprint approval errors in the gate output when a run never became approval-ready.

## Error Handling

No silent fallback is allowed.

Missing review evidence is not treated as approved.
Malformed review evidence is not ignored.
Missing fingerprint inputs fail the Blueprint gate.
Stale approval is recoverable but blocks Ready.
Rejected approval blocks Ready until the user reruns plan or explicitly approves a later Blueprint.
Unknown board-to-run linkage blocks claim/tick and is reported as an audit failure.

All failures must use the canonical harness error envelope.

Error taxonomy:

| Condition | Code |
| --- | --- |
| Review file missing | `HARNESS_BLUEPRINT_APPROVAL_MISSING` |
| Review status is `pending` | `HARNESS_BLUEPRINT_APPROVAL_PENDING` |
| Review status is `rejected` | `HARNESS_BLUEPRINT_APPROVAL_REJECTED` |
| Review JSON is malformed or status is unknown | `HARNESS_BLUEPRINT_REVIEW_INVALID` |
| Required fingerprint input is missing | `HARNESS_BLUEPRINT_REVIEW_INVALID` |
| `runId`, `workItemId`, or `prdId` differs from current packet | `HARNESS_BLUEPRINT_APPROVAL_DRIFT` |
| Fingerprint differs because a covered artifact changed | `HARNESS_BLUEPRINT_APPROVAL_STALE` |
| Contracts or work items were added or removed after approval | `HARNESS_BLUEPRINT_APPROVAL_STALE` |
| JSON key order or file enumeration order differs only syntactically | no error |
| Board has no co-located packet and no valid `blueprintRunDir` link | `HARNESS_BLUEPRINT_AUDIT_UNLINKED` |
| `board.json.blueprintRunDir` points outside allowed policy, cannot be read, or lacks a valid packet | `HARNESS_BLUEPRINT_AUDIT_UNLINKED` |
| Co-located packet and `board.json.blueprintRunDir` disagree | `HARNESS_BLUEPRINT_APPROVAL_DRIFT` |

## Tests

### Blueprint Gate Tests

Create `test/blueprint-gates.test.mjs`:

- Ready gate rejects missing `blueprint-review.json`.
- Ready gate rejects `pending`.
- Ready gate rejects `rejected`.
- Ready gate rejects malformed review JSON and unknown review status.
- Ready gate rejects wrong `runId`, `workItemId`, or `prdId`.
- Ready gate rejects stale fingerprint after `design-pack.json` changes.
- Ready gate rejects added/removed `contracts/*.json`.
- Ready gate rejects added/removed `work-items/*.json`.
- Ready gate does not stale approval for JSON key-order-only changes.
- Ready gate passes when approval is `approved` and fingerprint matches.

Create `test/blueprint-review-cli.test.mjs`:

- `blueprint approve` writes approved evidence with current fingerprint, reviewer, timestamp, and `reviewSource`.
- `blueprint reject` writes rejected evidence with current fingerprint, reviewer, timestamp, and `reviewSource`.
- Approval/rejection fails without `--by`.
- Approval/rejection fails when runner environment variables are present.
- Approval after a stale review rewrites evidence against the current fingerprint.
- Failed approval/rejection attempts leave `blueprint-review.json` byte-identical and do not mutate current-run, board events, claims, runtime state, evidence, or `.makeitreal/**`.

### Hook Tests

Create `test/blueprint-hooks.test.mjs` or extend `test/claude-hooks.test.mjs`:

- Mutating `Edit` is denied before approval.
- Mutating `Bash` is denied before approval.
- Mutating tools are allowed after approval and path boundary checks pass.
- Read-only tool input with no changed path remains allowed.

### Status Tests

Create `test/run-status-audit.test.mjs`:

- Status reports current run Blueprint status.
- Status reports Ready gate audit with stable codes.
- Status reports stale approval separately from missing approval.
- Status exits `0` and returns `ok: true` when the run is readable but `gateAudit.ok === false`.
- Status preserves `HARNESS_CURRENT_RUN_MISSING` when no run exists.
- Status is no-write in readable blocked, stale, rejected, and missing-current-run cases.

Create `test/board-status-audit.test.mjs`:

- Board status returns lane counts as before.
- Board status includes `audit.ok: false` for Blueprint-blocked work.
- Board status includes stale Blueprint work item IDs.
- Board status returns `audit.skipped: true` and `HARNESS_BLUEPRINT_AUDIT_UNLINKED` when no run packet is co-located or linked.
- Board status is no-write for readable blocked, stale, rejected, and unlinked cases.
- Co-located packet wins; disagreeing `blueprintRunDir` reports `HARNESS_BLUEPRINT_APPROVAL_DRIFT`.
- Broken, unreadable, or out-of-policy `blueprintRunDir` reports `HARNESS_BLUEPRINT_AUDIT_UNLINKED`.

### Plan Generator Tests

Extend `test/plan-generator.test.mjs`:

- Plan generator seeds `blueprint-review.json` as pending.
- Plan generator records current run even when Ready is blocked only by pending Blueprint approval.
- Plan output reports `planOk: true`, `implementationReady: false`, preview success, and Ready gate pending approval.
- Plan CLI exits `0` when approval pending is the only implementation blocker.
- Plan CLI exits `1` when non-approval planning/gate blockers remain.
- Plan CLI preserves the previous current-run pointer for generator failures and non-approval Ready blockers.
- Plan CLI replaces the current-run pointer only when `planOk === true`.

### Claim and Orchestrator Tests

Extend `test/kanban-cli.test.mjs` and `test/orchestrator.test.mjs`:

- `board claim` rejects unapproved Ready work.
- `orchestrator tick` dispatches no work for Blueprint-blocked items.
- Rejected claim attempts do not write claims, events, lane changes, or runtime state.
- Rejected tick attempts do not write claims, running state, or `work_started` events.
- Unlinked boards reject claim/tick with `HARNESS_BLUEPRINT_AUDIT_UNLINKED`.
- Approval allows claim and tick to proceed.

### Native Launch Packet Tests

Extend `test/orchestrator.test.mjs` and `test/board-completion.test.mjs`:

- Approved native launch returns a compact implementation prompt and reviewer
  prompts for the current work item.
- Attempt provenance records `runner.mode: "claude-code"` and
  `runner.channel: "parent-native-task"`.
- Pre-approval launch fails before writing attempt artifacts, claims, lanes,
  events, runtime state, verification, or wiki evidence.
- Stale/rejected/missing/unlinked Blueprint approval produces the canonical
  approval error before any native Task handoff.
- Completion rejects any claude-code attempt whose latest successful provenance
  is not from the parent-session native Task path.

### Deterministic Check Contract Tests

Create `test/check-contract.test.mjs`:

- `npm test` does not invoke a real `claude` binary.
- `npm run check` does not invoke a real `claude` binary.
- Real Claude Code E2E remains opt-in/off-hours and is not part of deterministic CI.

Concrete guard:

- The test creates a temporary directory containing an executable sentinel named `claude` that exits non-zero and writes a marker file if invoked.
- The test prepends that directory to `PATH` while running `npm test` and `npm run check`.
- The marker file must not exist after either command.
- Tests that intentionally simulate Claude must install an explicit test-local stub and must not rely on the real user/system `claude` binary.

## Verification Commands

Required before completion:

```bash
node --test test/blueprint-gates.test.mjs test/run-status-audit.test.mjs test/board-status-audit.test.mjs
node --test test/blueprint-review-cli.test.mjs test/claude-hooks.test.mjs test/kanban-cli.test.mjs test/orchestrator.test.mjs test/plan-generator.test.mjs test/board-completion.test.mjs test/check-contract.test.mjs
npm test
npm run check
```

Real Claude Code E2E is intentionally not part of this phase's deterministic release gate. It should run as a separate off-hours evidence suite:

```text
plan -> pending approval block -> approve -> launch real Claude Code -> verify -> wiki sync -> Done
```

## Acceptance Criteria

- `/makeitreal:plan` creates reviewable artifacts, renders Blueprint preview, seeds pending approval, and records current run.
- `/makeitreal:plan` returns `planOk: true`, `implementationReady: false`, and exits `0` when pending approval is the only blocker.
- `Ready` gate fails before explicit approval with a stable Blueprint approval code.
- `/makeitreal:status` explains approval status, stale state, Ready blockers, and next command.
- `/makeitreal:status` exits `0` for readable runs even when Ready is blocked.
- `board status` preserves lane counts and adds audit output.
- `board claim`, `orchestrator tick`, and mutating Claude hooks all reject unapproved work.
- Rejected `board claim` and `orchestrator tick` attempts are no-write.
- Pre-approval launch rejects before attempt, native Task handoff, claim, lane, event, runtime, verification, or wiki writes.
- Board-driven execution is bound to an approved co-located or linked run packet.
- Approval is operator-controlled, rejects runner environments, and stores deterministic provenance.
- Approval is bound to current PRD, design pack, contracts, responsibility units, work items, and board scheduling authority when applicable.
- Changing any Blueprint-defining artifact after approval makes the approval stale.
- JSON key-order-only changes do not make approval stale.
- Native Task handoff packets contain Blueprint approval evidence and contract artifacts.
- `npm test` and `npm run check` pass with a poisoned `PATH` sentinel that proves the real `claude` binary is not invoked.
- Existing tests and `npm run check` pass.

## Non-Goals

- Do not add a daemon.
- Do not add MCP as a required runtime.
- Do not add broad swarm/federation/memory features.
- Do not expose low-level engine commands as normal user workflows.
- Do not run real Claude Code E2E as a blocking deterministic test.

## External Design Notes

Symphony's strongest concept to absorb is authoritative orchestration state with isolated work scopes and in-repo workflow policy. Ruflo's useful concept is health/progress visibility, but its broad swarm/memory/federation surface is intentionally excluded from this phase. OMC's useful concept is hook-based workflow persistence and simple user-facing commands. Superpowers' useful concept is hard-gated design approval and zero-context plans.

Make It Real should beat these systems on this axis:

> A small agent with a small packet can do correct work because the packet contains the PRD slice, contract IDs, responsibility boundary, allowed paths, verification plan, and approval evidence.
