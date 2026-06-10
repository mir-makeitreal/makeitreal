---
name: launch
description: Use when an approved Make It Real plan should advance into gated Kanban execution, agent orchestration, verification, and live-wiki synchronization.
---

# Make It Real Launch

Advance an approved plan through the harness. Drive the loop with the
`mcp__make-it-real__mir_launch` MCP tool; expose the workflow to the user as
`/mir:launch`. The MCP tool wraps the internal engine commands for
gates, board state, claims, orchestration, verification, and wiki sync — do
not invoke those internal engine commands as user-facing Bash chains.


## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Procedure

0. If there is no active current-run state and the slash command includes a feature request, run the plan workflow for that request and stop at Blueprint review. This preserves Make It Real's plan-first invariant while giving users a Ralph-like one-command start. If there is no current run and no request text, report `/mir:plan <request>` as the next action.
1. Call `mir_launch(action="status")` to check what is launchable. The response carries Ready-gate state, Blueprint-approval state, `launchableWorkItemIds`, `laneCounts`, `blockers`, `nextAction`, and `recommendedNativeTaskConcurrency` derived from unblocked modules. Confirm PRD, design pack, contracts, responsibility map, and Kanban work items exist via this response before continuing.
2. If status shows an existing work item in `Verifying` or `Rework`, do not call `start`. Re-run `mir_launch(action="complete", workItemId=...)` for that work item; completion may recover `Rework -> Verifying` after the root cause is fixed and regenerate work-item verification evidence.
3. Call `mir_launch(action="start")` to get implementation prompts. The tool runs the Ready gate, promotes `Contract Frozen` work to `Ready` only after that gate passes, and returns a `nativeTasks[]` array for each unblocked work item with exactly one responsibility owner. Pass `concurrency` matching `recommendedNativeTaskConcurrency` unless the operator explicitly requested a smaller batch.
4. For each entry in `nativeTasks[]`, dispatch a Claude Code native `Task` using `nativeSubagentType` as the `subagent_type` and `implementationPrompt` as the prompt. After the implementation Task returns, run the reviewer Tasks in `reviewerPrompts[]` the same way. Enforce declared contracts and allowed paths; do not patch around undeclared cross-boundary behavior.
5. Aggregate the implementation node report and reviewer reports into one result envelope, then call `mir_launch(action="finish", workItemId, attemptId, result)` to record the parent-session result. The `result` envelope is one node report (`makeitrealReport`, `makeitrealPmReport`, or `makeitrealEvidenceReport`) plus `makeitrealReviews: [{...}]`; if a native reviewer returned `{ "makeitrealReview": {...} }`, unwrap that object into the array. Validate each Task result before calling `finish`. Record valid sibling envelopes immediately, then rerun only invalid scoped Tasks once with the same handoff packet. Do not call `finish` with empty results, prose-only output, or missing node report JSON. Fast-fail on real defects and route failures to the engine's retry/reconcile path.
6. Call `mir_launch(action="complete", workItemId=...)` for each work item the engine moved to `Verifying`. This action runs verification, syncs completed work to the live wiki, records explicit wiki-skip evidence when config disables live wiki, refreshes the generated dashboard when `features.dashboard.refreshOnLaunch` is enabled (or returns an explicit `dashboardRefresh.skipped` result when disabled), and advances the work item to `Done` only when approved reviewer evidence is present.
7. Repeat the `status -> start -> Task(implement) -> Task(review) -> finish -> complete` loop until status reports no remaining launchable work and no items in `Verifying` or `Rework`.

## Finish Result Envelope

The `result` you pass to `mir_launch(action="finish", ...)` is one node report plus the array of reviewer reports you aggregated from the native Task calls. Implementation nodes use `makeitrealReport`; domain PM nodes use `makeitrealPmReport`; integration evidence nodes use `makeitrealEvidenceReport`. A concrete implementation-node envelope looks like:

```json
{
  "makeitrealReport": {
    "role": "implementation",
    "status": "DONE",
    "summary": "Implemented auth module with login/register endpoints",
    "changedFiles": ["src/auth/router.js", "src/auth/router.test.js"],
    "tested": true,
    "concerns": [],
    "needsContext": false,
    "blockers": []
  },
  "makeitrealReviews": [
    {"role": "spec-reviewer", "status": "APPROVED", "summary": "Contracts satisfied"},
    {"role": "quality-reviewer", "status": "APPROVED_WITH_NOTES", "findings": ["No input sanitization"]},
    {"role": "verification-reviewer", "status": "APPROVED", "summary": "All tests pass"}
  ]
}
```

The node report and the review reports use two separate status vocabularies. Do not use `DONE` or `DONE_WITH_CONCERNS` inside `makeitrealReviews`; the engine rejects unknown review statuses with `HARNESS_REVIEW_STATUS_INVALID`.

Valid node-report `status` values (for `makeitrealReport`, `makeitrealPmReport`, and `makeitrealEvidenceReport`) are: `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`.

- `DONE` — work completed with no outstanding issues.
- `DONE_WITH_CONCERNS` — completed, but non-blocking concerns are recorded in `concerns[]`.
- `NEEDS_CONTEXT` — the node could not finish without more context; `needsContext` is `true` and the gap is described.
- `BLOCKED` — the node could not proceed; `blockers[]` lists the hard blockers.

Valid review `status` values (for each entry in `makeitrealReviews`) are: `APPROVED`, `APPROVED_WITH_NOTES`, `CHANGES_REQUESTED`, `REJECTED`, `NEEDS_CONTEXT`, `BLOCKED`.

- `APPROVED` — the review passed with no outstanding issues.
- `APPROVED_WITH_NOTES` — the review passed; non-blocking notes are recorded in `findings[]`.
- `CHANGES_REQUESTED` — the reviewer requires changes before the work can be approved.
- `REJECTED` — the reviewer rejected the work.
- `NEEDS_CONTEXT` — the reviewer could not judge without more context.
- `BLOCKED` — the review could not proceed.

If a native reviewer returned `{ "makeitrealReview": {...} }`, unwrap that object into the `makeitrealReviews` array. Do not call `finish` with empty results, prose-only output, or a missing node report.

## Operator Report

Lead with the public launch state: whether Blueprint approval is present,
whether execution started, which work item moved, and what the next public action
is. Keep raw engine fields, runner command JSON, run ids, hashes, contract ids,
and HARNESS codes in an advanced diagnostic note only when the user asks or
troubleshooting requires it. Do not lead with raw engine fields.

## Scoped Subagent Execution

Launch-created subagents are scoped workers, not general chat assistants. Every spawned worker must receive selective context only:

- `MAKEITREAL_BOARD_DIR`
- `MAKEITREAL_WORK_ITEM_ID`
- work-item title, lane, allowed paths, owner, dependencies, and contract IDs
- PRD acceptance criteria relevant to that one work item
- the exact contract/spec documents it may read or implement against
- the structured verification command it must make pass

The runner prompt must state that other files, other work items, and undeclared contracts are outside scope. Subagents may read supporting files needed to understand the assigned paths, but edits must stay inside the work item's allowed paths. General user-created subagents outside Make It Real launch mode must not be blocked merely because a current run exists.

Use contract-first slicing when parallel frontend/backend/data work is required: define contracts first, then launch scoped backend and frontend/data work items against the same frozen contract. Use vertical slices when one module can own a complete, testable path.

Do not require pre-created Claude agent files for scoped work. Launch should inject a dynamic role handoff / node-kind handoff into the work-item prompt each time. Node reports use the status protocol `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or `BLOCKED`; reviewer reports use the separate review vocabulary from the Finish Result Envelope section. Implementation nodes use the `implementation-worker` report and the spec-reviewer -> quality-reviewer -> verification-reviewer review loop. Domain PM nodes use `makeitrealPmReport` plus spec-reviewer approval and do not edit code. Integration evidence nodes use `makeitrealEvidenceReport` plus verification-reviewer approval and prove cross-boundary behavior after implementation nodes are Done. Direct free-form agent-to-agent chat is not a coordination mechanism; use board events, dependency artifacts, mailbox entries, claims, and review debt.

For Claude-code attempts, task success alone is not Done evidence. Completion requires the reviewer evidence declared by that node kind in the latest attempt provenance; missing or rejected review evidence routes the work item to Rework instead of Done.

## Blueprint-Authored Prompts and Review Roles

Doctrine: the blueprint (LLM) decides what a worker's job is and which reviewers are required. The engine validates and saves; it does not author intent. Each work item may therefore declare:

- `implementationPrompt` (optional string) — used verbatim as the worker's brief. The engine interpolates only runtime values via the `{{boardDir}}`, `{{projectRoot}}`, `{{attemptId}}`, and `{{workItemId}}` placeholders. When absent, the engine falls back to a generated default and logs a deprecation warning to stderr.
- `reviewerPrompts` (optional object) — maps a review role (e.g. `spec-reviewer`) to that reviewer's brief, used verbatim with the same placeholder interpolation. When a role's prompt is absent, the engine falls back to a generated default and logs a deprecation warning.
- `requiredReviewRoles` (optional array) — the exact review roles the engine must collect before completion. When absent, the engine falls back to the node-kind default (`implementation` → spec/quality/verification, `domain-pm` → spec, `integration-evidence` → verification) and logs a deprecation warning.

Declaring these in the blueprint keeps prompt authorship and review policy with the LLM. The fallbacks exist only for backward compatibility; a deprecation warning on stderr signals a work item that should declare them.

## Internal Runner Selection

- Use the scripted simulator only for fixture tests or explicit dry runs.
- For real Claude Code execution, require `trust-policy.json` with `runnerMode: "claude-code"`, `realAgentLaunch: "enabled"`, and `commandExecution: "structured-command-only"`.
- For all real Claude Code execution, use the parent-session native Task path driven by the `mir_launch` MCP tool. The `start` action returns `nativeTasks[]`; iterate it, use each entry's `nativeSubagentType` as the Claude Code `Task` type and its `implementationPrompt` as the prompt, then run the reviewer prompts via `nativeTasks[].reviewerPrompts[]` the same way. `spec-reviewer`, `quality-reviewer`, and `verification-reviewer` are Make It Real evidence roles, not guaranteed installed Claude Code `subagent_type` names. Do not pass those role labels as `subagent_type` unless Claude Code lists them as available agents. Use the builtin `general-purpose` Task type unless this project has an explicit `native-role-mapping.json` that maps a Make It Real evidence role to an available installed Claude Code subagent type. The Make It Real role lives in the prompt and recorded JSON, not in an external plugin label. If a configured type is unavailable, stop launch and report `HARNESS_NATIVE_ROLE_MAPPING_MISSING`; update `native-role-mapping.json` before dispatch.
- Do not spawn `claude --print`, shell out to a second Claude Code process, or hide implementation in a headless child runner. If the native `Task` tool is unavailable, stop and report that Make It Real launch requires Claude Code native subagents.
- Completion must use the latest parent-session native Task attempt provenance and approved reviewer evidence; do not mark work Done from a manually moved `Verifying` lane.

## Rules

- Drive the launch loop through `mir_launch`. Do not convert internal commands such as `board claim`, `orchestrator tick`, `gate`, or `wiki sync` into user-facing Bash commands.
- Respect `/mir:config` feature flags. Live wiki is optional, but disabled wiki still requires explicit skip evidence before Done.
- Dashboard generation itself is mandatory for Ready-capable plans; launch refresh flags only control non-mandatory dashboard refresh around launch progress.
- Launch must resolve the current run itself; do not ask the user for an internal board directory during normal operation.
- Do not add fallbacks for impossible states or undeclared SDK/API behavior.
- Keep worker prompts compact. Prefer selective context from the work item, PRD trace, design pack, and contract file over dumping the entire run or repository.
- If verification fails, keep the work item out of Done and report the blocker.
- If a runner fails fast, use the engine retry/reconcile path. If verification or review routed the item to `Rework`, rerun `mir_launch(action="complete", workItemId=...)` after the root cause is fixed; the engine may re-enter `Verifying` and regenerate work-item evidence without relaunching the implementation worker.
- If there is no active current-run state, start with `/mir:plan <request>` or select an existing run with `/mir:setup --run <runDir>`.
- Do not call a successful Done transition a hook failure or false-positive hook signal in the operator report. Mention hook diagnostics only when a hook is the current blocker.
