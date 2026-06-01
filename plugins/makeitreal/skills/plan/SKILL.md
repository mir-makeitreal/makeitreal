---
name: plan
description: Use when a feature request needs Make It Real PRD, architecture, responsibility boundaries, contracts, design-pack artifacts, or Kanban work decomposition before implementation.
---

# Make It Real Plan

Create a zero-context implementation packet before any code changes. The user-facing action is `/makeitreal:plan`.

**YOU (Claude Code) are the architect.** Read the project context, design a flat `BlueprintProposal`, and submit it through the MCP tool `mcp__make-it-real__mir_blueprint`. The MCP server validates the proposal, writes artifacts, seeds the launch board, and renders the dashboard preview.

## Workflow

1. **Read the project context.** Inspect the file tree, `package.json`, existing modules, naming conventions, and verification commands actually used in this repo. Do not invent file paths or assume libraries that are not visible in the project.
2. **Design the architecture as a flat `BlueprintProposal`.** Choose module names that match the repo's domain language, define owned paths that do not overlap, declare cross-module contracts, and break work into a small acyclic DAG of `workItems`.
3. **Call the MCP tool `mcp__make-it-real__mir_blueprint`** with the proposal as structured arguments. **NEVER output raw JSON to the user. ALWAYS submit through the MCP tool.** The tool input is the proposal object plus `projectRoot` (absolute path, normally `${CLAUDE_PROJECT_DIR}` or the current working directory) and `runSlug` (a short kebab-case identifier such as `feature-auth-system`).
4. **If the tool returns `ok: false`,** read each `errors[].code` and `errors[].reason`, fix only those specific issues in the proposal, and call the tool again. Do not start over; iterate.
5. **After success,** present the architecture summary to the user for review using the operator-facing report format below. The tool result contains `runDir`, `workItemCount`, and `previewUrl` — surface the preview URL so the user can open the dashboard.

## Subcommands

- `/makeitreal:plan` with no request starts interactive intake through Claude Code `AskUserQuestion`, then generates the Blueprint from the collected canonical request.
- `/makeitreal:plan <request>` generates the Blueprint for that request and seeds pending approval.
- Native Claude Code conversational review is the normal path: after the Blueprint is shown, the `UserPromptSubmit` hook injects the pending-review protocol, the current Claude Code session classifies the user's reply as `approved`, `rejected`, `revision_requested`, or `none`, and clear review decisions are recorded as `makeitreal:interactive-review:native-claude`.
- `/makeitreal:plan approve` is the explicit/scriptable control that approves the current Blueprint through the internal `blueprint approve` command.
- `/makeitreal:plan reject` is the explicit/scriptable control that rejects the current Blueprint through the internal `blueprint reject` command.

## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status. State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Prompt Discipline

### Conditional Grill

Ask a short clarification round only when the plan cannot honestly define ownership, contracts, or verification. Keep it to the missing decision: module ownership, allowed paths, public contract, or real verification command. If the missing piece can be inferred from existing project files, inspect those files first instead of interviewing the user.

When `/makeitreal:plan` is invoked without a request, clarification is not optional. Use `AskUserQuestion` to collect the missing feature request before calling the MCP tool. Continue with one focused `AskUserQuestion` at a time until the request is specific enough to name intended behavior, module boundary, contract/API/IO expectation, and verification expectation.

Do not invent placeholders to pass Ready. If no honest verification command exists, report the blocked Ready gate and the exact missing command shape.

### Dynamic Intake

Do not use a fixed question script. Treat request intake as an adaptive spec-refinement loop: read the current repo context, surface assumptions, derive the next question from the single most important ambiguity, then converge as soon as the Blueprint can be submitted to `mir_blueprint`.

Use `AskUserQuestion` as the HITL UI, not as a canned questionnaire. The next question should be generated from one of these missing facts:

- intended user-visible behavior and success criteria;
- which module owns the change and whether a new module is needed;
- cross-boundary contract, API, schema, or IO surface;
- allowed path scope and files that must not be touched;
- real verification evidence, including test/build/static/contract checks.

After each answer, restate only the updated assumption that affects the plan. If the answer creates a conflict with existing code or prior user direction, surface that conflict and ask the next `AskUserQuestion` about the conflict rather than silently choosing a side.

### Read-Only Parallel Reconnaissance

When the request is broad, cross-cutting, or likely to require repo discovery before a good question can be asked, use read-only `Task` subagents before asking the operator. Task subagents are for reconnaissance only during planning: they may inspect files, map ownership, find existing patterns, and report candidate boundaries, but they must not edit files or start implementation.

Use parallel reconnaissance only when it reduces uncertainty. Good split points are independent domains, such as current architecture, tests/verification commands, public API or IO contracts, and naming/path conventions. Synthesize subagent findings into one operator-facing summary before asking the next `AskUserQuestion`.

Do not outsource the actual planning decision to subagents. The leader owns the canonical request, Blueprint wording, and the final question shown to the operator.

### Operator-Facing Questions

Do not expose internal harness terms in `AskUserQuestion` prompts. Avoid raw terms such as board, orchestrator, owner, lane, claim, gate, run directory, work item, and module in user-facing choices. Translate them:

- say "Which part of the product/codebase should this change belong to?" instead of "which module owns this?";
- say "Should this be one end-to-end slice or split into separate work packages?" instead of "vertical slice vs separate modules?";
- say "What files or areas should be safe to change?" instead of "allowed paths / ownedPaths";
- say "How should we prove it works?" instead of "verification command".

### Operator-Facing Blueprint Report

After `mir_blueprint` returns `ok: true`, present the Blueprint as a reviewable development plan, not as an engine status dump. Do not lead with raw engine fields such as `runDir`, `runId`, fingerprint hashes, or owner ids. Use compact Markdown tables in the user's language:

- **What will be delivered** — intended outcome, concrete deliverables, project value, and acceptance evidence.
- **Scope boundaries** — what is in scope, what is intentionally out of scope, and what code areas are expected to change.
- **Modules** — each module, its purpose, owned paths, and contracts in plain project language.
- **Work packages** — each work item, the module it targets, dependencies, and verification command.
- **How we will prove it works** — test, contract, static analysis, or manual review expectations.
- **Review decisions** — only decisions the operator must approve, reject, or revise.
- **Dashboard and next action** — the `previewUrl` returned by the tool plus the conversational or explicit command path for approval, revision, or rejection.

Diagnostics are secondary. Only mention raw engine fields when the plan failed, the user asks for details, or the detail is necessary for a copyable command. Pending Blueprint approval is normal review state; say "Blueprint review is waiting for approval" rather than exposing `HARNESS_BLUEPRINT_APPROVAL_PENDING` as the headline.

### Review Decision UX

After the operator-facing Blueprint report, ask a final Claude Code `AskUserQuestion` review question. This question UI should make the normal choices obvious: approve and launch, request changes, or reject. Keep the wording in the user's language and allow free-form feedback for revisions.

All review paths must converge on the current Claude Code session as the review judge and the same `blueprint-review.json` authority:

- question UI answer: classify the full answer against the Blueprint report in the current Claude Code session, then call the internal `blueprint review --prompt <operator answer> --decision-json <native judgment>` command with that native judgment;
- later chat reply: rely on the `UserPromptSubmit` hook, which injects the reply, previous assistant message, and native review protocol back into the current Claude Code session;
- explicit slash command: keep `/makeitreal:plan approve` and `/makeitreal:plan reject` only as scriptable controls.

Do not branch on option labels, button text, keywords, or short replies such as "yes". The current Claude Code session owns the approval, rejection, revision-request, or no-op classification and records non-noop decisions through `blueprint review --prompt <operator answer> --decision-json <native judgment>`. Always include both `--prompt` and `--decision-json`; always include `decision` and `launchRequested`; include `confidence` and `reason` when available. If the question is dismissed, report that the operator can still answer naturally in chat; do not force `/makeitreal:plan approve`.

## Architecture: Claude Code Generates, MCP Tool Validates and Saves

The primary workflow is:

1. **You (Claude Code) read project context** — file tree, `package.json`, existing code, existing patterns.
2. **You design a flat `BlueprintProposal`** following the schema below.
3. **You call `mcp__make-it-real__mir_blueprint`** with the proposal as structured arguments.
4. **You present the Blueprint for review** using the operator-facing report format above.

### BlueprintProposal — Flat Schema (no cross-referenced IDs)

The proposal is a single flat object. Module names are the only identifiers. There are NO separate `responsibilityUnits`, no `contractId` strings, no `architecture.nodes`/`architecture.edges`.

Top-level shape:

```
{
  "title":              string,
  "summary":            string,
  "goals":              [string],
  "nonGoals":           [string],
  "acceptanceCriteria": [string],
  "assumptions":        [string],
  "modules":            [Module],
  "workItems":          [WorkItem],
  "scenarios":          [Scenario]    // optional sequence diagrams
}
```

`Module`:

```
{
  "name":       string,        // unique within the proposal — the only identifier
  "purpose":   string,
  "ownedPaths": [string],      // non-empty, glob patterns; must not overlap with other modules
  "dependsOn":  [string],      // other module names
  "contracts":  [Contract]     // public surface this module exposes
}
```

`Contract`:

```
{
  "name":    string,
  "type":    "http" | "function" | "event" | "component",
  "inputs":  [{ "name": string, "type": string, "required"?: boolean }],
  "outputs": [{ "name": string, "type": string }],
  "errors":  [{ "code": string, "when": string }]
}
```

`WorkItem`:

```
{
  "module":        string,                                     // must match a Module.name
  "title":         string,
  "dependsOn":     [string],                                   // module names this work waits on
  "verifyCommand": string,                                     // e.g. "npm test -- --grep auth"
  "complexity":    "trivial" | "small" | "medium" | "large"
}
```

`Scenario` (optional):

```
{
  "title": string,
  "steps": [{ "from": string, "to": string, "action": string }]
}
```

### Rules

- Module names are the only identifiers. No cross-referenced IDs of any kind.
- Module `ownedPaths` must not overlap across modules.
- Module `dependsOn` and WorkItem `dependsOn` must reference declared module names.
- The dependency DAG (modules + workItems) must be acyclic.
- Each contract must include `inputs`, `outputs`, and `errors` arrays.
- Each `WorkItem.module` must match exactly one declared module; at most one work item per module.
- For multi-module blueprints, include a work item with `module: "integration"` that depends on ALL other modules. This work item is responsible for creating the server entry point, mounting routers, and wiring all modules together. Without it, modules will be built but never connected. Declare the `integration` module like any other module (name, purpose, ownedPaths for the entry point, contracts, and a verify command).
- Do NOT invent file paths that don't exist unless the work item creates them.
- Do NOT assume frameworks or libraries not visible in the project.
- Mark uncertain decisions in the `assumptions` array.

### Calling the MCP Tool

Invoke the tool exactly once per attempt. Pass the proposal fields at the top level of the arguments object, plus `projectRoot` and `runSlug`:

Tool: `mcp__make-it-real__mir_blueprint`

Arguments shape:

```
{
  "projectRoot": "/absolute/path/to/project",
  "runSlug":     "feature-auth-system",
  "title":       "...",
  "summary":     "...",
  "goals":       [...],
  "nonGoals":    [...],
  "acceptanceCriteria": [...],
  "assumptions": [...],
  "modules":     [...],
  "workItems":   [...],
  "scenarios":   [...]
}
```

Successful response:

```
{ "ok": true, "runDir": "...", "workItemCount": N, "previewUrl": "file://.../preview/index.html" }
```

Error response:

```
{ "ok": false, "errors": [{ "code": "MODULE_NAMES_UNIQUE", "reason": "Duplicate module names: auth" }, ...], "warnings": [...] }
```

On error, fix the specific issue in the proposal and call the tool again. Do not retry with the same proposal.

### Complete Example (2-module system)

A reviewable proposal for adding email-link login:

```json
{
  "projectRoot": "/Users/dev/project",
  "runSlug": "feature-email-login",
  "title": "Email-link login",
  "summary": "Users sign in by clicking a one-time link emailed to them; the API issues a session cookie on click.",
  "goals": [
    "Users can sign in without a password",
    "Single-use login links expire after 10 minutes"
  ],
  "nonGoals": [
    "OAuth / social login",
    "Account recovery flows"
  ],
  "acceptanceCriteria": [
    "POST /auth/request-link with a known email queues an email and returns 202",
    "GET /auth/callback?token=<one-time> sets a session cookie and returns 200",
    "A token used twice returns 410 Gone"
  ],
  "assumptions": [
    "Mail delivery uses the existing src/mail/transport.mjs sender",
    "Session cookies are signed with the existing src/auth/session.mjs key"
  ],
  "modules": [
    {
      "name": "auth-link",
      "purpose": "Mint, store, and validate one-time login tokens.",
      "ownedPaths": ["src/auth/link/**", "test/auth/link/**"],
      "dependsOn": [],
      "contracts": [
        {
          "name": "createLoginLink",
          "type": "function",
          "inputs":  [{ "name": "email", "type": "string", "required": true }],
          "outputs": [{ "name": "token", "type": "string" }],
          "errors":  [{ "code": "UNKNOWN_EMAIL", "when": "no user matches the email" }]
        },
        {
          "name": "consumeLoginLink",
          "type": "function",
          "inputs":  [{ "name": "token", "type": "string", "required": true }],
          "outputs": [{ "name": "userId", "type": "string" }],
          "errors":  [
            { "code": "TOKEN_EXPIRED",   "when": "token older than 10 minutes" },
            { "code": "TOKEN_CONSUMED",  "when": "token already used once" }
          ]
        }
      ]
    },
    {
      "name": "auth-http",
      "purpose": "Expose the email-link login flow over HTTP and set the session cookie.",
      "ownedPaths": ["src/auth/http/**", "test/auth/http/**"],
      "dependsOn": ["auth-link"],
      "contracts": [
        {
          "name": "POST /auth/request-link",
          "type": "http",
          "inputs":  [{ "name": "email", "type": "string", "required": true }],
          "outputs": [{ "name": "status", "type": "number" }],
          "errors":  [{ "code": "RATE_LIMITED", "when": "more than 5 requests per minute per email" }]
        },
        {
          "name": "GET /auth/callback",
          "type": "http",
          "inputs":  [{ "name": "token", "type": "string", "required": true }],
          "outputs": [{ "name": "setCookie", "type": "string" }],
          "errors":  [{ "code": "TOKEN_INVALID", "when": "consumeLoginLink rejected the token" }]
        }
      ]
    }
  ],
  "workItems": [
    {
      "module": "auth-link",
      "title": "Implement createLoginLink/consumeLoginLink with 10-minute expiry and single-use semantics",
      "dependsOn": [],
      "verifyCommand": "npm test -- --grep auth/link",
      "complexity": "medium"
    },
    {
      "module": "auth-http",
      "title": "Wire POST /auth/request-link and GET /auth/callback to the auth-link module and set the session cookie",
      "dependsOn": ["auth-link"],
      "verifyCommand": "npm test -- --grep auth/http",
      "complexity": "medium"
    }
  ],
  "scenarios": [
    {
      "title": "User signs in via email link",
      "steps": [
        { "from": "Browser",   "to": "auth-http",  "action": "POST /auth/request-link { email }" },
        { "from": "auth-http", "to": "auth-link", "action": "createLoginLink(email) -> token" },
        { "from": "auth-http", "to": "Browser",    "action": "202 Accepted (link emailed)" },
        { "from": "Browser",   "to": "auth-http",  "action": "GET /auth/callback?token=..." },
        { "from": "auth-http", "to": "auth-link", "action": "consumeLoginLink(token) -> userId" },
        { "from": "auth-http", "to": "Browser",    "action": "200 OK + Set-Cookie: session=..." }
      ]
    }
  ]
}
```

## Required Artifacts (produced by the MCP tool)

When `mir_blueprint` returns `ok: true`, the engine has written:

- PRD with goals, non-goals, acceptance criteria, and user-visible behavior.
- Design pack covering modules, contracts, and scenarios.
- Module-level responsibility boundaries with non-overlapping `ownedPaths`.
- Kanban work items with dependencies and verification commands.
- Launch board, trust policy, and runtime state seed so the approved plan can be launched.
- A rendered preview at `previewUrl`.

## Rules

- Do not implement during planning.
- Do not assume language-specific module boundaries unless the project requires them.
- Cross-module work must communicate through declared contracts.
- If the request spans multiple domains, split it into modules with one work item each; do not collapse frontend/backend/data ownership into one module.
- A reviewable plan can be waiting for Blueprint approval without being an implementation failure. Treat pending approval as normal review state.
- Do not launch or implement until the user has reviewed and approved the Blueprint. Approval may arrive through Native Claude Code conversational review or the explicit `/makeitreal:plan approve` control, but both must write `blueprint-review.json`.
- If the current Claude Code session classifies the user's reply as approval plus launch intent, first record the decision with `blueprint review --decision-json` using `launchRequested:true`, then execute the launch skill's native Task sequence in the same session. Do not ask the operator to type `/makeitreal:launch`.
- After approval, launch owns the `Contract Frozen -> Ready` promotion through the Ready gate; do not mutate board lanes manually.
- `/makeitreal:plan <request>` may be the first Make It Real command in a project. Submitting through `mir_blueprint` creates `.makeitreal/runs/<runSlug>/`, records the current run, and writes artifacts under that run directory.
