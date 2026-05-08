---
description: Generate a PRD, Blueprint, contracts, and Kanban plan
argument-hint: "[feature request | approve | reject]"
allowed-tools: ["Bash", "Read", "AskUserQuestion", "Task"]
---

# Make It Real Plan

Create or review a Make It Real Blueprint.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/plan/SKILL.md
```

If the argument is exactly `approve`, resolve the current run with `status`, then approve that run directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "$CLAUDE_PROJECT_DIR"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint approve "$RUN_DIR" --by operator:slash-command
```

If the argument is exactly `reject`, resolve the current run with `status`, then reject that run directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "$CLAUDE_PROJECT_DIR"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint reject "$RUN_DIR" --by operator:slash-command
```

If the argument is empty or whitespace, enter interactive intake mode before running the engine:

Use the plan skill's Dynamic Intake rubric to derive each question from the current ambiguity, project context, and the user's prior answers. Do not use a fixed question script. Use `AskUserQuestion` only as the Claude Code HITL UI for the next missing planning decision.

Before asking, read nearby project files when they can answer the ambiguity. Ask one focused question at a time, stop as soon as a reviewable plan can be generated, and build a canonical request that captures intended behavior, success criteria, responsibility boundary, contract/API/IO expectation, allowed path scope when known, and verification expectation.

Do not run `makeitreal-engine` plan with an empty `--request`.

When the argument is not empty, or after interactive intake produced a canonical request, generate a zero-context implementation packet:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" plan "$CLAUDE_PROJECT_DIR" --request "<canonical request>" --runner claude-code --verify '{"file":"npm","args":["test"]}'
```

After planning, open the generated dashboard when a run directory is returned:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" dashboard open "$RUN_DIR" --project-root "$CLAUDE_PROJECT_DIR"
```

Report the Blueprint summary, approval state, dashboard URL, and next action.

Do not implement during planning. Launch only after Blueprint approval evidence exists.
