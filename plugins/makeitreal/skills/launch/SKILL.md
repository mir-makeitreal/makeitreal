---
name: launch
description: Use when an approved Make It Real plan should advance into gated Kanban execution, agent orchestration, verification, and live-wiki synchronization.
---

# Make It Real Launch

Advance an approved plan through the harness. Use internal engine commands for gates, board state, claims, orchestration, verification, and wiki sync; expose the workflow to the user as `/makeitreal:launch`.


## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Procedure

0. If there is no active current-run state and the slash command includes a feature request, run the plan workflow for that request and stop at Blueprint review. This preserves Make It Real's plan-first invariant while giving users a Ralph-like one-command start. If there is no current run and no request text, report `/makeitreal:plan <request>` as the next action.
1. Confirm PRD, design pack, contracts, responsibility map, and Kanban work items exist.
2. Run the Ready gate before implementation, including Blueprint approval validation.
3. Let the engine promote `Contract Frozen` work to `Ready` only after the Ready gate passes.
4. Execute only unblocked work items with exactly one responsibility owner.
5. Enforce declared contracts and allowed paths; do not patch around undeclared cross-boundary behavior.
6. Fast-fail on real defects and route failures to the common error/gate path.
7. Run verification and then either sync completed work to the live wiki or record explicit wiki-skip evidence when config disables live wiki.
8. Keep the generated dashboard fresh when `features.dashboard.refreshOnLaunch` is enabled; if disabled, report the explicit dashboard refresh skip without weakening gates.
9. After a successful launch/status transition returns a `dashboardRefresh.dashboardUrl`, run `makeitreal-engine dashboard open "$RUN_DIR" --project-root "${CLAUDE_PROJECT_DIR:-$PWD}"` unless dashboard auto-open is disabled, then include the `dashboardUrl` in the operator report.

## Scoped Subagent Execution

Launch-created subagents are scoped workers, not general chat assistants. Every spawned worker must receive selective context only:

- `MAKEITREAL_BOARD_DIR`
- `MAKEITREAL_WORK_ITEM_ID`
- work-item title, lane, allowed paths, owner, dependencies, and contract IDs
- PRD acceptance criteria relevant to that one work item
- the exact contract/spec documents it may read or implement against
- the structured verification command it must make pass

The runner prompt must state that other files, other work items, and undeclared contracts are outside scope. Subagents may read supporting files needed to understand the assigned paths, but edits must stay inside the work item's allowed paths. General user-created subagents outside Make It Real launch mode must not be blocked merely because a current run exists.

Use contract-first slicing when parallel frontend/backend/data work is required: define contracts first, then launch scoped backend and frontend/data work items against the same frozen contract. Use vertical slices when one responsibility unit can own a complete, testable path.

## Internal Runner Selection

- Use the scripted simulator only for fixture tests or explicit dry runs.
- For real Claude Code execution, require `trust-policy.json` with `runnerMode: "claude-code"`, `realAgentLaunch: "enabled"`, and `commandExecution: "structured-command-only"`.
- Invoke the internal orchestrator with `--runner claude-code` and a structured runner command. A typical command shape is:

```json
{"file":"claude","args":["--print","--output-format","json","--permission-mode","dontAsk","--allowedTools","Read,Write,Edit,MultiEdit,Glob,Grep,LS","--add-dir","${workspace}","--","${prompt}"]}
```

- The engine writes `.makeitreal/handoff.json` and `.makeitreal/prompt.md` inside the deterministic work-item workspace before launching the runner.
- The engine also stages source-of-truth artifacts under `.makeitreal/source/`, including PRD, design pack, board, responsibility map, Blueprint review evidence, contracts, trust policy, and the current work item when present.
- Existing project files that match the work item's allowed paths are staged into the workspace before launch.
- After a successful runner turn, the engine applies only changed allowed-path files from the workspace back to the real project root, then runs completion verification from the real project root.
- The staged `.makeitreal/**` files are immutable runner inputs after launch; if Claude modifies or deletes them, the attempt fails fast.
- Treat structured runner output as authoritative. `turn_completed` is success; failure events such as `turn_input_required`, `unsupported_tool_call`, `turn_failed`, or malformed output keep the work item out of Done.
- The runner command may use `${workspace}`, `${handoffPath}`, `${promptPath}`, `${prompt}`, and `${workItemId}` placeholders. Keep `--` between `${workspace}` and prompt/handoff placeholders because Claude Code treats `--add-dir` as variadic.
- Completion must use the latest recorded successful attempt provenance; do not mark work Done from a manually moved `Verifying` lane.

## Rules

- Do not convert internal commands such as `board claim`, `orchestrator tick`, `gate`, or `wiki sync` into user-facing commands.
- Respect `/makeitreal:config` feature flags. Live wiki is optional, but disabled wiki still requires explicit skip evidence before Done.
- Dashboard generation itself is mandatory for Ready-capable plans; launch refresh flags only control non-mandatory dashboard refresh around launch progress.
- Launch must resolve the current run itself; do not ask the user for an internal board directory during normal operation.
- Do not add fallbacks for impossible states or undeclared SDK/API behavior.
- Keep worker prompts compact. Prefer selective context from the work item, PRD trace, design pack, and contract file over dumping the entire run or repository.
- If verification fails, keep the work item out of Done and report the blocker.
- If a runner fails fast, use the engine retry/reconcile path. Do not claim `Rework -> Ready` auto-recovery unless that authority path is explicitly implemented.
- If there is no active current-run state, start with `/makeitreal:plan <request>` or select an existing run with `/makeitreal:setup --run <runDir>`.
