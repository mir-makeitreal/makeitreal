---
description: Initialize Make It Real for the current Claude Code project
argument-hint: "[--run <existing run id or path>]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Setup

Initialize Make It Real for the current Claude Code project. This command is optional for new work because `/mir:plan <request>` can create and select the run itself.

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
- whether `.makeitreal/` was added to `.gitignore`
- the config path
- whether plugin-native hooks are available
- the next command, normally `/mir:plan <request>`

Do not expose low-level hook installation commands as the normal workflow.
