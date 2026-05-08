---
name: plan
description: Use when a feature request needs Make It Real PRD, architecture, responsibility boundaries, contracts, design-pack artifacts, or Kanban work decomposition before implementation.
---

# Make It Real Plan

Create a zero-context implementation packet before any code changes. The packet must be specific enough for another agent or machine to verify implementation against it. The user-facing action is `/makeitreal:plan`.

Subcommands:

- `/makeitreal:plan` with no request starts interactive intake through Claude Code `AskUserQuestion`, then generates the Blueprint from the collected canonical request.
- `/makeitreal:plan <request>` generates reviewable PRD/Blueprint artifacts and seeds pending approval.
- LLM-classified conversational review is the normal path: after the Blueprint is shown, the `UserPromptSubmit` hook asks an LLM to classify the user's reply as `approved`, `rejected`, `revision_requested`, or `none`, then records clear review decisions as `makeitreal:interactive-review:llm`.
- `/makeitreal:plan approve` is the explicit/scriptable fallback that approves the current Blueprint through the internal `blueprint approve` command.
- `/makeitreal:plan reject` is the explicit/scriptable fallback that rejects the current Blueprint through the internal `blueprint reject` command.

## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Prompt Discipline

### Conditional Grill

Ask a short clarification round only when the plan cannot honestly define ownership, contracts, or verification. Keep it to the missing decision: owner, allowed paths, public contract, or real verification command. If the missing piece can be inferred from existing project files, inspect those files first instead of interviewing the user.

When `/makeitreal:plan` is invoked without a request, clarification is not optional. Use `AskUserQuestion` to collect the missing feature request before calling the engine. Continue with one focused `AskUserQuestion` at a time until the request is specific enough to name intended behavior, responsibility boundary, contract/API/IO expectation, and verification expectation.

Do not invent placeholders to pass Ready. If no honest verification command exists, report the blocked Ready gate and the exact missing command shape.

### Dynamic Intake

Do not use a fixed question script. Treat request intake as an adaptive spec-refinement loop: read the current repo context, surface assumptions, derive the next question from the single most important ambiguity, then converge as soon as the Blueprint can be reviewed.

Use `AskUserQuestion` as the HITL UI, not as a canned questionnaire. The next question should be generated from one of these missing facts:

- intended user-visible behavior and success criteria;
- responsibility unit and exactly-one owner;
- cross-boundary contract, API, schema, or IO surface;
- allowed path scope and files that must not be touched;
- real verification evidence, including test/build/static/contract checks.

Borrow the spec-first shape: clarify objective, success criteria, project constraints, and boundaries before planning. Borrow the task-breakdown shape: prefer vertical slices, explicit dependencies, acceptance criteria, and checkpoints. Borrow context-engineering discipline: inspect relevant local files before asking and keep intake focused on the current missing decision.

After each answer, restate only the updated assumption that affects the plan. If the answer creates a conflict with existing code or prior user direction, surface that conflict and ask the next `AskUserQuestion` about the conflict rather than silently choosing a side.

### Read-Only Parallel Reconnaissance

When the request is broad, cross-cutting, or likely to require repo discovery before a good question can be asked, use read-only `Task` subagents before asking the operator. Task subagents are for reconnaissance only during planning: they may inspect files, map responsibilities, find existing patterns, and report candidate boundaries, but they must not edit files or start implementation.

Use parallel reconnaissance only when it reduces uncertainty. Good split points are independent domains, such as current architecture, tests/verification commands, public API or IO contracts, and naming/path conventions. Synthesize subagent findings into one operator-facing summary before asking the next `AskUserQuestion`.

Do not outsource the actual planning decision to subagents. The leader owns the canonical request, Blueprint wording, and the final question shown to the operator.

### Operator-Facing Questions

Do not expose internal harness terms in `AskUserQuestion` prompts unless the user is explicitly developing Make It Real itself or asks for internals. Avoid raw terms such as board, orchestrator, owner, responsibility unit, lane, claim, gate, and run directory in user-facing choices.

Translate internal concepts into the user's domain language:

- say "Which part of the product/codebase should this change belong to?" instead of "which owner/responsibility unit owns this?";
- say "Should this be one end-to-end slice or split into separate work packages?" instead of "vertical slice vs board domains?";
- say "What files or areas should be safe to change?" instead of "allowed paths";
- say "How should we prove it works?" instead of "verification evidence".

The Blueprint may still contain precise internal fields required by the engine. The conversation should present those fields as a plain-language summary first, with raw identifiers only when useful for an advanced user or for copyable commands.

### Shared Language

Before producing the Blueprint, normalize the user's words into project language:

- responsibility unit names, independent of programming language or framework;
- domain terms that must appear in PRD acceptance criteria;
- public contract names and IO/schema names;
- forbidden ambiguous words that need replacement before launch;
- naming conventions visible in nearby source files.

The generated plan should be readable by a zero-context agent and by a human reviewer. Acceptance criteria must be concrete enough to verify from tests, generated contracts, AST/static checks, or equivalent evidence.

### Boundary Proposal

For broad requests, prefer vertical slice work items when one team can own the full slice from contract to verification. When a single owner would hide real team boundaries, fail fast with `HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS` and surface the engine's `suggestedBoundaries`.

When reporting `suggestedBoundaries`, show each proposed owner, allowed path set, contract ID, and verification command. Treat it as a review proposal, not automatic approval.

## Engine Bridge

When the plugin binary is available, start by running:

```bash
makeitreal-engine plan "$CLAUDE_PROJECT_DIR" --request "<canonical request>" --runner claude-code --verify '{"file":"npm","args":["test"]}'
```

Use `$ARGUMENTS` as the canonical request only when it is non-empty. If `$ARGUMENTS` is empty, collect the canonical request through `AskUserQuestion` first. Do not run the engine with an empty `--request`.

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
- If the request spans multiple domains, either split it into vertical slice work items with one owner each or ask for explicit boundaries. Do not collapse frontend/backend/data ownership into one generic module.
- Generated OpenAPI, schemas, AST checks, or equivalent contract evidence must be planned before launch.
- Run the internal Ready gate when artifacts exist and report any blocking codes.
- A plan may succeed with `planOk: true` while `implementationReady: false` when the only blocker is `HARNESS_BLUEPRINT_APPROVAL_PENDING`.
- Do not launch or implement until the user has reviewed and approved the Blueprint. Approval may arrive through LLM-classified conversational review or the explicit `/makeitreal:plan approve` fallback, but both must write `blueprint-review.json`.
- If the LLM review judge classifies the user's reply as approval plus launch intent, continue to `/makeitreal:launch` after the hook records the approval artifact.
- After approval, launch owns the `Contract Frozen -> Ready` promotion through the Ready gate; do not mutate board lanes manually.
- `/makeitreal:plan <request>` may be the first Make It Real command in a project. It creates `.makeitreal/runs/...`, records the current run, and writes the git ignore entry automatically.
