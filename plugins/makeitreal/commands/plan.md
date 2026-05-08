---
description: Generate a PRD, Blueprint, contracts, and Kanban plan
argument-hint: "[feature request | approve | reject]"
allowed-tools: ["Bash", "Read", "AskUserQuestion", "Task"]
---

# Make It Real Plan

Create or review a Make It Real Blueprint.

First read and follow the plugin skill:

```text
${CLAUDE_PLUGIN_ROOT}/skills/plan/SKILL.md
```

If the argument is exactly `approve`, resolve the current run with `status`, then approve that run directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "$CLAUDE_PROJECT_DIR"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint approve "$RUN_DIR" --by operator:slash-command
```

If the argument is exactly `reject`, resolve the current run with `status`, then reject that run directory:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" status "$CLAUDE_PROJECT_DIR"
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint reject "$RUN_DIR" --by operator:slash-command
```

If the argument is empty or whitespace, enter interactive intake mode before running the engine:

Use the plan skill's Dynamic Intake rubric to derive each question from the current ambiguity, project context, and the user's prior answers. Do not use a fixed question script. Use `AskUserQuestion` only as the Claude Code HITL UI for the next missing planning decision.

Before asking, read nearby project files when they can answer the ambiguity. Ask one focused question at a time, stop as soon as a reviewable plan can be generated, and build a canonical request that captures intended behavior, success criteria, responsibility boundary, contract/API/IO expectation, allowed path scope when known, and verification expectation.

Do not run `makeitreal-engine` plan with an empty `--request`.

When the argument is not empty, or after interactive intake produced a canonical request, generate a zero-context implementation packet:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" plan "$CLAUDE_PROJECT_DIR" --request "<canonical request>" --runner claude-code --verify '{"file":"npm","args":["test"]}'
```

After planning, open the generated dashboard when a run directory is returned:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" dashboard open "$RUN_DIR" --project-root "$CLAUDE_PROJECT_DIR"
```

Report an operator-facing Blueprint report in the user's language.

Lead with what will be delivered, not engine state. Use compact Markdown tables:

1. **What will be delivered** - outcome, deliverables, user/codebase value, and acceptance evidence.
2. **Scope** - in-scope work, out-of-scope work, and safe-to-change areas.
3. **Work packages** - each package, its purpose, dependency, and verification method.
4. **Review decisions** - only decisions the operator must approve, reject, or revise.
5. **Next action** - dashboard URL plus approval, revision, or rejection instruction.

Do not lead with raw engine fields such as `planOk`, `implementationReady`, `HARNESS_*` codes, fingerprint hashes, run ids, run directories, owner ids, contract ids, lane names, or allowed-path lists. Diagnostics belong only in a short secondary note when the plan failed or the user asks for details.

After the report, ask one Claude Code `AskUserQuestion` review question in the user's language. The question should offer the natural decision paths: approve and launch, request changes, or reject. Make the prompt clear that a free-form answer is also acceptable.

If the question returns an answer, send that answer through the same LLM review judge instead of deciding from the selected option text:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" blueprint review "$RUN_DIR" --prompt "<full AskUserQuestion answer>" --context "<Blueprint report just shown>" --session question-ui --project-root "$CLAUDE_PROJECT_DIR"
```

Do not branch on the selected label. The `blueprint review` command owns approval, rejection, revision-request classification, and `blueprint-review.json` writes.

If the question is dismissed or the operator answers later in chat, do not force a slash command. Tell them they can reply naturally with approval, requested changes, or rejection; the `UserPromptSubmit` hook will send that reply to the same LLM review judge. `/makeitreal:plan approve` and `/makeitreal:plan reject` are scriptable fallbacks, not the primary UX.

Do not implement during planning. Launch only after Blueprint approval evidence exists.
