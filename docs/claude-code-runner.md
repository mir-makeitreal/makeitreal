# Claude Code Runner Contract

The Make It Real runtime supports two execution surfaces:

- parent-session native Task orchestration: the default interactive Claude Code path.
- child-process `claude --print`: a headless fallback for CI, scripted dogfood, or diagnostics.

It supports two runner modes:

- `scripted-simulator`: deterministic fixture runner for tests.
- `claude-code`: structured command runner for real Claude Code execution.

`claude-code` mode is disabled unless the board trust policy explicitly declares:

```json
{
  "runnerMode": "claude-code",
  "realAgentLaunch": "enabled",
  "commandExecution": "structured-command-only",
  "userInputRequired": "fail-fast",
  "unsupportedToolCall": "fail-fast"
}
```

For parent-session native Task orchestration, `/mir:launch` runs:

1. `orchestrator native start`: validates Ready gates, claims one ready work item, marks it `Running`, and returns implementation/reviewer prompts.
2. Claude Code native `Task`: performs the implementation in the visible parent session UI.
3. Claude Code native reviewer `Task`s: `spec-reviewer`, `quality-reviewer`, and `verification-reviewer`.
4. `orchestrator native finish`: records the implementation/review JSON evidence and moves successful work to `Verifying`.
5. `orchestrator complete`: runs verification from the project root and moves the item through `Human Review` to `Done` only when evidence is complete.

The child-process fallback creates a deterministic workspace under `workspaces/<workItemId>/` and writes:

- `.makeitreal/handoff.json`
- `.makeitreal/prompt.md`
- `.makeitreal/source/board.json`
- `.makeitreal/source/work-item.json`
- `.makeitreal/source/responsibility-units.json`
- `.makeitreal/source/prd.json` when present
- `.makeitreal/source/design-pack.json` when present

The fallback runner command must be a JSON object with `file` and `args`. It is executed with `shell: false`.
The `file` must be `claude`, and `args` are canonicalized to a conservative shape:

- `--print`
- `--output-format json`
- `--permission-mode dontAsk`
- `--allowedTools Read,Write,Edit,MultiEdit,Glob,Grep,LS,Task`
- `--agents ${agents}` for native Claude Code reviewer definitions
- `--add-dir ${workspace}`
- `--`
- exactly one prompt or handoff placeholder after `--`

Permission-bypass flags, duplicate scope flags, extra `--add-dir` values, unrestricted `Bash`, and unknown arguments are rejected. The `--` separator is required because Claude Code treats `--add-dir` as a variadic option; without the separator, the prompt can be consumed as another directory.

The runner must emit structured JSON or JSONL runtime output. `turn_completed` is the only success terminal event. Failure events such as `turn_input_required`, `unsupported_tool_call`, `turn_failed`, or malformed output are fail-fast and keep the work item out of `Verifying`.

After launch, the engine enforces two output boundaries:

- product files must stay inside the work item `allowedPaths`
- `.makeitreal/**` source and handoff metadata must remain byte-for-byte unchanged

Claude/OMC session logs under `.omc/sessions/**` are treated as runner metadata. Other `.omc/**` files still go through product boundary checks.

Completion uses the latest successful attempt provenance, not caller assertion, to select the runner trust policy. A work item cannot move from `Verifying` to `Done` without a recorded successful attempt with `turn_completed` and runner mode metadata.

Example fallback internal command:

```bash
node bin/harness.mjs orchestrator tick .makeitreal/board \
  --runner claude-code \
  --runner-command '{"file":"claude","args":["--print","--output-format","json","--permission-mode","dontAsk","--allowedTools","Read,Write,Edit,MultiEdit,Glob,Grep,LS,Task","--agents","${agents}","--add-dir","${workspace}","--","${prompt}"]}'
```

The public workflow remains `/makeitreal:launch`; this command is an internal engine surface.
