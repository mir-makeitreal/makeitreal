# Make It Real Claude Code E2E Evaluation - 2026-05-06

## Scope

This evaluation exercised Make It Real as a Claude Code development harness, not
as a prompt-only skill. The harness was responsible for Blueprint approval,
Kanban state, responsibility boundaries, Claude runner provenance, dependency
artifact staging, engine-owned verification, OpenAPI conformance evidence, live
wiki sync, and Done gates.

## Evidence Set

- Single-work real Claude E2E:
  `docs/e2e-evidence/offhours-real-claude-e2e-1778121086276.json`
- Multi-work API real Claude E2E:
  `docs/e2e-evidence/offhours-real-claude-multi-api-e2e-1778121132502.json`
- Recovery-path E2E:
  `docs/e2e-evidence/offhours-recovery-e2e-1778119008820.json`
- Fresh regression command: `npm run check`
- Result on the original 2026-05-06 pass: 108 tests passed, followed by canonical
  `design render -> gate Ready -> verify -> wiki sync -> gate Done`
- Product-readiness Ralph tranche on 2026-05-07 added launch-board
  materialization, operator status summaries, read-only preview projection, and
  supported recovery evidence. Fresh verification passed 114 tests plus the
  canonical gate chain.
- Stop-hook verification on 2026-05-07 re-ran `npm run check`: 114 tests passed,
  followed by canonical `design render -> gate Ready -> verify -> wiki sync ->
  gate Done`.
- R2 first-run golden path on 2026-05-07 added the productized
  `npm run e2e:real-claude` command. The current flow verifies
  `plan --runner claude-code -> dashboard dry-run -> Blueprint approval ->
  launch -> complete -> Done` against Claude Code. Evidence:
  `docs/e2e-evidence/real-claude-golden-path-1778137695717.json`.

## Marketplace Installability

The repository now includes a Claude Code marketplace manifest at
`.claude-plugin/marketplace.json`.

Verified install path:

```text
claude plugin marketplace add .
claude plugin install makeitreal@52g --scope local
# or short slash-command alias:
claude plugin install mir@52g --scope local
```

This is a repository-hosted marketplace install path, not an official Anthropic
marketplace listing. Official marketplace availability requires a separate
submission/listing process.

## Single-Work Run

The single-work run dispatched a real Claude Code attempt for
`work.slug-stats`. The staged prompt gave Claude only the work item source
artifacts, allowed paths, declared contracts, and boundary rules.

Observed proof:

- Claude binary resolved to `/Users/eugene/.local/bin/claude`.
- Real executable was `/Users/eugene/.local/share/claude/versions/2.1.129`.
- Executable hash was
  `sha256:fad2ac75c38ced2c57d046e64927c9ee4846f5ac75ea3bf8f0525ec66438c109`.
- The attempt recorded `session_started` and `turn_completed`.
- Claude attempted self-verification through Bash, but that tool was denied.
- Make It Real ran the declared verification command separately.
- Verification and wiki evidence were produced by the engine before Done.

The produced module stayed inside `apps/textstats/**`, exported only
`slugStats`, used no dependencies, and satisfied the declared module contract.

## Multi-Work API Run

The multi-work run used two responsibility units:

- `work.catalog-model` owned `apps/catalog/model.cjs` and
  `contract.catalog.model`.
- `work.catalog-api` owned `apps/catalog/api.cjs`, depended on
  `work.catalog-model`, and used both `contract.catalog.model` and
  `contract.catalog.create.openapi`.

Observed proof:

- `orchestrator tick` before Blueprint approval failed with
  `HARNESS_BLUEPRINT_APPROVAL_PENDING` and dispatched no work.
- `blueprint approve` wrote operator review evidence.
- The Ready gate passed only after render, contract, responsibility, and
  Blueprint approval evidence existed.
- The model work item completed first.
- The API work item became Ready only after the model work item reached Done.
- The completed model artifact was staged into the API workspace as a
  dependency artifact.
- Staged dependency artifacts were treated as read-only baseline; modifying
  them would fail the boundary check.
- Both Claude attempts recorded the same resolved executable identity and hash.
- Completion required real Claude attempt provenance, not caller assertion.
- The API Done evidence included verification, OpenAPI conformance, and wiki
  sync.
- Final `gate Done` passed.

The OpenAPI conformance evidence covered `POST /books`:

- `201` response with normalized `{ book: { title, author } }`.
- `400` response for invalid title input.

The conformance adapter validated the evidence against the declared OpenAPI
contract path, method, response status, and JSON schema shape.

## Recovery Run

The recovery run exercised the supported failure path with the scripted runner:

`Contract Frozen -> Ready -> Running -> Failed Fast -> Ready -> Running -> Verifying -> Done`

Observed proof:

- A freshly generated plan wrote `board.json`, `trust-policy.json`, and
  `runtime-state.json`.
- Blueprint approval was required before launch.
- The first runner attempt emitted `turn_failed`, moved the work item to
  `Failed Fast`, and status reported `phase: "failed-fast"` with the public next
  action `/makeitreal:status`.
- Reconcile moved retry-ready work back to `Ready`; status reported
  `phase: "launch-ready"` with `/makeitreal:launch`.
- The rerun reached `Verifying`.
- Engine-owned completion produced work-item scoped verification and wiki
  evidence.
- Final status reported `phase: "done"` and the Done gate passed.

This evidence intentionally does not claim automatic `Rework -> Ready`
recovery. Verification failure remains a rework/fix path until a separate
authority transition is designed.

## Gate Behavior

- PRD, design pack, responsibility map, board, and work-item artifacts are
  staged as machine-readable source inputs.
- Freshly planned runs now materialize launchable boards without requiring
  fixture-only state.
- `/makeitreal:status` projects setup, approval, launch-ready, running,
  failed-fast, rework, and done phases through a stable operator summary.
- The static preview remains read-only and projects `readRunStatus()` /
  `readBoardStatus()` instead of duplicating gate logic.
- `allowedPaths` are enforced for product writes.
- `.makeitreal/**` is immutable engine metadata.
- `.omc/sessions/**` is allowed as runner session metadata.
- Other `.omc/**` writes remain boundary checked.
- Blueprint review is an explicit human/operator approval gate.
- Completion rejects Claude Code work without latest successful attempt
  provenance.
- Completion rejects Claude Code work without executable `resolvedPath`,
  `realPath`, and `hash`.
- Verification evidence is command-hash checked and work-item scoped.
- Wiki sync evidence is work-item scoped.
- Planned `openapi-conformance` evidence is validated before Done.

## Competitive Evaluation

### Symphony

Sources:

- https://github.com/openai/symphony/blob/main/SPEC.md
- https://openai.com/index/open-source-codex-orchestration-symphony/

Make It Real adopts the useful Symphony-style kernel: work items, isolated
workspaces, a single orchestration authority, resumable state, retry/reconcile
behavior, and durable evidence. The main difference is scope. Symphony defines
an orchestration spec; Make It Real turns contract/spec/responsibility-boundary
engineering into executable gates for Claude Code.

### Superpowers

Sources:

- https://github.com/obra/superpowers
- https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md

Superpowers is strong methodology: design before code, TDD, systematic
debugging, subagent-driven work, and verification before completion. Make It
Real should keep borrowing that discipline, but it now provides harder runtime
authority: machine-readable board state, boundary checks, attempt provenance,
engine-owned verification, OpenAPI conformance, and Done evidence.

### Ruflo

Source:

- https://github.com/ruvnet/ruflo

Ruflo is broader as an orchestration platform. The useful ideas for Make It Real
are planner/executor separation, dependency graph visibility, adaptive
replanning, and progress observability. Make It Real intentionally stays
narrower: contract-first Claude Code development with fewer user-facing commands
and stronger work-item gates.

### Oh My OpenAgent

Sources:

- https://github.com/code-yeongyu/oh-my-openagent
- https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/guide/overview.md

Oh My OpenAgent is stronger as a broad agent platform surface. Make It Real is
stronger for this specific engineering philosophy: explicit Blueprint approval,
declared responsibility boundaries, contract-only cross-boundary use, no
undeclared fallback, fast-fail completion semantics, and evidence-backed Done.

## Verdict

For the scoped goal - a Claude Code harness that makes PRD, Blueprint, contracts,
responsibility boundaries, Kanban state, OpenAPI conformance, verification, and
wiki evidence executable - Make It Real is now the stronger fit.

This is not a claim that Make It Real is broader than Symphony, Ruflo,
Superpowers, or Oh My OpenAgent as ecosystems. It is a narrower claim: for
contract-first software development with Claude Code, Make It Real now provides
the most directly useful execution contract and audit trail among the compared
surfaces.

Remaining non-blocking work is scale evidence: larger fan-out boards, CI-hosted
provenance, and longer soak runs.
