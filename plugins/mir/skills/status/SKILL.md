---
name: status
description: Use when a Make It Real run needs a read-only status summary of setup, hooks, Kanban state, active work, blockers, or verification evidence.
---

# Make It Real Status

Summarize the current harness state without changing implementation.


## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Procedure

1. Read hook status, run directory, board lanes, active claims, mailbox/blockers, runtime state, and latest verification evidence.
2. Start with `makeitreal-engine status "$CLAUDE_PROJECT_DIR"` when the plugin binary is available.
3. Treat status as control-plane read-only. It may refresh generated `preview/` dashboard artifacts when config enables dashboard refresh, but it must not mutate board/run/approval/config/evidence state.
4. If `dashboardRefresh.dashboardUrl` is present and dashboard auto-open is enabled, run `makeitreal-engine dashboard open "$RUN_DIR" --project-root "$CLAUDE_PROJECT_DIR"` so the browser dashboard appears for the operator.
5. Report the stable operator summary fields: `phase`, `blueprintStatus`, `headline`, `blockers`, `nextAction`, `evidenceSummary`, `dashboardRefresh`, and `dashboardUrl`.
6. Separate verified facts from suspected causes.
7. Identify the next actionable workflow command: setup, plan, launch, or verify.

## Phase Contract

Status may report `planning-required`, `approval-required`, `launch-ready`, `running`, `verifying`, `human-review`, `failed-fast`, `rework-required`, `blocked`, or `done`.

Use only public next actions in the user-facing report:

- `/mir:setup`
- `/mir:plan <request>`
- `/mir:config`
- Conversational Blueprint review classified by the LLM judge
- `/mir:plan approve` as the explicit/scriptable fallback
- `/mir:launch`
- `/mir:status`
- `/mir:verify`
- `/mir:doctor`

## Output

Keep the report short: current phase, completed items, active blockers, and the next command to run.
