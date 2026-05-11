# Make It Real Example Gallery

## Canonical API Fixture

Path:

```text
dev-harness/examples/canonical/.makeitreal/runs/feature-auth
```

Purpose:

- exercises PRD/design-pack loading
- renders the architecture preview
- checks API contract evidence
- gates `Ready` and `Done`
- verifies wiki evidence

Deterministic check:

```bash
npm run check
```

## Real Claude Code Golden Path

Command:

```bash
/mir:launch
```

Purpose:

- creates a fresh project and run directory
- plans with `--runner claude-code`
- blocks launch before Blueprint approval
- records approval evidence
- launches a real Claude Code runner in a bounded work-item workspace
- verifies output through the engine
- checks read-only dashboard behavior
- reaches Done through gate evidence

Latest recorded evidence:

```text
dev-harness/docs/e2e-evidence/real-claude-golden-path-1778137695717.json
```

Observed artifact:

```text
modules/slug-stats/index.cjs
```

The module is intentionally small: it proves that Make It Real can constrain a
real agent to declared allowed paths, verify a deterministic result, and move the
Kanban board to Done only after evidence exists.
