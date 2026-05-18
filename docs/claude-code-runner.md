# Claude Code Native Runner Contract

Make It Real launches real Claude Code work through the parent session's native
`Task` subagent flow. It does not spawn `claude --print` or run a second Claude
Code process.

## Execution Surfaces

- `scripted-simulator`: deterministic fixture runner for engine tests only.
- `claude-code`: parent-session native Task orchestration for real work.

`claude-code` mode is enabled only when the board trust policy declares:

```json
{
  "runnerMode": "claude-code",
  "realAgentLaunch": "enabled",
  "commandExecution": "structured-command-only",
  "userInputRequired": "fail-fast",
  "unsupportedToolCall": "fail-fast"
}
```

## Native Launch Flow

`/mir:launch` and `/makeitreal:launch` run this internal sequence:

1. `orchestrator native start` validates Ready gates, claims every unblocked
   ready work item up to the requested concurrency, marks each one `Running`,
   and returns a canonical `nativeTasks[]` batch.
2. Each `nativeTasks[]` entry carries `workItemId`, `nodeKind`, allowed paths,
   contract IDs, the node-specific prompt, and the reviewer prompts required
   for that node kind.
3. Claude Code native `Task` runs each returned work item in the visible parent
   session UI. Implementation nodes may edit only declared paths; domain PM
   nodes review the child split without code edits; integration evidence nodes
   verify cross-boundary behavior after implementation nodes are Done.
4. Claude Code native reviewer `Task`s run exactly the reviewer prompts returned
   by the engine: implementation nodes need `spec-reviewer`, `quality-reviewer`,
   and `verification-reviewer`; domain PM nodes need `spec-reviewer`; integration
   evidence nodes need `verification-reviewer`.
5. `orchestrator native finish` records the node report and review JSON evidence
   and moves successful work to `Verifying`.
6. `orchestrator complete` runs verification from the project root and moves the
   work item through `Human Review` to `Done` only when evidence is complete.

Completion accepts `claude-code` attempts only when the latest successful
attempt has `runner.channel: "parent-native-task"` and approved reviewer
evidence for the node kind's required reviewer roles.

If hook-visible run scope cannot be carried into native Task tool calls, launch
fails before mutation. The required scope is the run directory, work item ID,
project root, allowed paths, and declared contract IDs. A Task without that
scope is not a Make It Real worker.

Native implementation Tasks edit the project root. `.makeitreal/runs/*/workspaces/*`
is scripted-simulator state only and must not receive native implementation
edits.

If Claude Code native `Task` is unavailable, launch must stop and report that
Make It Real requires native subagents. It must not fall back to a child Claude
CLI process.
