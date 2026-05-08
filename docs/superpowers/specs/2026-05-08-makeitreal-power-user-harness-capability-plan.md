# Make It Real Power-User Harness Capability Plan

Date: 2026-05-08  
Status: Draft for implementation planning  
Scope: Claude Code power-user development harness

## 1. Current State

Make It Real is already more than a prompt pack. It has a Claude Code plugin,
slash commands, a local engine, a file-backed control plane, Blueprint approval,
responsibility-owned work items, declared contracts, Kanban state, claim/lease,
retry/reconcile, real Claude Code runner provenance, verification evidence,
OpenAPI conformance, live wiki evidence, and a Done gate.

The current command surface is intentionally small:

- `/makeitreal:setup`
- `/makeitreal:plan`
- `/makeitreal:launch`
- `/makeitreal:status`
- `/makeitreal:verify`
- `/makeitreal:config`

The current dashboard is a read-only operator cockpit. It may show state,
blockers, evidence paths, next commands, and work-item progress. It must not
become a browser mutation surface.

## 2. Target User

The target user is an experienced developer or agent operator who already uses
Claude Code or adjacent harnesses such as OMX, Superpowers, Ruflo, Cline,
OpenHands, aider, Continue, Goose, or similar tools.

This user does not need a consumer-style demo run. They need a harness that lets
them hand work to agents with lower context, stronger contracts, clearer state,
and better evidence than ordinary prompt-driven development.

The product promise is:

> Make software-agent work real by forcing every implementation through a
> reviewable Blueprint, a single responsibility boundary, declared contracts,
> constrained workspace access, and engine-owned verification evidence.

## 3. Non-Goals

- Do not build a hosted product.
- Do not optimize for non-developer onboarding.
- Do not add demo flows purely for marketing.
- Do not turn the dashboard into an action console.
- Do not chase broad agent-platform breadth before the contract-first harness is
  complete.
- Do not expose low-level engine commands as normal slash commands.
- Do not add fallback behavior for undeclared contract violations.

## 4. Reference Lessons

Make It Real should borrow selectively from mature adjacent harnesses without
copying their product shape.

| Reference | Useful Lesson | What Make It Real Should Not Copy |
| --- | --- | --- |
| Superpowers | Strong workflow packaging, hard gates before implementation, verification before completion. | Do not remain a prompt/methodology pack; Make It Real must keep executable gates. |
| Symphony | Spec-first orchestration, work items, workspace safety, state machine discipline. | Do not stop at a spec; Make It Real must keep Claude Code execution and evidence authority. |
| Ruflo | Runtime visibility, memory/progress surfaces, orchestration awareness. | Do not chase broad swarm/plugin breadth before contract-first development is complete. |
| Continue | Repo-native policy/check surfaces and CI projection. | Do not replace the local engine with external PR checks as source of truth. |
| OpenHands | Layered core reused by CLI/GUI/cloud and strong execution substrate. | Do not broaden into hosted IDE/platform scope now. |
| Cline | Transparent autonomy, approval posture, checkpoints, recoverability. | Do not move Make It Real's state authority into an editor-only UI. |
| aider | Low-friction git-native developer loop. | Do not remove Blueprint/contract ceremony when the work requires boundaries. |

The resulting strategy is narrow: strengthen Make It Real as a contract-first
Claude Code harness for power users, not as a general agent platform.

## 5. Required Invariants

These are not preferences. They are the harness contract.

1. PRD is the source of truth.
2. Every executable work item has exactly one responsibility owner.
3. Responsibility units are language-neutral software ownership boundaries.
4. Cross-boundary communication happens only through declared contracts.
5. A worker must be able to execute from its handoff packet without reading
   unrelated module internals or parent chat history.
6. Undeclared fallback behavior is rejected.
7. Real bugs fail fast and produce evidence.
8. Common error handling owns error presentation; domain modules do not hide
   root causes with local defensive branches.
9. Naming is a contract and must follow project conventions.
10. New code must prove why existing modules were not reused.
11. Verification is engine-owned before Done.
12. Live wiki updates happen only after verified completion, and can be disabled
    only with explicit skip evidence.

## 6. Capability Status Matrix

| Capability Area | Current State | Needed Next | Priority |
| --- | --- | --- | --- |
| Core gates | Blueprint, Ready, verification, wiki, Done gates exist. | Keep gates stable while adding schema/policy validation. | P0 |
| Command surface | Six slash commands exist. | Add `doctor`, then consider `export` and `history`. | P0/P1 |
| Config | live wiki and dashboard settings exist. | Add policy files, runner defaults, verification defaults, retention, strictness. | P0 |
| Schemas | Artifacts exist and are validated mostly by code/tests. | Publish schema docs and migration rules for public artifacts. | P0 |
| Runner reliability | Claude runner provenance, hooks, failed-fast, retry exist. | Add diagnostics, timeout/quota classification, support matrix. | P0 |
| Verification | command evidence, OpenAPI, conformance, forgery checks exist. | Add export, CI projection, static/reuse/naming adapters. | P0/P1 |
| Observability | status and read-only cockpit exist. | Improve blocked reasons, evidence drill-down, history, copyable next commands. | P0 |
| Collaboration | claim/lease/mailbox/dependency staging exist. | Formalize handoff packet and reviewer/verifier contracts. | P1 |
| External adapters | wiki exists; GitHub/CI not implemented. | Start with export/CI, then GitHub PR/check projection. | P1 |
| OSS harness DX | install README and release packaging notes exist. | Add command/schema/policy refs, license, changelog, CI, troubleshooting. | P0/P1 |

Priority definitions:

- P0: required for confident power-user use.
- P1: required for open-source harness maturity.
- P2: useful after the core harness is stable.

## 7. Capability Map

### 7.1 Core Harness

Required capabilities:

- PRD creation and update.
- Blueprint/design-pack generation.
- Blueprint review, approval, rejection, and drift detection.
- Responsibility-unit modeling.
- Work-item decomposition.
- Kanban state machine.
- Dependency DAG.
- Claim/lease ownership.
- Mailbox-style worker communication.
- Retry and reconcile.
- Done gate.
- Evidence bundle.

Acceptance bar:

- A freshly planned run starts blocked until Blueprint approval exists.
- Ready requires design, contract, responsibility, and Blueprint approval.
- Done requires verification, runner provenance when applicable, and wiki or
  explicit skip evidence.
- State transitions are performed only by the engine.

### 7.2 Developer Command Surface

Keep the default surface small. Add commands only when they improve operator
control without exposing internal machinery.

Current core:

- `/makeitreal:setup`
- `/makeitreal:plan`
- `/makeitreal:launch`
- `/makeitreal:status`
- `/makeitreal:verify`
- `/makeitreal:config`

High-value additions:

- `/makeitreal:doctor`
  - Diagnose plugin cache, slash command discovery, hook installation,
    current-run state, config schema, Claude binary availability, and dashboard
    file paths.
- `/makeitreal:export`
  - Export a portable evidence bundle for CI, PR review, or human audit.
- `/makeitreal:history`
  - List recent runs, phases, outcomes, and evidence roots.

Non-goal commands:

- No public `board claim`.
- No public `orchestrator tick`.
- No public `gate`.
- No public browser action endpoint.

### 7.3 Config And Policy System

Current config covers live wiki and dashboard behavior. Power-user harness use
needs a richer but still explicit model.

Config should eventually cover:

- live wiki enabled/disabled.
- dashboard auto-open.
- dashboard refresh triggers.
- runner mode and runner trust policy defaults.
- verification defaults.
- retry policy.
- evidence retention.
- contract strictness.
- fallback policy.
- allowed path policy defaults.
- naming convention adapters.
- reuse-check policy.
- external adapter enablement.

Recommended structure:

- `.makeitreal/config.json`
- `.makeitreal/policies/contracts.json`
- `.makeitreal/policies/responsibility.json`
- `.makeitreal/policies/verification.json`
- `.makeitreal/policies/reuse.json`
- `.makeitreal/templates/*.json`

Acceptance bar:

- Unknown config keys fail fast.
- Config schema has explicit versioning and migration.
- Disabling optional features produces explicit skip evidence.
- Policy cannot silently weaken core gates.

### 7.4 Schema Stability

The harness artifacts are the real inter-team communication layer. They must be
stable enough for humans, agents, tests, and external adapters.

Canonical artifacts:

- `prd.json`
- `design-pack.json`
- `responsibility-units.json`
- `work-items/*.json`
- `contracts/*.openapi.json`
- `board.json`
- `trust-policy.json`
- `runtime-state.json`
- `blueprint-review.json`
- `evidence/*.json`

Required schema work:

- JSON schema documents for public artifacts.
- Version field for every public artifact.
- Migration path for schema changes.
- Validation CLI path.
- Clear distinction between source artifacts, runtime artifacts, and evidence.

Acceptance bar:

- A worker can understand its slice from `work-item + responsibility unit +
  contract IDs + allowed paths + verification commands`.
- Cross-domain teams can collaborate from boundary contracts without reading
  each other's internals.

### 7.5 Runner And Hook Reliability

Make It Real is only credible if Claude Code execution is constrained and
recoverable.

Required capabilities:

- Claude Code structured command validation.
- Runner executable provenance: resolved path, real path, and hash.
- PreToolUse boundary enforcement.
- Stop-hook Done gate enforcement.
- UserPromptSubmit Blueprint approval judge.
- Workspace isolation.
- Dependency artifact staging.
- Failed-fast capture.
- Retry/reconcile.
- Timeout and quota failure handling.
- Hook status diagnostics.

Acceptance bar:

- No mutating work runs before Blueprint approval.
- Claude Code completion cannot move work to Done without latest successful
  attempt provenance.
- Runner metadata paths are distinguished from product writes.
- Failed attempts produce evidence and a supported next action.

### 7.6 Verification And Evidence

Verification must be a contract, not a vague instruction.

Required capabilities:

- Declared command evidence.
- Command hash validation.
- Work-item scoped evidence.
- OpenAPI contract validation.
- OpenAPI conformance evidence.
- Allowed-path diff validation.
- Forged evidence rejection.
- Missing verification fail-fast behavior.
- Verification summary for `/status` and dashboard.

High-value future adapters:

- AST/static analysis adapter.
- naming convention adapter.
- reuse report adapter.
- contract drift adapter.
- CI adapter.

Acceptance bar:

- Done cannot be reached by assertion.
- Verification failure routes to Rework or Failed Fast with explicit evidence.
- Evidence can be exported and reviewed without the chat transcript.

### 7.7 Reuse And Anti-Rewrite Guard

This is a core Make It Real differentiator.

Required capabilities:

- Before creating new modules, search for reusable existing modules.
- Record reuse decision evidence.
- Flag new code that duplicates known module responsibilities.
- Detect cross-boundary imports that bypass contracts.
- Flag fallback branches not declared by contract.
- Flag unreachable or speculative defensive branches.
- Check naming conventions at the responsibility boundary.

Acceptance bar:

- A worker that creates a new module must produce evidence explaining why reuse
  was not sufficient.
- Contract owners, not consumers, own behavior changes and bug reports.

### 7.8 Operator Observability

Power users need state clarity more than UI novelty.

`/makeitreal:status` should always answer:

- What phase is the run in?
- Is Blueprint approved, rejected, pending, stale, or drifted?
- What blocks the next transition?
- What evidence is missing?
- Which work item is claimed and by whom?
- Which retry or reconcile action is available?
- What command should the operator run next?
- Where is the dashboard and evidence root?

The dashboard should show:

- run headline and phase.
- Blueprint review state.
- lane counts.
- work item states.
- blockers.
- evidence links.
- next slash command.
- read-only marker.
- auto-refresh from local files.

Acceptance bar:

- No mutating browser controls.
- Dashboard state is derived from engine readers, not duplicated logic.
- Copyable commands are allowed; executing mutations in the browser is not.

### 7.9 Collaboration And Subagent Model

Make It Real should not optimize for many generic agents. It should optimize
for small-context, contract-bound agents.

Required capabilities:

- Atomic work-item handoff packet.
- Responsibility owner.
- Allowed paths.
- Contract IDs.
- Dependency artifacts.
- Verification commands.
- Claim/lease.
- Mailbox.
- Reviewer handoff.
- Verifier handoff.
- Rework loop.

Acceptance bar:

- An agent can complete its work without reading unrelated source.
- Downstream agents receive dependency artifacts as read-only baseline.
- Claim conflicts are visible and recoverable.

### 7.10 External Adapter Boundaries

External adapters should not redefine the engine. They should project engine
truth outward.

Candidate adapters:

- GitHub issue/PR/check adapter.
- CI evidence adapter.
- MCP read-only status adapter.
- OpenAPI/schema registry adapter.
- Wiki adapter.
- Linear/Notion adapter later.

Initial adapter priority:

1. CI evidence export.
2. GitHub PR check/comment adapter.
3. MCP read-only status adapter.

Acceptance bar:

- External systems never become the source of truth for core state transitions.
- External adapter failures do not bypass local gates.
- Adapter output references evidence paths and engine status.

### 7.11 OSS Harness DX

This is not consumer-product polish. It is the credibility surface expected by
developers who install harness tooling.

Required:

- License decision.
- command reference.
- install/update/troubleshooting.
- plugin cache troubleshooting.
- support matrix: macOS/Linux, shell, Node, Claude Code version assumptions.
- architecture overview.
- schema reference.
- policy reference.
- release checklist.
- changelog.
- CI workflow.
- security notes.
- known limitations.

Acceptance bar:

- A power user can install, inspect commands, run checks, diagnose common plugin
  failures, and understand artifact schemas without chat context.

## 8. Command Exposure Policy

Commands should be evaluated with this rule:

> Expose a command only when it gives the operator a stable decision point or
> diagnostic surface that cannot be expressed clearly through `status` or
> `config`.

Recommended exposure levels:

| Level | Examples | Rule |
| --- | --- | --- |
| Core workflow | `setup`, `plan`, `launch` | Always visible; these define the normal loop. |
| Operator read-only | `status`, `doctor`, `history` | Safe to expose because they do not mutate engine state. |
| Operator controlled mutation | `verify`, `config`, future `export` | Expose when the command writes explicit evidence or config. |
| Internal engine | `gate`, `board claim`, `orchestrator tick`, `wiki sync`, hook install internals | Keep hidden from normal slash command surface. |

`verify` is acceptable as a user-facing advanced command because it writes
engine evidence and is useful during manual recovery. Low-level state
transitions are not acceptable as normal commands because they bypass the
higher-level workflow contract.

## 9. Release Sequencing

This roadmap separates the long-horizon capability inventory from the executable
near-term tranche order. The next tranche should stay on local harness
completeness and power-user DX. Documentation and OSS packaging are necessary,
but they should not displace runner reliability, status accuracy, or handoff
contracts.

### R4: Runner And Operator Reliability

Goal: make the existing Claude Code runner and operator loop easier to trust
when real work fails, retries, or blocks.

Scope:

- `/makeitreal:doctor`.
- hook status diagnostics.
- plugin cache and slash command discovery diagnostics.
- current-run and dashboard path diagnostics.
- Claude binary availability and version diagnostics.
- timeout/quota/failure classification for runner attempts.
- support matrix emitted by doctor/status rather than only prose docs.
- richer `/makeitreal:status` blockers where the current summary is ambiguous.

Verification:

- deterministic checks.
- plugin validation.
- doctor failure-path tests.
- status no-write tests.
- runner timeout/quota/failure fixture tests.
- hook diagnostic fixture tests.

Definition of done:

- `/makeitreal:doctor` exists and can report plugin, hook, config, current-run,
  dashboard, and Claude binary status.
- runner failures classify timeout, quota, command rejection, hook failure, and
  workspace-boundary failure separately.
- `/makeitreal:status` reports the next safe operator action for each supported
  failed-fast or blocked state.
- no dashboard mutation controls are introduced.
- deterministic checks and plugin validation pass.

### R5: Handoff And Collaboration Contract Hardening

Goal: make low-context subagent execution a formal contract rather than an
implicit property of current work-item files.

Scope:

- formal handoff packet schema.
- reviewer handoff contract.
- verifier handoff contract.
- rework packet contract.
- dependency artifact contract.
- mailbox message schema.
- claim/lease operator summary improvements if needed.

Verification:

- handoff packet validation tests.
- reviewer/verifier fixture tests.
- dependency artifact read-only tests retained.
- rework-loop fixture tests.
- claim conflict and mailbox tests retained.

Definition of done:

- an agent can execute from a handoff packet without parent chat context.
- reviewer and verifier roles receive stable, minimal packets.
- rework packets identify failed evidence, owning responsibility unit, allowed
  paths, and required contract changes.
- downstream dependency artifacts stay read-only baseline.

### R6: Policy And Schema Hardening

Goal: make harness artifacts stable public contracts.

Scope:

- JSON schema docs.
- config/policy directories.
- migration rules.
- validation command path.
- reuse/fallback/naming policy design.

Verification:

- schema validation tests.
- unknown-key rejection tests.
- migration tests.
- policy cannot weaken gates tests.

Definition of done:

- public artifact schemas are documented.
- policy files have explicit schemas and unknown-key rejection.
- migration behavior is tested.
- policy cannot silently disable Blueprint, boundary, or Done gates.

### R7: Evidence Export And CI Projection

Goal: make engine truth portable outside Claude Code.

Scope:

- evidence bundle export.
- CI-friendly verification mode.
- GitHub PR check/comment adapter boundary.
- history listing.

Verification:

- export reproducibility tests.
- forged evidence rejection retained.
- CI mode works without real Claude quota.

Definition of done:

- evidence bundle export is reproducible.
- CI can verify existing evidence without real Claude quota.
- GitHub/PR projection is read-only and references engine evidence.
- engine state remains local source of truth.

### R8: Reuse And Static Analysis Guards

Goal: enforce the anti-rewrite and no-undeclared-fallback philosophy.

Scope:

- reuse report adapter.
- duplicate responsibility detection.
- fallback branch detection.
- cross-boundary import analysis.
- naming convention adapter.

Verification:

- fixture repos with intentional reuse/fallback/naming violations.
- false-positive thresholds documented.
- opt-outs require explicit policy evidence.

Definition of done:

- reuse decisions are captured as evidence.
- fallback and cross-boundary violations are detected in fixtures.
- naming violations can be reported without blocking unrelated domains.
- documented opt-outs require explicit owner/policy evidence.

### R9: OSS Harness Maturity

Goal: provide the credibility surface expected by power-user open-source
harness users without turning the work into marketing polish.

Scope:

- command reference.
- install/update/troubleshooting.
- plugin cache troubleshooting.
- config reference.
- schema reference.
- architecture overview.
- release checklist.
- changelog.
- license decision.
- security notes.
- known limitations.

Verification:

- docs link check or local reference check where practical.
- release checklist references deterministic checks and plugin validation.
- troubleshooting commands are backed by doctor/status behavior from R4.

Definition of done:

- a power user can install, inspect commands, diagnose common failures, and
  understand artifact schemas without chat context.
- docs describe real harness capabilities and limitations without implying a
  hosted product or consumer demo flow.

## 10. Implementation Principles For Future Tranches

- Add one public command only when status/config cannot cover the need.
- Prefer schema and policy before behavior.
- Preserve read-only cockpit.
- Keep adapters thin and engine-owned.
- Write tests before implementing gate changes.
- Treat every new feature as a contract: command, artifact, evidence, failure
  code, and recovery path.

## 11. Risks And Controls

| Risk | Control |
| --- | --- |
| Turning into a broad agent platform | Keep runner/adapters thin and engine-owned. |
| Too many slash commands | Apply command exposure policy before adding commands. |
| Policy system weakens gates | Unknown keys fail fast; core gates cannot be disabled by policy. |
| Dashboard becomes a shadow control plane | Keep browser read-only and derive state from engine readers. |
| Static/reuse checks create noise | Start as evidence/warning, then graduate to gates only with fixture proof. |
| External adapters create split truth | External systems project local engine evidence; they never own transitions. |

## 12. Acceptance Checklist

This plan is ready for implementation planning when:

- It names all major harness capability areas.
- It keeps Make It Real scoped to power users.
- It preserves the user's development philosophy as explicit invariants.
- It avoids consumer-app demo requirements.
- It defines near-term release sequencing.
- It gives future agents enough context to implement without reading this chat.
