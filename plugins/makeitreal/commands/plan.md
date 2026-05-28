---
description: Generate a PRD, Blueprint, contracts, and Kanban plan
argument-hint: "[feature request | approve | reject]"
allowed-tools: ["Bash", "Read", "AskUserQuestion", "Task", "mcp__make-it-real__mir_blueprint"]
---

# Make It Real Plan

Create or review a Make It Real Blueprint.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/plan/SKILL.md
```

`$ARGUMENTS` is the operator's input. Treat it as one of:

- exactly `approve` → approve the current run's Blueprint;
- exactly `reject` → reject the current run's Blueprint;
- empty / whitespace → enter interactive intake before planning;
- anything else → the canonical feature request.

## Approve / Reject

If the argument is exactly `approve`, resolve the current run with `status`, then approve that run directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "${CLAUDE_PROJECT_DIR:-$PWD}"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint approve "$RUN_DIR" --by operator:slash-command
```

If the argument is exactly `reject`, resolve the current run with `status`, then reject that run directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "${CLAUDE_PROJECT_DIR:-$PWD}"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint reject "$RUN_DIR" --by operator:slash-command
```

## Interactive Intake (empty `$ARGUMENTS`)

If `$ARGUMENTS` is empty or whitespace, do **not** call `mir_blueprint` yet. Use the plan skill's Dynamic Intake rubric: derive each question from the current ambiguity, project context, and the user's prior answers. Use `AskUserQuestion` as the HITL UI, one focused question at a time.

Before asking, read nearby project files when they can answer the ambiguity. Stop intake as soon as a reviewable plan can be generated, and build a canonical request that captures intended behavior, success criteria, module boundary, contract/API/IO expectation, allowed path scope when known, and verification expectation.

## Generating the Blueprint

When the argument is a feature request, or after interactive intake produced a canonical request:

1. Read the project context (file tree, `package.json`, existing patterns, real verification commands).
2. Design a flat `BlueprintProposal` matching the schema in the plan skill (`title`, `summary`, `goals`, `nonGoals`, `acceptanceCriteria`, `assumptions`, `modules[]`, `workItems[]`, `scenarios[]`).
3. Call the MCP tool `mcp__make-it-real__mir_blueprint` with the proposal at the top level of the arguments, plus:
   - `projectRoot`: `${CLAUDE_PROJECT_DIR:-$PWD}` resolved to an absolute path,
   - `runSlug`: a short kebab-case identifier derived from the request (e.g. `feature-email-login`).
4. **Never output the raw JSON to the user. Always submit through the MCP tool.**
5. If the tool returns `ok: false`, read each `errors[].code` and `errors[].reason`, fix only those issues, and call the tool again. Iterate; do not start over.

The MCP server validates the proposal, writes `.makeitreal/runs/<runSlug>/` with PRD, design pack, board, trust policy, runtime state, and renders the dashboard preview. The success response contains `runDir`, `workItemCount`, and `previewUrl`.

## Operator-Facing Report

After `mir_blueprint` returns `ok: true`, present the Blueprint as a reviewable development plan in the user's language. Lead with what will be delivered, not engine state. Use compact Markdown tables:

1. **What will be delivered** — outcome, deliverables, user/codebase value, and acceptance evidence.
2. **Scope** — in-scope work, out-of-scope work, and safe-to-change areas.
3. **Modules** — each module's purpose, owned paths, and contracts.
4. **Work packages** — each work item, the module it targets, dependency, and verification command.
5. **Review decisions** — only decisions the operator must approve, reject, or revise.
6. **Next action** — the `previewUrl` returned by the tool plus approval, revision, or rejection instruction.

Do not lead with raw engine fields such as run ids, run directories, owner ids, lane names, or `HARNESS_*` codes. Diagnostics belong only in a short secondary note when the plan failed or the user asks for details.

## Review Decision

After the report, ask one Claude Code `AskUserQuestion` review question in the user's language. The question should offer the natural decision paths: approve and launch, request changes, or reject. Make the prompt clear that a free-form answer is also acceptable.

If the question returns an answer, classify the operator's intent yourself in this same Claude Code session instead of deciding from the selected option text. Do not spawn `claude --print`, `claude --json-schema`, or a second Claude process. When the answer is `approved`, `rejected`, or `revision_requested`, record your native judgment with:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint review "$RUN_DIR" --prompt "<operator answer>" --decision-json '{"decision":"approved","launchRequested":true,"confidence":"high","reason":"native Claude Code judgment"}' --session question-ui --project-root "${CLAUDE_PROJECT_DIR:-$PWD}"
```

Never run `blueprint review` without both `--prompt` and `--decision-json`. The engine does not judge the operator's text; the current Claude Code session judges it first, then the engine records that structured judgment.

Do not branch on the selected label. Use the full answer and Blueprint report as context for your native Claude Code judgment; set `launchRequested:true` only when the operator asks to start now after approval, otherwise set it to `false`. Change the example JSON decision to `rejected` or `revision_requested` when that is your judgment.

If the question is dismissed or the operator answers later in chat, do not force a slash command. Tell them they can reply naturally with approval, requested changes, or rejection; the `UserPromptSubmit` hook will inject the same native review protocol into the current Claude Code session. When approval includes launch intent, continue by executing the launch skill's native Task sequence in this same session; do not ask the operator to type `/makeitreal:launch`. `/makeitreal:plan approve` and `/makeitreal:plan reject` are scriptable controls, not the primary UX.

Do not implement during planning. Launch only after Blueprint approval evidence exists.
