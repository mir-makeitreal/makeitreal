---
description: Launch an approved Make It Real plan through gated execution
argument-hint: "[feature request | optional run id/path]"
allowed-tools: ["Bash", "Read", "Task", "mcp__make-it-real__mir_launch"]
---

# Make It Real Launch

Advance the approved Make It Real run through Ready, execution, verification, wiki evidence, and Done gates by driving the `mcp__make-it-real__mir_launch` MCP tool. The MCP tool wraps the internal engine sequence; do not assemble user-facing Bash chains against `makeitreal-engine` for the launch pipeline.

If there is no active current run and `$ARGUMENTS` is a feature request, treat
`/mir:launch <request>` as a one-command start. Generate the Blueprint
with the same planning rules as `/mir:plan <request>`, open/report the
dashboard, and stop at Blueprint review. Do not execute implementation until the
Blueprint is approved.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/launch/SKILL.md
```

## Launch Loop

Drive the parent-session native Task path through the MCP tool so Claude Code shows the implementation and reviewer subagents in its normal UI. The `mir_launch` tool requires `projectRoot` (absolute path, normally `${CLAUDE_PROJECT_DIR:-$PWD}`), `runSlug` (the current run id from status), and `action`.

1. `mir_launch(action="status")` — read launchable work, `recommendedNativeTaskConcurrency`, blockers, Ready-gate result, and Blueprint approval state. The recommendation is derived from unblocked modules; `launchableWorkItemIds` shows which scoped jobs should become native Claude Code `Task` calls.

2. If status shows a work item already in `Verifying` or `Rework`, do not start a new implementation task. Re-run completion for that work item instead; the engine can recover `Rework -> Verifying` after the root cause is fixed and will regenerate work-item verification evidence:

   `mir_launch(action="complete", workItemId=<id>)`

3. `mir_launch(action="start", concurrency=<recommended or smaller>)` — receive `nativeTasks[]` with implementation prompts. Iterate the array. For each entry, use `nativeTasks[].nativeSubagentType` as the Claude Code `Task` type and `nativeTasks[].implementationPrompt` as the prompt. After that implementation task returns, run the reviewer native `Task` calls using each `nativeTasks[].reviewerPrompts[]` entry's `nativeSubagentType` and `prompt`. The labels below are Make It Real evidence roles, not guaranteed installed Claude Code `subagent_type` names. Do not pass these labels as `subagent_type` unless Claude Code lists them as available agents. Use the builtin `general-purpose` Task type unless this project has an explicit `native-role-mapping.json` that maps a Make It Real evidence role to an available installed Claude Code subagent type. The Make It Real role lives in the prompt and recorded JSON, not in an external plugin label. If a configured type is unavailable, stop launch and report `HARNESS_NATIVE_ROLE_MAPPING_MISSING`; update `native-role-mapping.json` before dispatch:

   - `spec-reviewer`
   - `quality-reviewer`
   - `verification-reviewer`

4. Aggregate the native Task's node report and reviewer reports into one JSON object, then call `mir_launch(action="finish", workItemId=<id>, attemptId=<attempt>, result=<envelope>)`. The node report key must match the work-item kind: `makeitrealReport` for implementation, `makeitrealPmReport` for domain PM, or `makeitrealEvidenceReport` for integration evidence. Do not call `finish` with empty input, prose-only output, or a placeholder report. When a concurrent batch has mixed results, record the valid sibling envelopes first and rerun only the invalid scoped Task; do not strand valid siblings behind one malformed report. Example envelope:

   ```json
   {
     "makeitrealReport": { "role": "implementation-worker", "status": "DONE", "summary": "Task result summary.", "changedFiles": ["path/from/project-root"], "tested": ["declared verification command"], "concerns": [], "needsContext": [], "blockers": [] },
     "makeitrealReviews": []
   }
   ```

5. Then complete only the work items that the engine moved to `Verifying` and that have successful attempt provenance:

   `mir_launch(action="complete", workItemId=<id>)`

   The `complete` action runs verification, refreshes the dashboard when enabled, syncs the live wiki (or records explicit wiki-skip evidence when disabled), and advances the work item to `Done` only when approved reviewer evidence is present.

6. Repeat `status -> start -> Task(implement) -> Task(review) -> finish -> complete` until status reports no remaining launchable work and no items in `Verifying` or `Rework`.

Do not spawn a separate `claude --print` child process. Make It Real launches real work through the parent Claude Code session's native `Task` tool so the user can inspect subagent activity in the normal Claude Code UI.

## Operator Report

Report:

- current phase
- executed work items
- verification result
- live wiki result or explicit wiki-skip evidence
- dashboard URL (when the `complete` response carries `dashboardRefresh.dashboardUrl`)

Lead with the public launch state. Keep raw engine fields, runner command JSON, run ids, hashes, contract ids, and HARNESS codes in an advanced diagnostic note only when the user asks or troubleshooting requires it. Do not lead with raw engine fields.

Do not describe successful completion as a hook failure or false-positive hook signal. Hook diagnostics belong only in the report when a hook is the actual remaining blocker.

Do not describe the low-level MCP-tool sequence as separate user-facing workflow commands.
