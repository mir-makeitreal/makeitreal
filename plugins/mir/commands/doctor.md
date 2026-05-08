---
description: Diagnose Make It Real plugin, hooks, config, dashboard, and Claude CLI
argument-hint: "[optional run id or path]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Doctor

Run read-only diagnostics for the Make It Real plugin and active harness state.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/doctor/SKILL.md
```

Run:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" doctor "$CLAUDE_PROJECT_DIR" $ARGUMENTS
```

Report the stable diagnostic fields: `healthy`, failed checks, support matrix, and `nextAction`.
