---
description: Show Make It Real run phase, blockers, evidence, and dashboard
argument-hint: "[optional run id or path]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Status

Show read-only status for the active Make It Real run.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/status/SKILL.md
```

Run:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "$CLAUDE_PROJECT_DIR" $ARGUMENTS
```

If the result includes a dashboard URL and auto-open is enabled, open it:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" dashboard open "$RUN_DIR" --project-root "$CLAUDE_PROJECT_DIR"
```

Report the stable operator fields: phase, Blueprint status, blockers, evidence summary, dashboard URL, and next public command.

Status must remain read-only except for optional dashboard preview refresh.
