# Changelog

All notable changes to Make It Real are documented here.

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
