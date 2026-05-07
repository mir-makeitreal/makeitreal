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

## Output

Return a concise verdict: pass, blocked, or inconsistent state. Include exact commands run and the highest-priority next repair.
