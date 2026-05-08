---
description: Generate a PRD, Blueprint, contracts, and Kanban plan
argument-hint: "<feature request | approve | reject>"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
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

Otherwise, generate a zero-context implementation packet:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" plan "$CLAUDE_PROJECT_DIR" --request "$ARGUMENTS" --runner claude-code --verify '{"file":"npm","args":["test"]}'
```

After planning, open the generated dashboard when a run directory is returned:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" dashboard open "$RUN_DIR" --project-root "$CLAUDE_PROJECT_DIR"
```

Report the Blueprint summary, approval state, dashboard URL, and next action.

Do not implement during planning. Launch only after Blueprint approval evidence exists.
