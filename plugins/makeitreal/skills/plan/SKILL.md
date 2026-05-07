---
name: plan
description: Use when a feature request needs Make It Real PRD, architecture, responsibility boundaries, contracts, design-pack artifacts, or Kanban work decomposition before implementation.
---

# Make It Real Plan

Create a zero-context implementation packet before any code changes. The packet must be specific enough for another agent or machine to verify implementation against it. The user-facing action is `/makeitreal:plan`.

Subcommands:

- `/makeitreal:plan <request>` generates reviewable PRD/Blueprint artifacts and seeds pending approval.
- LLM-classified conversational review is the normal path: after the Blueprint is shown, the `UserPromptSubmit` hook asks an LLM to classify the user's reply as `approved`, `rejected`, `revision_requested`, or `none`, then records clear review decisions as `makeitreal:interactive-review:llm`.
- `/makeitreal:plan approve` is the explicit/scriptable fallback that approves the current Blueprint through the internal `blueprint approve` command.
- `/makeitreal:plan reject` is the explicit/scriptable fallback that rejects the current Blueprint through the internal `blueprint reject` command.

## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Engine Bridge

When the plugin binary is available, start by running:

```bash
makeitreal-engine plan "$CLAUDE_PROJECT_DIR" --request "$ARGUMENTS" --runner claude-code --verify '{"file":"npm","args":["test"]}'
```

Derive the structured verification command from the project context. `--verify` must be JSON with `file` and `args`, not a shell string. Keep `--runner claude-code` for normal Claude Code plugin use so the generated trust policy can launch real Claude Code through `/makeitreal:launch`; use the scripted simulator only for fixture tests or explicit dry runs. If no honest command exists yet, report the blocked Ready gate instead of inventing a placeholder. Use `--run`, `--owner`, `--allowed-path`, or `--api` only when the request or project context makes those values explicit.

After a successful plan creates `preview/index.html`, run:

```bash
makeitreal-engine dashboard open "$RUN_DIR" --project-root "$CLAUDE_PROJECT_DIR"
```

Report the returned `dashboardUrl` so the operator can reopen the Kanban/Blueprint dashboard manually if the OS browser launch is skipped or blocked.

## Required Artifacts

- PRD with goals, non-goals, acceptance criteria, and user-visible behavior.
- Design pack covering system architecture, state-transition flow, API or IO contracts, responsibility boundaries, call stack, and sequence diagrams.
- Responsibility map with exactly one owner per executable work item.
- Boundary contracts for cross-module communication.
- Kanban work items with dependencies, allowed paths, verification commands, and Done evidence.
- Launch board, trust policy, and runtime state seed so the approved plan can be launched from the current run without fixture-only state.

## Rules

- Do not implement during planning.
- Do not assume language-specific module boundaries unless the project requires them.
- Cross-domain teams must be able to work from contracts without reading each other's implementation.
- Generated OpenAPI, schemas, AST checks, or equivalent contract evidence must be planned before launch.
- Run the internal Ready gate when artifacts exist and report any blocking codes.
- A plan may succeed with `planOk: true` while `implementationReady: false` when the only blocker is `HARNESS_BLUEPRINT_APPROVAL_PENDING`.
- Do not launch or implement until the user has reviewed and approved the Blueprint. Approval may arrive through LLM-classified conversational review or the explicit `/makeitreal:plan approve` fallback, but both must write `blueprint-review.json`.
- If the LLM review judge classifies the user's reply as approval plus launch intent, continue to `/makeitreal:launch` after the hook records the approval artifact.
- After approval, launch owns the `Contract Frozen -> Ready` promotion through the Ready gate; do not mutate board lanes manually.
- If setup has not recorded an active run, stop and run `/makeitreal:setup` first.
