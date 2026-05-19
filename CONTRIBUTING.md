# Contributing to Make It Real

Thank you for considering contributing to Make It Real. This document explains how to set up the development environment, run tests, and submit changes.

## Development Setup

```bash
git clone https://github.com/52g-tools/dev-harness.git
cd dev-harness
node --version  # Must be >= 20
```

No `npm install` needed — the engine has zero runtime dependencies. Tests use Node.js built-in test runner.

## Running Tests

```bash
# Unit tests
npm test

# Full check (tests + design render + contract validation + gates + verification + wiki sync)
npm run check

# Plugin validation
npm run plugin:validate
```

The `check` script runs the full pipeline against the canonical example in `examples/canonical/`.

## Project Structure

```
dev-harness/
├── src/                          # Engine source (pure ESM, .mjs)
│   ├── domain/                   # Core domain: PRD, design pack, DAG, evidence, errors
│   ├── blueprint/                # Blueprint review, approval, fingerprinting
│   ├── board/                    # Board store, claims, dependency graph, boundaries
│   ├── kanban/                   # State machine (lanes + transitions)
│   ├── gates/                    # Ready gate, Done gate
│   ├── orchestrator/             # Dispatch, retry, runtime state, native tasks
│   ├── adapters/                 # OpenAPI contracts/conformance, module surfaces
│   ├── preview/                  # Dashboard model + HTML renderer
│   ├── wiki/                     # Live documentation sync
│   ├── config/                   # Project configuration
│   ├── project/                  # Bootstrap and run state
│   ├── status/                   # Board status reporting
│   ├── dashboard/                # Dashboard open command
│   ├── diagnostics/              # Doctor command
│   ├── hooks/                    # Claude Code settings management
│   └── io/                       # JSON file persistence
├── test/                         # Tests (.test.mjs, Node.js test runner)
├── bin/                          # CLI entry point (harness.mjs)
├── hooks/claude/                 # Claude Code hooks (user-prompt-submit, stop)
├── plugins/makeitreal/           # Claude Code plugin surface
│   ├── commands/                 # Slash command definitions
│   ├── skills/                   # Workflow guidance for commands
│   └── dev-harness/              # Synced engine copy for plugin distribution
├── plugins/mir/                  # Short alias plugin
├── examples/canonical/           # Reference example for integration tests
├── scripts/                      # Build and validation scripts
└── docs/                         # Documentation
```

## Engine Architecture

The engine is pure validation logic — no network calls, no AI API keys, no external services. It runs entirely inside Node.js.

Key principles:
- **Zero dependencies** — only Node.js built-in modules
- **Pure ESM** — all files use `.mjs` extension and ES module syntax
- **Structured errors** — every error has a `code`, `reason`, `evidence` array, and `recoverable` flag
- **Evidence-based** — every state transition produces machine-readable evidence
- **Gate enforcement** — no state transition without passing required gates

## Making Changes

### Adding a Gate Check

Gate checks live in `src/gates/index.mjs`. The `runGates()` function validates all artifacts for either the `Ready` or `Done` target. To add a check:

1. Add the validation logic
2. Push errors with a specific `HARNESS_*` code
3. Add a test in `test/`
4. Ensure `npm run check` passes (it runs gates against the canonical example)

### Adding a Kanban Lane or Transition

Lanes and transitions are defined in `src/kanban/lanes.mjs`. The state engine in `src/kanban/state-engine.mjs` enforces them. To add a transition:

1. Add the entry to `TRANSITIONS` in `lanes.mjs`
2. Add required gates if applicable
3. Update tests in `test/kanban-state.test.mjs`

### Adding a Contract Validation Rule

Contract validation lives in:
- `src/adapters/openapi-contract.mjs` — OpenAPI spec validation
- `src/adapters/openapi-conformance.mjs` — implementation conformance checking
- `src/adapters/module-surface-conformance.mjs` — module interface conformance
- `src/domain/design-pack.mjs` — design pack cross-reference validation

### Syncing Plugin Engine

After engine changes, sync the plugin's engine copy:

```bash
npm run plugin:sync
```

This copies the engine source into `plugins/makeitreal/dev-harness/` for plugin distribution.

## Error Codes

All errors use the `HARNESS_*` prefix. When adding new errors, use `createHarnessError()` from `src/domain/errors.mjs`:

```javascript
import { createHarnessError } from "./errors.mjs";

createHarnessError({
  code: "HARNESS_MY_NEW_CHECK",
  reason: "Human-readable explanation",
  evidence: ["relevant-file.json"],
  recoverable: true,
  nextAction: "Suggested fix"
});
```

## Testing

Tests use Node.js built-in test runner (`node --test`). Helpers in `test/helpers/fixture.mjs` provide test fixtures.

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("my feature", () => {
  it("validates correctly", () => {
    const result = myFunction(input);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.errors, []);
  });
});
```

## Commit Guidelines

- Keep commits focused on a single change
- All 272+ tests must pass at every commit
- `npm run check` must succeed
- Plugin validation must pass (`npm run plugin:validate`)

## Release Process

Versions are tracked in:
- `plugins/makeitreal/dev-harness/package.json` (engine version)
- `.claude-plugin/marketplace.json` (marketplace version)

Both must stay in sync. The `release:check` script validates this:

```bash
npm run release:check
```
