# Make It Real Plugin

Make It Real is a Claude Code plugin that turns a feature request into a verified implementation through a gated plan → blueprint → launch → verify pipeline. Architecture is written as a structured Blueprint, validated and materialized into a Kanban board of work items, then dispatched to native Claude `Task` subagents under path-scoped and verification gates. The plugin exposes two MCP tools that Claude calls directly and three hooks that enforce the gates.

## MCP Server

The plugin ships its own MCP server (`mcp-server/index.mjs`) that exposes the `mir_blueprint` and `mir_launch` tools. The server is declared in the plugin's `.mcp.json`:

```json
{
  "mcpServers": {
    "make-it-real": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/index.mjs"]
    }
  }
}
```

Claude Code reads this `.mcp.json` and **auto-starts the server** when the plugin is installed — there is no separate start command. Once running, Claude calls the `mir_blueprint` and `mir_launch` tools directly; the `/mir:*` and `/makeitreal:*` slash commands drive the same tools. The MCP server wraps the internal engine so that gates, board state, orchestration, verification, and wiki sync are never invoked as user-facing Bash commands.

## MCP Tools

### `mir_blueprint`

Validates a Claude-generated architecture proposal and writes it to disk.

Input schema (key fields):

- `projectRoot` (string, required) — absolute project path
- `runSlug` (string, required) — run identifier (e.g. `auth-system`)
- Blueprint proposal fields from `getBlueprintSchema()` — modules, work items, work item DAG, contracts, verification commands, trust policy

Actions: normalizes the proposal, writes blueprint artifacts under `.makeitreal/runs/<runSlug>/`, materializes the launch board, seeds the blueprint review record, and renders the design preview. Returns `runDir`, `workItemCount`, `previewUrl`, and a `nextStep` pointing the LLM toward approval.

### `mir_launch`

Drives the gated implementation loop. One tool, four actions.

Input schema:

- `projectRoot` (string, required)
- `runSlug` (string, required)
- `action` (enum, required) — one of `status`, `start`, `finish`, `complete`
- `workItemId` (string) — required for `finish` and `complete`
- `attemptId` (string) — required for `finish`
- `result` (object) — required for `finish`; the `{ makeitrealReport: { status, ... } }` envelope returned by the Task subagent
- `concurrency` (number) — optional, defaults to 1 for `start`

Actions:

- `status` — returns phase, launchable work items, lane counts, blockers, blueprint approval state, and Ready-gate result
- `start` — promotes work items to Doing and returns `nativeTasks[]` with prompts, allowed paths, and reviewer prompts for the parent to dispatch as native Claude `Task` calls
- `finish` — records an attempt result from a Task subagent and triggers any work item decomposition
- `complete` — runs the Done gate (verification commands, wiki sync, evidence) and moves the item to Done

Successful responses include a `nextStep` string that tells the calling LLM exactly which action to call next.

## Hooks

- **PreToolUse** (`hooks/claude/pre-tool-use.mjs`) — path enforcement. Blocks Write/Edit calls from Task subagents that target paths outside the work item's `allowedPaths`.
- **Stop** (`hooks/claude/stop.mjs`) — completion gate. Prevents Claude from ending a turn while a run is mid-implementation with launchable or in-flight work remaining.
- **UserPromptSubmit** (`hooks/claude/user-prompt-submit.mjs`) — context injection. Surfaces pending Blueprint review state and current run context into the conversation.

## Quickstart

1. Install the plugin: `/plugin install makeitreal@52g`
2. Plan: `/mir:plan <feature request>` — generates PRD, Blueprint, contracts, and Kanban work items
3. Approve: `/makeitreal:plan approve` (or approve conversationally; the review hook classifies intent)
4. Launch: `/mir:launch` — Claude calls `mir_launch` through the gated loop until all work items reach Done
5. Done: evidence and live wiki are written under `.makeitreal/runs/<runSlug>/`

The companion `/makeitreal:*` namespace exposes the same workflow with longer slash names. See `../../docs/architecture.md` for the full plugin/engine boundary, run-packet layout, and evidence model.
