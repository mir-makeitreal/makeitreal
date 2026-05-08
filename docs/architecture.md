# Make It Real Architecture

Make It Real is a Claude Code plugin plus a local deterministic engine. The
plugin is the user-facing surface. The engine owns state, gates, evidence, and
runner orchestration.

The core invariant is simple: implementation may not start until a reviewable
Blueprint exists and has explicit approval evidence. That Blueprint must define
responsibility boundaries, contracts, allowed paths, verification commands, and
Kanban work items.

## System Shape

```mermaid
flowchart LR
  User[Operator in Claude Code]
  Slash[Slash commands /makeitreal:* or /mir:*]
  Skills[Plugin skills and command guidance]
  Hooks[Claude Code hooks]
  Engine[makeitreal-engine]
  State[Project .makeitreal state]
  Dashboard[Read-only dashboard]
  Runner[Claude Code runner]
  Wiki[Live wiki evidence]

  User --> Slash
  Slash --> Skills
  Skills --> Engine
  Hooks --> Engine
  Engine --> State
  Engine --> Dashboard
  Engine --> Runner
  Runner --> State
  Engine --> Wiki
```

## Runtime Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Marketplace | `.claude-plugin/marketplace.json` | Publishes the `52g` marketplace with `makeitreal` and `mir` plugins. |
| Canonical plugin | `plugins/makeitreal/` | Owns slash commands, skills, hooks, and bundled engine files. |
| Alias plugin | `plugins/mir/` | Exposes `/mir:*` commands and depends on `makeitreal@52g`; it does not register duplicate hooks. |
| Engine CLI | `bin/harness.mjs` | Internal command router used by slash commands and tests. |
| Domain modules | `src/domain/`, `src/gates/`, `src/kanban/` | Validate PRDs, design packs, transitions, contracts, paths, and errors. |
| Board/orchestrator | `src/board/`, `src/orchestrator/` | Claims work, dispatches runner attempts, records runtime state, handles retry/reconcile, completes verified work. |
| Hooks | `hooks/claude/*.mjs` | Enforce boundaries during Claude Code sessions without becoming noisy when inactive. |
| Preview/dashboard | `src/preview/`, `src/dashboard/` | Render read-only Kanban, Blueprint, blocker, and evidence views. |
| Project state | `.makeitreal/` in each target project | Stores config, current run pointer, run packets, evidence, workspaces, and live wiki output. |

## Public Command Surface

Normal workflow:

- `/makeitreal:plan <request>`
- `/makeitreal:launch`
- `/makeitreal:status`

Ralph-like entrypoint:

- `/makeitreal:launch <request>`

When `launch` receives a request and no run is active, it must run the planning
flow first and stop at Blueprint review. It must not execute implementation
until approval is recorded.

Advanced workflow:

- `/makeitreal:setup`
- `/makeitreal:verify`
- `/makeitreal:config`
- `/makeitreal:doctor`

Internal engine commands such as `gate`, `board claim`, `orchestrator tick`,
`orchestrator complete`, `wiki sync`, and `hooks install` are not normal
user-facing commands. Slash commands may invoke them internally.

Public slash commands present semantic operator workflows. Internal engine
commands remain deterministic, scriptable, and JSON-oriented. The LLM may
classify natural-language operator intent, but writes must pass through typed
engine flags or named profiles; it must not edit `.makeitreal/config.json`
directly or expose raw `features.*` keys as the normal workflow.

## Project State Layout

Each target project gets local runtime state under `.makeitreal/`. This path is
automatically added to `.gitignore` by `plan` and `setup`.

```text
.makeitreal/
  config.json
  current-run.json
  runs/
    <run-id>/
      prd.json
      design-pack.json
      responsibility-units.json
      blueprint-review.json
      trust-policy.json
      board.json
      runtime-state.json
      contracts/
        *.openapi.json
      work-items/
        work.<id>.json
      preview/
        index.html
        preview-model.json
        operator-status.json
      evidence/
        *.verification.json
        *.wiki-sync.json
      attempts/
        *.json
      workspaces/
        work.<id>/
          .makeitreal/
            handoff.json
            prompt.md
            source/
```

`current-run.json` is only a pointer. The run packet under `runs/<run-id>/` is
the source of truth for gates and execution.

## Planning Pipeline

```mermaid
sequenceDiagram
  participant U as Operator
  participant P as Plan command
  participant E as Engine
  participant D as Dashboard
  participant H as UserPromptSubmit hook

  U->>P: /makeitreal:plan <request>
  P->>E: generate PRD, Blueprint, contracts, board
  E->>E: seed pending blueprint-review.json
  E->>D: render read-only dashboard
  P-->>U: show run path, blockers, dashboard URL
  U->>H: approves or requests revision in chat
  H->>E: LLM-classified review decision
  E->>E: write approved or rejected blueprint-review.json
```

Planning creates:

- PRD with goals, non-goals, acceptance criteria, and verification intent.
- Design pack with architecture, state flow, API/IO specs, boundaries, call
  stack, and sequence diagrams.
- Responsibility units with exactly one owner per executable work item.
- Boundary contracts and contract IDs used by work items.
- Kanban work items with dependencies, allowed paths, and verification commands.
- Trust policy for the selected runner mode.
- Pending Blueprint review evidence.
- Read-only dashboard preview.

If the incoming request spans multiple detected responsibility domains, planning
does not collapse the work into one broad owner. It returns
`HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS`, a public `nextAction`, and
machine-readable `suggestedBoundaries` with proposed owner, allowed paths,
contract ID, responsibility, and verification command. The operator or LLM
planner must review that proposal and rerun planning with explicit boundaries.
If the caller already supplies an explicit owner, allowed paths, and verification
command for a vertical slice, planning may proceed as one responsibility unit.

The prompt layer follows a small set of workflow rules inspired by production
engineering skill packs without expanding the slash-command surface: conditional
clarification, shared project language, vertical slices, contract-first slicing,
selective context for scoped workers, stop-the-line debugging, and zoom-out
status reports.

## Blueprint Approval Model

Blueprint approval is evidence, not a conversational assumption.

Approval can be recorded in three ways:

- The plan command's Claude Code question UI can send the operator's answer to
  the internal `blueprint review` command, where the same LLM judge classifies
  it as approval, rejection, revision request, or no decision.
- Conversational review through `UserPromptSubmit`, where the same LLM judge
  classifies the latest user reply with the previous assistant Blueprint report
  as context.
- Explicit/scriptable fallback via `/makeitreal:plan approve` or
  `/makeitreal:plan reject`.

The LLM judge is only invoked while `blueprint-review.json` is pending. Once the
Blueprint is approved or rejected, ordinary chat is ignored by the hook.

## Kanban State Model

Work moves through a constrained state machine:

```text
Intake
  -> Discovery
  -> Scoped
  -> Blueprint Bound
  -> Contract Frozen
  -> Ready
  -> Claimed
  -> Running
  -> Verifying
  -> Human Review
  -> Done
```

Failure/recovery lanes:

```text
Running -> Failed Fast -> Ready
Verifying -> Rework -> Verifying
Claimed -> Ready when lease expires
```

Key gate rules:

- `Contract Frozen -> Ready` requires design, contract, responsibility, and
  Blueprint approval gates.
- `Human Review -> Done` requires verification evidence and wiki evidence, or
  explicit wiki-skip evidence when live wiki is disabled.
- `Rework -> Verifying` requires explicit recovery evidence from the completion
  gate. This lets a fixed environment or resolved review issue retry
  work-item verification without relaunching the implementation worker.
- `Running` cannot jump directly to `Done`.

## Responsibility And Contract Boundaries

Every executable work item has one responsibility owner. That owner is the only
authority for the declared allowed paths and declared contract IDs.

Boundary checks happen in multiple places:

- Plan generation rejects unsafe allowed path patterns.
- Ready gate validates design, contracts, responsibility ownership, and Blueprint
  approval.
- `PreToolUse` blocks edits outside allowed paths for an active run.
- Runner workspace staging gives the agent only the relevant handoff packet,
  source artifacts, and work item contract.

This intentionally rejects undeclared fallback behavior. If a dependency, SDK,
API, or module violates its contract, the harness should fail fast and record
evidence rather than hide the mismatch with local fallback logic.

## Hook Lifecycle

Make It Real registers three Claude Code hooks:

| Hook | Active responsibility | Inactive behavior |
| --- | --- | --- |
| `UserPromptSubmit` | Classify pending Blueprint review decisions with the LLM judge. | Return `continue: true` and `suppressOutput: true`. |
| `PreToolUse` | Block mutating tools outside active run boundaries; allow bootstrap commands like plan/setup/doctor. | Allow read-only tools and non-mutating bootstrap commands. |
| `Stop` | During active execution, require Done-gate evidence before the session can stop. | Return `continue: true` and `suppressOutput: true`. |

The hooks should not make ordinary Claude Code chat feel hijacked. A
`current-run.json` pointer by itself is not an edit lock. `PreToolUse` enforces
edit boundaries only when one of these is true:

- the tool input explicitly carries a Make It Real `runDir`
- the process environment contains the scoped runner context
  `MAKEITREAL_BOARD_DIR` and `MAKEITREAL_WORK_ITEM_ID`
- the current run has active execution state and exactly one active work item can
  be inferred

This preserves the intended fan-out model: Make It Real launch-created
subagents receive scoped work item context and are constrained to their declared
allowed paths, while unrelated Claude Code subagents can still perform ordinary
work outside Make It Real launch mode.

## Launch And Runner Execution

Launch resolves the current run, verifies Ready-gate prerequisites, promotes
eligible work, then dispatches attempts through the selected runner.

For real Claude Code execution, the trust policy uses `runnerMode:
"claude-code"` and a structured runner command. The engine creates an isolated
workspace per work item and stages:

- `handoff.json`
- `prompt.md`
- source-of-truth PRD/design/board/contract artifacts
- the current work item
- Blueprint review evidence
- trust policy
- existing project files that match the work item's allowed paths

Runner output is structured evidence. Success requires a successful attempt and
engine-owned verification. After a successful runner turn, Make It Real applies
only changed allowed-path files from the isolated workspace back to the real
project root, records the applied paths in attempt provenance, and then runs
completion verification from the real project root. Unsupported tool calls,
missing input, malformed events, failed commands, boundary violations, or failed
workspace apply keep the item out of Done.

## Verification And Done Evidence

Verification commands are declared during planning. They are structured
commands, not shell strings. The engine writes verification evidence under
`evidence/`.

Done requires:

- successful implementation attempt provenance
- passing verification evidence
- board completion evidence
- live wiki sync evidence, or explicit wiki-skip evidence when the feature flag
  disables live wiki

The Stop hook and Done gate both treat missing evidence as a blocker.

## Dashboard

The dashboard is read-only observability. It may show:

- current phase
- Blueprint approval status
- Kanban lanes
- responsibility owners
- contracts and allowed paths
- blockers
- next recommended Claude Code command
- evidence links

The dashboard must not include mutating controls for approval, launch, retry,
reconcile, wiki sync, or Done transitions. Claude Code conversation, hooks, and
engine commands remain the control plane.

## Configuration

Project config is read from `.makeitreal/config.json` when present and falls
back to defaults otherwise.

Important feature flags:

- live wiki enabled/disabled
- dashboard auto-open
- dashboard refresh on launch/verify

Disabling a feature must not weaken gates. For example, disabling live wiki
requires explicit skip evidence before Done.

## Diagnostics

`/makeitreal:doctor` is read-only. It checks:

- plugin files
- hook assets
- config
- current run pointer
- dashboard preview
- Claude Code CLI availability

If no current run exists, doctor points to `/makeitreal:plan <request>`, not
`setup`, because setup is optional.

## Testing And Release Gates

Deterministic local verification:

```bash
npm run check
npm run plugin:validate
```

Real Claude Code E2E is opt-in:

```bash
npm run e2e:real-claude
```

`npm run check` covers engine tests plus the canonical Ready/Done gate chain.
`npm run plugin:validate` validates the canonical plugin, alias plugin, and
marketplace manifest with Claude Code.

## Extension Points

The intended extension surfaces are:

- new adapters under `src/adapters/`
- new evidence kinds under `src/domain/evidence.mjs`
- additional contract validators
- richer plan generation inputs
- additional read-only dashboard projections
- new config flags that preserve gate semantics

Avoid adding new public slash commands for internal state transitions unless the
operation is a genuine operator workflow. The product should stay small at the
surface and strict underneath.
