---
name: verify
description: Use when a Make It Real run needs manual verification, blocked-gate diagnosis, contract checks, evidence review, or Done-readiness inspection.
---

# Make It Real Verify

Run verification as an explicit diagnostic action. This is an advanced/manual command, not the normal happy-path entrypoint.


## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Procedure

1. Inspect current run status and board state.
2. Run the relevant gates, contract checks, path-boundary checks, evidence checks, and Done-readiness checks.
3. When verification changes evidence-facing state, expect the engine to refresh the generated dashboard when `features.dashboard.refreshOnVerify` is enabled, or to return an explicit `dashboardRefresh.skipped` result when disabled.
4. If `dashboardRefresh.dashboardUrl` is present, run `makeitreal-engine dashboard open "$RUN_DIR" --project-root "$CLAUDE_PROJECT_DIR"` unless dashboard auto-open is disabled.
5. Report blocker codes with the artifact or work item that caused them, plus the `dashboardUrl` when available.
6. Do not mask failures by adding fallback behavior. Fix the plan, contract, ownership, or implementation cause.

## Stop-the-Line Recovery

When any gate, test, contract check, or runner attempt fails, stop adding features and diagnose the failure before continuing.

Use this order:

1. Reproduce the failure with the smallest exact command or artifact read.
2. Localize whether the failure is in the plan, contract, allowed path boundary, runner, implementation, test, or external dependency.
3. Reduce to a minimal failing case or a single missing evidence artifact.
4. Fix the root cause. Do not add fallback branches for states the contract does not allow.
5. Add or preserve regression evidence, then rerun the declared verification command and affected gates.

Do not delete tests, weaken assertions, remove contract checks, or broaden allowed paths just to reach Done. If the Blueprint is wrong, revise the Blueprint and re-approve it instead of patching around the mismatch.

## Output

Return a concise verdict: pass, blocked, or inconsistent state. Include exact commands run and the highest-priority next repair.
