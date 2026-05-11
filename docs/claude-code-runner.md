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

1. `orchestrator native start` validates Ready gates, claims one ready work
   item, marks it `Running`, and returns scoped implementation/reviewer prompts.
2. Claude Code native `Task` implements the work item in the visible parent
   session UI.
3. Claude Code native reviewer `Task`s run as `spec-reviewer`,
   `quality-reviewer`, and `verification-reviewer`.
4. `orchestrator native finish` records the implementation and review JSON
   evidence and moves successful work to `Verifying`.
5. `orchestrator complete` runs verification from the project root and moves the
   work item through `Human Review` to `Done` only when evidence is complete.

Completion accepts `claude-code` attempts only when the latest successful
attempt has `runner.channel: "parent-native-task"` and approved reviewer
evidence for all three reviewer roles.

If Claude Code native `Task` is unavailable, launch must stop and report that
Make It Real requires native subagents. It must not fall back to a child Claude
CLI process.
