# Command Reference

Complete CLI reference for the Make It Real harness (`bin/harness.mjs`). All commands are invoked as:

```bash
node bin/harness.mjs <command> [args...] [flags...]
```

Every command prints a single JSON object to stdout and exits with `0` on success or `1` on failure. Add `--pretty` anywhere in the argument list to indent JSON for TTY readers (piped output stays compact).

Global flags:

| Flag | Description |
| --- | --- |
| `--help` | Print built-in usage from `printHelp()` and exit `0`. |
| `--version`, `-v`, `version` | Print `{ command: "version", version: <pkg.version> }`. |
| `--pretty` | Indent JSON when stdout is a TTY (no effect when piped). |
| `--now <ISO>` | Inject deterministic timestamps (also reads `MAKEITREAL_NOW` env). |

Project root resolution: any command that takes `<projectRoot>` falls back to `$CLAUDE_PROJECT_DIR` then `process.cwd()` when the positional argument is omitted.

---

## Planning

Commands that build a Make It Real run directory (PRD, blueprint, contracts, kanban board).

### `plan <projectRoot>`

Generate PRD, design pack, contracts, and kanban work-items for a new run.

**Syntax**
```bash
node bin/harness.mjs plan <projectRoot> --request <text> [flags...]
```

**Required flag**
- `--request <text>` — Work request the run is built from.

**Optional flags**
- `--slug <id>` (alias `--run <id>`) — Stable run id / directory name.
- `--owner <team>` — Responsibility owner. Default `team.implementation`.
- `--allowed-path <pattern>` — Repeatable ownership boundary pattern.
- `--api openapi|rest|none` — API contract mode; `rest` maps to `openapi`.
- `--verify <json>` — Repeatable verification command, JSON shape `{"file":"npm","args":["test"]}` (`{"command":"npm","args":["test"]}` is an accepted alias).
- `--runner scripted-simulator|claude-code` — Runner mode. Default `scripted-simulator`.

**Example**
```bash
node bin/harness.mjs plan . \
  --request "Add health-check endpoint" \
  --slug feature-healthcheck \
  --owner team.api \
  --allowed-path "src/api/**" \
  --api openapi \
  --verify '{"file":"npm","args":["test"]}' \
  --runner claude-code
```

**Example output**
```json
{
  "ok": true,
  "command": "plan",
  "runDir": "/path/to/.makeitreal/runs/feature-healthcheck",
  "workItemCount": 3,
  "errors": []
}
```

### `demo [template]`

Generate a ready-to-run demo blueprint into a `/tmp/makeitreal-demo-*` directory. Templates: `todo-app`, `rest-api` (default), `auth-system`.

**Syntax**
```bash
node bin/harness.mjs demo [template] [--project-root <dir>]
```

**Optional flags**
- Positional `template` — Template name; falls back to `--template`, then `rest-api`.
- `--template <name>` — Alternate flag form for template selection.
- `--project-root <dir>` — Override the generated run's project root.

**Example**
```bash
node bin/harness.mjs demo rest-api --pretty
```

**Example output (with `--pretty`)**
```json
{
  "ok": true,
  "command": "demo",
  "template": "rest-api",
  "complexity": "medium",
  "runDir": "/tmp/makeitreal-demo-rest-api-...",
  "workItemCount": 4,
  "workItemId": null,
  "errors": []
}
Blueprint generated!
  Template: rest-api (medium)
  Work items: 4
  Run dir: /tmp/makeitreal-demo-rest-api-...
  Next: node bin/harness.mjs blueprint approve /tmp/makeitreal-demo-rest-api-...
```

### `demo list`

List installed demo templates without writing files.

```bash
node bin/harness.mjs demo list
```

```json
{
  "ok": true,
  "command": "demo list",
  "templates": [
    { "name": "todo-app", "complexity": "small", "description": "..." },
    { "name": "rest-api", "complexity": "medium", "description": "..." },
    { "name": "auth-system", "complexity": "large", "description": "..." }
  ],
  "errors": []
}
```

### `demo clean`

Remove all `/tmp/makeitreal-demo-*` directories from prior demo runs.

```bash
node bin/harness.mjs demo clean
```

### `design render <runDir>`

Render the PRD/blueprint architecture preview HTML for the dashboard.

```bash
node bin/harness.mjs design render .makeitreal/runs/<run>
```

### `contracts openapi <runDir>`

Validate OpenAPI contracts in a run directory against an optional baseline.

**Flags**
- `--baseline <dir>` — Compare against a baseline contracts directory.

```bash
node bin/harness.mjs contracts openapi .makeitreal/runs/<run> --baseline ./baseline
```

```json
{ "ok": true, "command": "contracts openapi", "errors": [] }
```

### `blueprint approve <runDir>` / `blueprint reject <runDir>`

Record a Blueprint review decision against an existing run.

**Flags**
- `--by <name>` — Reviewer attribution.
- `--note <text>` — Decision note recorded in evidence.

```bash
node bin/harness.mjs blueprint approve .makeitreal/runs/<run> --by alice --note "Looks good"
node bin/harness.mjs blueprint reject  .makeitreal/runs/<run> --by alice --note "Need API contract"
```

### `blueprint review <runDir>`

Record a **native Claude Code** Blueprint review decision. Used from inside the Claude Code session — do not spawn a separate `claude` process to judge.

**Required flag**
- `--decision-json <json>` — JSON shape:
  ```json
  {"decision":"approved","launchRequested":true,"confidence":"high","reason":"..."}
  ```
  Valid `decision` values: `approved`, `rejected`, `revision_requested`.

**Optional flags**
- `--session <id>` — Session id (defaults to `question-ui`).
- `--project-root <dir>` — Override project root.
- `--run <runDir>` — Alternate runDir source.
- `--prompt <text>` — Original operator answer (echoed to evidence).

```bash
node bin/harness.mjs blueprint review .makeitreal/runs/<run> \
  --decision-json '{"decision":"approved","launchRequested":true,"confidence":"high","reason":"approved by reviewer"}' \
  --session abc123
```

```json
{
  "ok": true,
  "command": "blueprint review",
  "action": "approved",
  "runDir": "/path/to/run",
  "reviewPath": "/path/to/run/evidence/blueprint-review.json",
  "launchRequested": true,
  "reviewedBy": "claude-code:native",
  "judge": "claude-code:native",
  "additionalContext": null,
  "errors": []
}
```

---

## Execution

Commands that drive a run forward — gates, verification, orchestrator, board claims.

### `gate <runDir> --target <lane>`

Evaluate gate rules for entering a lane (Ready or Done).

```bash
node bin/harness.mjs gate .makeitreal/runs/<run> --target Done
```

### `verify <runDir>`

Run the run's declared verification commands and refresh the dashboard preview.

```bash
node bin/harness.mjs verify .makeitreal/runs/<run>
```

```json
{
  "ok": true,
  "command": "verify",
  "results": [{ "file": "npm", "args": ["test"], "exitCode": 0 }],
  "dashboardRefresh": { "refreshed": true },
  "errors": []
}
```

### `wiki sync <runDir>`

Sync verified work-items into the live project wiki.

```bash
node bin/harness.mjs wiki sync .makeitreal/runs/<run>
```

### `board ready <boardDir>`

List work-item ids whose dependencies are satisfied.

```bash
node bin/harness.mjs board ready .makeitreal/runs/<run>/board
```

```json
{
  "ok": true,
  "command": "board ready",
  "workItemIds": ["WI-001", "WI-003"]
}
```

### `board claim <boardDir> --work <id> [--worker <id>]`

Claim a work-item for a worker (60 s lease).

**Flags**
- `--work <workItemId>` — Required.
- `--worker <workerId>` — Worker identifier. Default `worker.local`.

```bash
node bin/harness.mjs board claim .makeitreal/runs/<run>/board --work WI-001 --worker worker.alice
```

### `board mailbox send <boardDir>`

Send a worker-to-worker message into the board mailbox.

**Flags**
- `--from <workerId>` — Sender. Default `worker.local`.
- `--to <workerId>` — Receiver. Default `worker.local`.
- `--work <workItemId>` — Associated work-item.
- `--message <text>` — Message body.

```bash
node bin/harness.mjs board mailbox send .makeitreal/runs/<run>/board \
  --from worker.alice --to worker.bob --work WI-001 --message "Handoff complete"
```

### `orchestrator tick <boardDir>`

Dispatch scripted work attempts (used by the `scripted-simulator` runner).

**Flags**
- `--worker <id>` — Default `worker.local`.
- `--concurrency <N>` — Default `1`.
- `--runner scripted-simulator|claude-code` — Default `scripted-simulator`.

```bash
node bin/harness.mjs orchestrator tick .makeitreal/runs/<run>/board --concurrency 2
```

### `orchestrator native start <boardDir>`

Prepare parent-session Claude Code Task handoffs for native execution.

**Flags**
- `--worker <id>` — Default `claude-code.parent`.
- `--concurrency <N>` — Default `1`.

```bash
node bin/harness.mjs orchestrator native start .makeitreal/runs/<run>/board --concurrency 2
```

### `orchestrator native finish <boardDir>`

Record a parent-session Task result for a work-item.

**Input sources** (first match wins):
1. `--result-json <json>` — Inline JSON payload.
2. `--result-stdin` — Read full JSON from stdin.
3. Shorthand flags below — Synthesize a `makeitrealReport`.

**Shorthand flags**
- `--work <workItemId>` — Required to identify the attempt.
- `--attempt <attemptId>`
- `--worker <workerId>` — Default `claude-code.parent`.
- `--summary <text>` — Implementation summary.
- `--changed-file <path>` — Repeatable.
- `--tested <note>` — Repeatable verification note.
- `--concern <text>` — Repeatable; promotes status to `DONE_WITH_CONCERNS`.
- `--needs-context <text>` — Repeatable; promotes status to `NEEDS_CONTEXT`.
- `--blocker <text>` — Repeatable; promotes status to `BLOCKED`.
- `--status <text>` — Explicit status override.
- `--review role=STATUS[:summary]` — Repeatable reviewer result (spec/quality/verification reviewers).

```bash
node bin/harness.mjs orchestrator native finish .makeitreal/runs/<run>/board \
  --work WI-001 --attempt A1 \
  --summary "Added handler" \
  --changed-file src/api/health.ts \
  --tested "npm test" \
  --review quality=APPROVED:"LGTM"
```

### `orchestrator complete <boardDir>`

Move a verified work-item to Done.

**Flags**
- `--work <workItemId>` — Required.
- `--runner scripted-simulator|claude-code` — Runner mode used to verify.

```bash
node bin/harness.mjs orchestrator complete .makeitreal/runs/<run>/board --work WI-001 --runner claude-code
```

### `orchestrator reconcile <boardDir>`

Reconcile expired claims and re-mark retry-ready work.

```bash
node bin/harness.mjs orchestrator reconcile .makeitreal/runs/<run>/board
```

---

## Monitoring

Read-only commands for inspecting run state.

### `status [projectRoot]`

Show the active Make It Real run state. Always exits `0` when the project has no active run; refreshes the dashboard preview when a run is found.

**Flags**
- `--run <runDir>` — Inspect a specific run instead of the active one.

```bash
node bin/harness.mjs status .
node bin/harness.mjs status . --run .makeitreal/runs/<run> --pretty
```

```json
{
  "ok": true,
  "command": "status",
  "runDir": "/path/to/run",
  "phase": "execution",
  "workItems": { "ready": 2, "inProgress": 1, "done": 4 },
  "dashboardRefresh": { "refreshed": true },
  "errors": []
}
```

### `board status <boardDir>`

Lane counts for a board directory.

```bash
node bin/harness.mjs board status .makeitreal/runs/<run>/board
```

```json
{
  "ok": true,
  "command": "board status",
  "lanes": { "Backlog": 0, "Ready": 2, "InProgress": 1, "Done": 4 },
  "errors": []
}
```

### `doctor [projectRoot]`

Diagnose plugin install, hook wiring, project config, dashboard, and Claude CLI. Always exits `0` so callers can inspect findings.

**Flags / positional**
- `<projectRoot>` — Optional positional.
- `--run <runDir>` — Optional positional or flag; targets a specific run.

```bash
node bin/harness.mjs doctor . --pretty
node bin/harness.mjs doctor . --run .makeitreal/runs/<run>
```

### `dashboard serve <runDir>`

Start the live Kanban dashboard HTTP + WebSocket server on an ephemeral port. Writes a `.port` file so other tools can discover the URL.

```bash
node bin/harness.mjs dashboard serve .makeitreal/runs/<run>
```

```json
{
  "ok": true,
  "command": "dashboard serve",
  "url": "http://127.0.0.1:54321",
  "port": 54321,
  "runDir": "/path/to/run",
  "portFilePath": "/path/to/run/.dashboard-port",
  "errors": []
}
```

### `dashboard open <runDir>`

Auto-start the dashboard (if needed) and open the URL in the default browser.

**Flags**
- `--project-root <dir>` — Override project root.
- `--dry-run` — Compute the URL but do not open the browser.
- `--force` — Always (re)start the server even if one is running.

```bash
node bin/harness.mjs dashboard open .makeitreal/runs/<run>
node bin/harness.mjs dashboard open .makeitreal/runs/<run> --dry-run
```

---

## Configuration

Project bootstrap, hook installation, and `.makeitreal.json` updates.

### `setup [projectRoot]`

Initialize Make It Real state for a project. Optionally bind an existing run.

**Flags**
- `--run <runDir>` — Record this run as the active run after setup.

```bash
node bin/harness.mjs setup .
node bin/harness.mjs setup . --run .makeitreal/runs/<run>
```

### `config get [projectRoot]`

Show the project's Make It Real config.

```bash
node bin/harness.mjs config get . --pretty
```

```json
{
  "ok": true,
  "command": "config get",
  "config": {
    "profile": "default",
    "liveWiki": { "enabled": true },
    "dashboard": {
      "autoOpen": true,
      "refreshOnStatus": true,
      "refreshOnLaunch": true,
      "refreshOnVerify": true
    }
  },
  "errors": []
}
```

### `config set [projectRoot]`

Update project config. Requires at least one of the flags below; values accept `enabled|enable|on|true|yes` or `disabled|disable|off|false|no`.

**Flags**
- `--profile default|quiet` — Switch operator profile.
- `--live-wiki enabled|disabled` — Toggle live-wiki sync.
- `--dashboard-auto-open enabled|disabled` — Toggle browser auto-open.
- `--dashboard-refresh-on-status enabled|disabled`
- `--dashboard-refresh-on-launch enabled|disabled`
- `--dashboard-refresh-on-verify enabled|disabled`

```bash
node bin/harness.mjs config set . --profile quiet --live-wiki disabled
node bin/harness.mjs config set . --dashboard-refresh-on-verify enabled
```

### `hooks install <projectRoot> --run <runDir>`

Install Claude Code hook entries (`.claude/settings*.json`) for a run.

**Flags**
- `--run <runDir>` — Required.
- `--scope local|user|project` — Settings file scope. Default `local`.

```bash
node bin/harness.mjs hooks install . --run .makeitreal/runs/<run> --scope local
```

### `hooks status <projectRoot> --run <runDir>`

Report whether the run's hooks are installed in the chosen scope.

**Flags**
- `--run <runDir>` — Required.
- `--scope local|user|project` — Default `local`.

```bash
node bin/harness.mjs hooks status . --run .makeitreal/runs/<run>
```

---

## Error envelope

Every failure surfaces an `errors` array of structured records:

```json
{
  "ok": false,
  "command": "plan",
  "errors": [
    {
      "code": "HARNESS_PLAN_REQUEST_REQUIRED",
      "reason": "plan requires --request <text>.",
      "contractId": null,
      "ownerModule": null,
      "evidence": ["argv"],
      "recoverable": true
    }
  ]
}
```

Common error codes:

| Code | Meaning |
| --- | --- |
| `HARNESS_COMMAND_UNKNOWN` | First positional argument did not match any handler. |
| `HARNESS_PLAN_REQUEST_REQUIRED` | `plan` invoked without `--request`. |
| `HARNESS_VERIFICATION_COMMAND_INVALID` | `--verify` JSON failed to parse / normalize. |
| `HARNESS_CONFIG_FLAG_REQUIRED` | `config set` invoked without any supported flag. |
| `HARNESS_CONFIG_VALUE_INVALID` | A toggle flag received a non-boolean value. |
| `HARNESS_RUN_DIR_REQUIRED` | Command needs `<runDir>` (or `--run`). |
| `HARNESS_WORK_ID_REQUIRED` | Command needs `--work <workItemId>`. |
| `HARNESS_NATIVE_REVIEW_DECISION_REQUIRED` | `blueprint review` called without `--decision-json`. |
| `HARNESS_BLUEPRINT_REVIEW_UNDECIDED` | Native review decision was not classified into approve/reject/revise. |
| `HARNESS_UNCAUGHT_ERROR` | Unhandled exception escaped to the top-level wrapper. |
