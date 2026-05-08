---
description: Read or update Make It Real optional feature flags
argument-hint: "[get | live-wiki enabled|disabled | dashboard flags]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Config

Read or update project-local Make It Real configuration.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/config/SKILL.md
```

For read-only config status:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" config get "$CLAUDE_PROJECT_DIR"
```

For updates, pass the user's arguments through the public config surface:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" config set "$CLAUDE_PROJECT_DIR" $ARGUMENTS
```

Report the resulting live wiki and dashboard feature flags.

Live wiki is optional. Disabling it must still produce explicit skip evidence before Done.
