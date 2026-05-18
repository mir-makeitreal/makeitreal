---
description: Launch an approved Make It Real plan through gated execution
argument-hint: "[feature request | optional run id/path]"
allowed-tools: ["Bash", "Read", "Task"]
---

# Make It Real Launch

Advance the approved Make It Real run through Ready, execution, verification, wiki evidence, and Done gates.

If there is no active current run and `$ARGUMENTS` is a feature request, treat
`/makeitreal:launch <request>` as a one-command start. Generate the Blueprint
with the same planning rules as `/makeitreal:plan <request>`, open/report the
dashboard, and stop at Blueprint review. Do not execute implementation until the
Blueprint is approved.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/launch/SKILL.md
```

Use the plugin engine for the internal sequence described by the skill. Default
to the parent-session native Task path so Claude Code shows the implementation
and reviewer subagents in its normal UI:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "${CLAUDE_PROJECT_DIR:-$PWD}"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" gate "$RUN_DIR" --target Ready
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" orchestrator native start "$RUN_DIR" --concurrency 6
```

Use `boardStatus.recommendedNativeTaskConcurrency` from status when present.
It is derived from unblocked responsibility units, and `launchableWorkItemIds`
shows which scoped jobs should become native Claude Code `Task` calls.

If status shows a work item already in `Verifying` or `Rework`, do not start a
new implementation task. Re-run completion for that work item instead; the
engine can recover `Rework -> Verifying` after the root cause is fixed and will
regenerate work-item verification evidence:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" orchestrator complete "$RUN_DIR" --work "$WORK_ITEM_ID" --runner claude-code
```

Then iterate over the returned `nativeTasks[]` array. For each entry, use
`nativeTasks[].nativeSubagentType` as the Claude Code `Task` type and
`nativeTasks[].implementationPrompt` as the prompt. After that implementation
task returns, run three read-only native `Task` reviewers using each
`nativeTasks[].reviewerPrompts[]` entry's `nativeSubagentType` and `prompt`. The labels
below are Make It Real evidence roles, not guaranteed installed Claude Code
`subagent_type` names. Do not pass these labels as `subagent_type` unless
Claude Code lists them as available agents. Use the builtin `general-purpose`
Task type unless this project has an explicit `native-role-mapping.json` that
maps a Make It Real evidence role to an available installed Claude Code
subagent type. The Make It Real role lives in the prompt and recorded JSON, not
in an external plugin label. If a configured type is unavailable, stop launch
and report `HARNESS_NATIVE_ROLE_MAPPING_MISSING`; update
`native-role-mapping.json` before dispatch:

- `spec-reviewer`
- `quality-reviewer`
- `verification-reviewer`

Aggregate the native Task's node report and reviewer reports into one JSON
object, then record the parent-session result. The node report key must match
the work-item kind: `makeitrealReport` for implementation,
`makeitrealPmReport` for domain PM, or `makeitrealEvidenceReport` for
integration evidence. Do not call `native finish` with empty stdin, prose-only
output, or a placeholder report. When a concurrent batch has mixed results,
record the valid sibling envelopes first and rerun only the invalid scoped
Task; do not strand valid siblings behind one malformed report:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" orchestrator native finish "$RUN_DIR" --work "$WORK_ITEM_ID" --attempt "$ATTEMPT_ID" --result-stdin <<'MAKEITREAL_RESULT'
{
  "makeitrealReport": { "role": "implementation-worker", "status": "DONE", "summary": "Task result summary.", "changedFiles": ["path/from/project-root"], "tested": ["declared verification command"], "concerns": [], "needsContext": [], "blockers": [] },
  "makeitrealReviews": []
}
MAKEITREAL_RESULT
```

Then complete only the work items that the engine moved to `Verifying` and that
have successful attempt provenance:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" orchestrator complete "$RUN_DIR" --work "$WORK_ITEM_ID" --runner claude-code
```

Do not spawn a separate `claude --print` child process. Make It Real launches
real work through the parent Claude Code session's native `Task` tool so the
user can inspect subagent activity in the normal Claude Code UI.

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

Do not describe successful completion as a hook failure or false-positive hook
signal. Hook diagnostics belong only in the report when a hook is the actual
remaining blocker.

Do not describe the low-level engine sequence as separate user-facing workflow commands.
