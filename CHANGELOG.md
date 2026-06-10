# Changelog

All notable changes to Make It Real are documented here.

## [0.1.49] - 2026-06-10

### Fixed
- New `run cancel <projectRoot>` command releases the active run's current-run pointers (project-level and matching session-scoped) so hook enforcement unblocks; the run directory itself is preserved
- PRD trace gate now enforces run-level coverage (every acceptance criterion delivered by at least one work item) instead of the per-item "trace all criteria" rule the normalizer satisfied trivially; blueprints may declare `acceptanceCriteriaIds` per work item
- Blueprint import rejects work items that omit `requiredReviewRoles` (`REQUIRED_REVIEW_ROLES_REQUIRED`); `[]` remains a valid explicit "no reviewers" choice
- Completion policy and review-role resolution deduplicated into `review-evidence.mjs`, removing drift between the orchestrator and board-completion copies
- `plugin:sync --check` now flags unexpected entries at the embedded engine root, so stray artifacts cannot ride along unnoticed

### Removed
- Stray `_adv_check`, `_adv_check2`, `_adv_mkdir_test` test artifact directories accidentally committed under the embedded plugin engine (~15k lines)

## [0.1.48] - 2026-06-10

### Fixed
- Doctor now validates plugin-native hooks via `CLAUDE_PLUGIN_ROOT` instead of failing on absent Claude settings hooks
- `gate` rejects targets other than `Ready`/`Done` with an explicit `HARNESS_GATE_TARGET_INVALID` error instead of silently passing
- Status no longer reports "blocked with no blockers" when all pending work sits in Contract Frozen; it now answers `launch-ready`
- Stop hook's runner-in-progress block now includes a recovery path (`orchestrator reconcile`) for crashed runners
- Decompose child work item ids are validated against the slug pattern, rejecting path separators and `..` traversal
- Blueprint import verifies all required artifacts exist on disk before writing `board.json`, so a partial import can no longer look complete

## [0.1.47] - 2026-06-10

### Fixed
- Installation instructions in documentation
- Review status vocabulary in the launch skill, synced to the `mir` alias plugin
- Wiki output consolidated to a single canonical path
- Blueprint reject now works on runs whose Blueprint cannot be fingerprinted, so a broken run no longer deadlocks the review loop

### Added
- Version sync guard: `release:check` now verifies that package.json, both plugin manifests, marketplace.json, and CHANGELOG.md agree on the current version

## [0.1.46] - 2026-05-19

### Added
- Complete documentation suite: README, getting started, how it works, concept docs (blueprints, contracts, responsibility units, orchestration)
- CONTRIBUTING.md with development setup and architecture guide

### Engine
- PRD-first planning with structured acceptance criteria and PRD traceability
- Design pack with 7 validated sections: architecture, state flow, API specs, responsibility boundaries, module interfaces, call stacks, sequences
- OpenAPI 3.x contract validation with schema example checking, operation completeness, and baseline backward compatibility
- Module surface contract validation with typed signatures (inputs, outputs, errors)
- Work item DAG with topological sort, cycle detection, and contract edge validation
- Responsibility unit enforcement with path boundary checking and overlap detection
- 15-lane Kanban state machine with gate-enforced transitions
- Ready gate: PRD, design pack, DAG, contracts, PRD trace, ownership, verification plans, path boundaries, module interfaces, Blueprint approval, preview
- Done gate: verification evidence, wiki sync evidence, OpenAPI conformance, module surface conformance
- Blueprint approval with cryptographic fingerprinting and drift detection
- Orchestrator tick loop with claim/lease system and exponential backoff retry
- Native Claude Code Task dispatch with scoped prompts and three-reviewer completion policy
- Runtime state tracking (claimed, running, retry)
- Board event log with full provenance
- Dashboard preview model and HTML renderer
- Live wiki sync with explicit skip evidence support
- Doctor diagnostics command
- Project configuration management
- Interactive Blueprint review with native Claude Code judgment protocol

### Plugin
- `/makeitreal:plan` — interactive intake, Blueprint generation, dashboard, inline review
- `/makeitreal:launch` — gated execution through native Claude Code Tasks
- `/makeitreal:status` — read-only run status with dashboard
- `/makeitreal:setup` — project bootstrap and run selection
- `/makeitreal:verify` — verification evidence generation
- `/makeitreal:config` — configuration management
- `/makeitreal:doctor` — plugin health diagnostics
- `/mir:*` — short alias plugin for all commands
- `UserPromptSubmit` hook for conversational Blueprint review
- `Stop` hook for session lifecycle

### Infrastructure
- Zero runtime dependencies (Node.js built-in modules only)
- Pure ESM (.mjs) codebase
- Node.js built-in test runner with 272+ tests
- Canonical example in `examples/canonical/` for integration testing
- Plugin sync and validation scripts
- Claude Code marketplace packaging (`makeitreal@52g`, `mir@52g`)
