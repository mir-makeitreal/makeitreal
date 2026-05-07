---
description: Initialize Make It Real for the current Claude Code project
argument-hint: "[optional run id or path]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Setup

Initialize Make It Real for the current Claude Code project.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/setup/SKILL.md
```

Use the plugin engine from the plugin root when running internal commands:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" setup "$CLAUDE_PROJECT_DIR" $ARGUMENTS
```

Then report:

- the active run directory
- whether plugin-native hooks are available
- the next command, normally `/makeitreal:plan <request>`

Do not expose low-level hook installation commands as the normal workflow.
