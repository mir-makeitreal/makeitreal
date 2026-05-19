# Troubleshooting

This guide covers the ten most common `HARNESS_*` error codes found in `src/**/*.mjs`.

Source note: the raw search pattern also matches non-error tokens such as the `HARNESS_RUN_DIR` environment variable and the `HARNESS_AGENT_` prefix check. Those are not error codes and are excluded from this list.

Use these placeholders in commands:

- `<projectRoot>`: your project directory.
- `<runDir>`: the active `.makeitreal/runs/<run-id>` directory.
- `<workItemId>`: a work item id from `board.json` or `work-items/*.json`.

## Error Codes

### HARNESS_DESIGN_PACK_INVALID

What it means: `design-pack.json` is missing required architecture sections or contains an invalid Design Pack shape.

When it occurs: Preview rendering, Ready gates, OpenAPI contract checks, and other commands that load the Design Pack validate required sections such as `architecture`, `stateFlow`, `apiSpecs`, `responsibilityBoundaries`, `moduleInterfaces`, `callStacks`, and `sequences`.

How to fix it: Prefer regenerating the run from the original request. If you intentionally edited artifacts, restore the missing section, make required arrays non-empty, and make every module interface declare `moduleName`, `publicSurfaces`, `contractIds`, and `signature.inputs/outputs/errors`.

Example command:

```bash
node bin/harness.mjs plan <projectRoot> --request "Add JWT authentication" --slug auth --allowed-path "src/**" --verify '{"file":"npm","args":["test"]}'
```

### HARNESS_BLUEPRINT_REVIEW_INVALID

What it means: `blueprint-review.json` is missing, malformed, has an invalid decision shape, or a Blueprint decision is being attempted from the wrong execution surface.

When it occurs: Blueprint approval, rejection, revision, fingerprint binding, or plan-time review seeding.

How to fix it: Do not hand-edit the review file unless you are repairing JSON syntax. Reapprove or reject through the engine so the review file gets the current run id, work item id, PRD id, fingerprint, reviewer, and timestamp.

Example command:

```bash
node bin/harness.mjs blueprint approve <runDir> --by "$USER" --note "Approved current Blueprint"
```

### HARNESS_OPENAPI_EXAMPLE_INVALID

What it means: An OpenAPI request or response example does not match its declared JSON schema.

When it occurs: `contracts openapi` validation checks enum and const values, object shape, required fields, additional properties, arrays, and primitive types for examples under `contracts/*.openapi.json`.

How to fix it: Edit the example or schema so they agree. If the example is the desired behavior, update the schema. If the schema is correct, remove undeclared fields, add required fields, and fix type mismatches in the example.

Example command:

```bash
node bin/harness.mjs contracts openapi <runDir>
```

### HARNESS_BLUEPRINT_AUDIT_UNLINKED

What it means: A board cannot be linked to the Blueprint run packet needed for approval audit.

When it occurs: Board status, claim, launch, or completion checks need `board.json` plus the linked `prd.json`, `design-pack.json`, `responsibility-units.json`, `blueprint-review.json`, and `work-items/` packet. It also occurs when `board.json.blueprintRunDir` is missing, points outside the policy root, or points to a directory without review evidence.

How to fix it: Run board commands against the actual run directory when the packet is co-located. If the current run pointer is missing, attach the existing run. If `board.json` was hand-edited or copied away from its packet, regenerate the plan or restore `blueprintRunDir` to a safe relative path.

Example command:

```bash
node bin/harness.mjs setup <projectRoot> --run <runDir>
```

### HARNESS_RUNNER_MODE_UNSUPPORTED

What it means: The requested runner mode is not supported for this command or does not match the run trust policy.

When it occurs: Planning, launch, and completion accept `scripted-simulator` and `claude-code`. The trust policy must match the runner used by orchestration.

How to fix it: Regenerate or use the run with the runner mode you intend to launch. Use `scripted-simulator` for fixture-style engine tests and `claude-code` for parent-session native Task orchestration.

Example command:

```bash
node bin/harness.mjs plan <projectRoot> --request "Add JWT authentication" --runner claude-code --allowed-path "src/**" --verify '{"file":"npm","args":["test"]}'
```

### HARNESS_WORK_ITEM_UNKNOWN

What it means: A command references a work item id that does not exist on the board.

When it occurs: Claim, native finish, completion, decomposition, or other board operations receive a stale or mistyped `--work <id>` value.

How to fix it: List the current board work and rerun the command with the exact id. Replanning can change generated ids, so do not reuse ids from an older run.

Example command:

```bash
node bin/harness.mjs board ready <runDir>
```

### HARNESS_VERIFICATION_FAILED

What it means: Verification did not prove the work item complete.

When it occurs: Status summaries and evidence checks use this as the general verification failure category when a verification command, evidence file, OpenAPI conformance check, module surface check, or Done gate fails.

How to fix it: Open the latest evidence under `<runDir>/evidence/`, rerun the exact failing command from the project root, fix the implementation or the verification plan, then rerun verification/completion.

Example command:

```bash
node bin/harness.mjs verify <runDir>
```

### HARNESS_VERIFICATION_COMMAND_INVALID

What it means: A verification command is not in the supported structured format.

When it occurs: `plan`, Ready gates, `verify`, and `orchestrator complete` normalize each command. The command must be an object with `file` or `command`, optional `args`, and optional string-valued `env`.

How to fix it: Replace shell-string commands with structured commands. Keep `args` as an array of strings and `env` as an object whose values are strings.

Example command:

```bash
node bin/harness.mjs plan <projectRoot> --request "Add JWT authentication" --verify '{"file":"npm","args":["test"],"env":{"CI":"1"}}'
```

### HARNESS_TRUST_POLICY_INVALID

What it means: `trust-policy.json` does not satisfy the safety contract for the selected runner.

When it occurs: Orchestrator start and completion validate fields such as `runnerMode`, `realAgentLaunch`, `commandExecution`, `userInputRequired`, and `unsupportedToolCall`.

How to fix it: Use a run generated for the correct runner mode. For `claude-code`, the policy must enable real agent launch and require `structured-command-only`; for `scripted-simulator`, real agent launch must stay disabled. If the policy was manually edited, regenerate the run instead of weakening safety fields.

Example command:

```bash
node bin/harness.mjs plan <projectRoot> --request "Add JWT authentication" --runner claude-code --allowed-path "src/**" --verify '{"file":"npm","args":["test"]}'
```

### HARNESS_DAG_INVALID

What it means: `work-item-dag.json` is not a valid work-item dependency graph.

When it occurs: Board readiness, claims, launch, and status validate that the DAG is an object with non-empty `nodes` and an `edges` array.

How to fix it: Regenerate the plan or repair `work-item-dag.json` so every node corresponds to a board work item and edges are represented in the supported array form. After repair, validate board readiness before launching.

Example command:

```bash
node bin/harness.mjs board ready <runDir>
```

## Common Issues

### "No active run" after plan command

This means `.makeitreal/current-run.json` was not written or you are running status from a different project root. A plan only updates the current run after the Blueprint packet and preview are generated and the Ready gate has no non-approval errors.

Fix it by checking the plan result first. If `currentRunUpdated` is false, resolve the reported plan errors and rerun the plan. If the run exists but the pointer is missing, attach it:

```bash
node bin/harness.mjs setup <projectRoot> --run <runDir>
node bin/harness.mjs status <projectRoot>
```

### Dashboard not opening

The dashboard open path can fail if the preview has not been rendered, dashboard auto-open is disabled, `MAKEITREAL_DASHBOARD_OPEN=disabled` is set, the live server cannot start, or the platform `open` command fails.

Render the preview, then force open or serve manually:

```bash
node bin/harness.mjs design render <runDir>
node bin/harness.mjs dashboard open <runDir> --force
node bin/harness.mjs dashboard serve <runDir>
```

### WebSocket disconnected

The React dashboard connects to the live dashboard server over `ws://<host>`. It will show disconnected when the page is opened from the static `file://` fallback, the server exits after idle timeout, the parent process exits, or the server cannot watch `<runDir>/preview`.

Serve the run and use the returned `http://127.0.0.1:<port>` URL:

```bash
node bin/harness.mjs dashboard serve <runDir>
```

### Blueprint approval stuck

Approval can stay blocked when the review is still pending, rejected, stale, drifted from the current run packet, or invalid JSON. The approval gate uses `blueprint-review.json` plus the current fingerprint of PRD, Design Pack, responsibility units, contracts, and work items.

If the Blueprint is correct, approve the current packet. If you edited generated artifacts after approval, reapprove the current fingerprint. If the review was rejected or drifted because the plan is wrong, regenerate the plan instead.

```bash
node bin/harness.mjs blueprint approve <runDir> --by "$USER" --note "Approved current Blueprint"
node bin/harness.mjs gate <runDir> --target Ready
```

### Sub-agent path boundary violation

This means a native sub-agent reported or produced changed files outside the work item's `allowedPaths`. The boundary is enforced from `work-items/<workItemId>.json` and `responsibility-units.json`.

Inspect the allowed paths, move or revert out-of-bound changes, then finish with only allowed changed files. If the task genuinely needs a wider boundary, replan instead of hiding the file in the report.

```bash
jq -r '.allowedPaths[]' <runDir>/work-items/<workItemId>.json
node bin/harness.mjs orchestrator native finish <runDir> --work <workItemId> --summary "Completed within boundary" --changed-file "src/example.mjs" --tested "npm test" --review spec-reviewer=APPROVED --review quality-reviewer=APPROVED --review verification-reviewer=APPROVED
```
