---
description: Review or change Make It Real settings through semantic operator choices
argument-hint: "[wiki off | dashboard quiet | default | advanced]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Make It Real Config

Review or update project-local Make It Real configuration without exposing
engine-shaped config keys as the normal UX.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/config/SKILL.md
```

Always inspect current settings first:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" config get "${CLAUDE_PROJECT_DIR:-$PWD}"
```

If `$ARGUMENTS` is empty or unclear, show a compact settings table and use
AskUserQuestion to ask what the operator wants to change.

If `$ARGUMENTS` is present, classify the semantic operator intent. Do not pass
raw `$ARGUMENTS` through to the engine. Run only one of the deterministic actions
listed in the skill, such as:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" config set "${CLAUDE_PROJECT_DIR:-$PWD}" --profile quiet
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" config set "${CLAUDE_PROJECT_DIR:-$PWD}" --profile default
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" config set "${CLAUDE_PROJECT_DIR:-$PWD}" --live-wiki disabled
```

Report the resulting setting names in user language. Do not present key/value
config editing as the normal path.
