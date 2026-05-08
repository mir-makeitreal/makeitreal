---
description: Run Make It Real verification for the active run
argument-hint: "[optional run id or path]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Verify

Run verification for the active Make It Real run.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/verify/SKILL.md
```

Resolve the current run and then run verification on the run directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "$CLAUDE_PROJECT_DIR"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" verify "$RUN_DIR" $ARGUMENTS
```

Report the verification evidence path, pass/fail result, dashboard refresh result, and next public command.

Do not mark work Done manually. Done belongs to the engine gate.
