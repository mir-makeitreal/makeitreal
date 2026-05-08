# Make It Real Claude Code Plugin

This directory is the installable Claude Code plugin surface for Make It Real.
The engine lives in `dev-harness/`; this plugin exposes the product workflow and
keeps low-level engine commands internal.

## Exposed Skills

Normal slash-command workflow:

- `/makeitreal:plan <request>`
- `/makeitreal:launch`

For new work, `/makeitreal:plan <request>` is the first command. It creates the
run, selects it, writes project config if needed, and keeps `.makeitreal/`
ignored. `/makeitreal:setup` is optional and exists for config bootstrap without
planning yet, or selecting an existing run with `--run`.

For a Ralph-like entrypoint, `/makeitreal:launch <request>` may be used when no
run is active. It generates the Blueprint and stops at review; implementation
still waits for Blueprint approval.

Operator and advanced workflow:

- `/makeitreal:setup`
- `/makeitreal:status`
- `/makeitreal:verify`
- `/makeitreal:config`
- `/makeitreal:doctor`

The repository marketplace is named `52g`, so the canonical install ID is
`makeitreal@52g`. The companion `mir@52g` plugin provides the shorter `/mir:*`
slash-command namespace while reusing this plugin's engine and hooks.

Update an installed copy with `/plugin marketplace update 52g`, then
`/plugin update makeitreal@52g`, then `/reload-plugins`. If the alias is
installed, run `/plugin update mir@52g` as well.
Use `/plugin list` after reload; stale cache paths such as
`~/.claude/plugins/cache/52g/makeitreal/0.1.6/...` mean Claude Code has not
switched to the updated plugin yet.

The command files live under `commands/`. The `skills/` directory contains the
supporting workflow guidance that commands and Claude can use, but skills alone
do not make commands appear in the slash-command picker.

The plugin intentionally does not expose internal commands such as board claims,
orchestrator ticks, hook installation, wiki sync, or gate mutation as normal user
commands.

For the full architecture, including plugin/engine boundaries, hook lifecycle,
Kanban state, run-packet layout, and evidence model, see
[`../../docs/architecture.md`](../../docs/architecture.md).

## Runtime Contract

- Planning creates PRD, Blueprint/design pack, responsibility boundaries,
  contracts, Kanban work items, verification commands, trust policy, and the
  read-only dashboard.
- Plan and setup both ensure `/.makeitreal/` is present in the project
  `.gitignore` before runtime state is written. Setup is not a per-project
  prerequisite for new work.
- Blueprint approval is required before launch. The plan review question and
  later conversational replies are classified by the same LLM judge;
  `/makeitreal:plan approve` remains the explicit scriptable fallback.
- Launch runs through the internal engine using the `claude-code` runner trust
  policy for real Claude Code execution.
- The dashboard may auto-open and auto-refresh, but it remains read-only. State
  transitions stay in Claude Code conversation, hooks, and engine gates.
- Live wiki sync is configurable. Disabling it records explicit skip evidence
  instead of weakening the Done gate.
- Doctor is read-only diagnostics for plugin files, hooks, current-run state,
  dashboard preview, config, and the Claude Code CLI.

## Local Validation

From the repository root:

```bash
claude plugin validate plugins/makeitreal
claude plugin validate plugins/mir
claude plugin validate .claude-plugin/marketplace.json
```

Or use the packaged developer command:

```bash
npm run plugin:validate
```
