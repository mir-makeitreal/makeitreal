# Make It Real Claude Code Plugin

This directory is the installable Claude Code plugin surface for Make It Real.
The engine lives in `dev-harness/`; this plugin exposes the product workflow and
keeps low-level engine commands internal.

## Exposed Skills

Normal slash-command workflow:

- `/makeitreal:setup`
- `/makeitreal:plan <request>`
- `/makeitreal:launch`

Operator and advanced workflow:

- `/makeitreal:status`
- `/makeitreal:verify`
- `/makeitreal:config`

The command files live under `commands/`. The `skills/` directory contains the
supporting workflow guidance that commands and Claude can use, but skills alone
do not make commands appear in the slash-command picker.

The plugin intentionally does not expose internal commands such as board claims,
orchestrator ticks, hook installation, wiki sync, or gate mutation as normal user
commands.

## Runtime Contract

- Planning creates PRD, Blueprint/design pack, responsibility boundaries,
  contracts, Kanban work items, verification commands, trust policy, and the
  read-only dashboard.
- Blueprint approval is required before launch. Conversational approval is
  classified by an LLM judge; `/makeitreal:plan approve` remains the explicit
  scriptable fallback.
- Launch runs through the internal engine using the `claude-code` runner trust
  policy for real Claude Code execution.
- The dashboard may auto-open and auto-refresh, but it remains read-only. State
  transitions stay in Claude Code conversation, hooks, and engine gates.
- Live wiki sync is configurable. Disabling it records explicit skip evidence
  instead of weakening the Done gate.

## Local Validation

From the repository root:

```bash
claude plugin validate plugins/makeitreal
claude plugin validate .claude-plugin/marketplace.json
```

Or use the packaged developer command:

```bash
npm run plugin:validate
```
