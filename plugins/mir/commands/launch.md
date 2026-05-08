---
description: Launch an approved Make It Real plan through gated execution
argument-hint: "[feature request | optional run id/path]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Launch

Advance the approved Make It Real run through Ready, execution, verification, wiki evidence, and Done gates.

If there is no active current run and `$ARGUMENTS` is a feature request, treat
`/mir:launch <request>` as a one-command start. Generate the Blueprint
with the same planning rules as `/mir:plan <request>`, open/report the
dashboard, and stop at Blueprint review. Do not execute implementation until the
Blueprint is approved.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/launch/SKILL.md
```

Use the plugin engine for the internal sequence described by the skill:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "${CLAUDE_PROJECT_DIR:-$PWD}"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" gate "$RUN_DIR" --target Ready
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" orchestrator tick "$RUN_DIR" --runner claude-code --runner-command '{"file":"claude","args":["--print","--output-format","json","--permission-mode","dontAsk","--allowedTools","Read,Write,Edit,MultiEdit,Glob,Grep,LS","--add-dir","${workspace}","--","${prompt}"]}'
```

Then complete only the work items that the engine moved to `Verifying` and that have successful attempt provenance:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" orchestrator complete "$RUN_DIR" --work "$WORK_ITEM_ID" --runner claude-code
```

If the command returns a dashboard refresh URL or the skill asks for the dashboard to be opened, open it:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" dashboard open "$RUN_DIR" --project-root "${CLAUDE_PROJECT_DIR:-$PWD}"
```

Report:

- current phase
- executed work items
- verification result
- live wiki result or explicit wiki-skip evidence
- dashboard URL

Do not describe the low-level engine sequence as separate user-facing workflow commands.
