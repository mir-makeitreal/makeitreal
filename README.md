# Make It Real

Make It Real is a Claude Code plugin and local engineering harness for PRD-first,
contract-gated software work.

It turns a feature request into a reviewable Blueprint, a read-only Kanban
dashboard, module-level IO signatures, responsibility-owned work items,
declared boundary contracts, real Claude Code execution, verification evidence,
and a Done gate that cannot be passed by assertion alone.

## Install

Install once at user scope; the plugin is then available in any Claude Code
project. The `@52g` suffix is the marketplace name from
`.claude-plugin/marketplace.json`.

From Claude Code:

```text
/plugin marketplace add mir-makeitreal/makeitreal
/plugin install makeitreal@52g
/reload-plugins
```

For the shorter slash-command namespace, install the alias plugin instead:

```text
/plugin install mir@52g
/reload-plugins
```

Update an installed marketplace plugin:

```text
/plugin marketplace update 52g
/plugin update makeitreal@52g
/reload-plugins
```

If you installed the alias, update it too:

```text
/plugin update mir@52g
/reload-plugins
```

Confirm the active copy after updating:

```text
/plugin list
```

`makeitreal@52g` and `mir@52g` should show the latest marketplace version. If
Claude Code still runs an older cached path such as
`~/.claude/plugins/cache/52g/mir/<older-version>/...`, update both plugins and
reload the Claude Code session. If the cache remains stale, uninstall and
reinstall:

```text
/plugin uninstall mir@52g
/plugin uninstall makeitreal@52g
/plugin marketplace update 52g
/plugin install makeitreal@52g
/plugin install mir@52g
/reload-plugins
```

For local development from this repository root:

```bash
claude plugin marketplace add . --scope local
claude plugin install makeitreal@52g --scope local
claude plugin list
```

Alias plugin local development:

```bash
claude plugin install mir@52g --scope local
```

Validate the local plugin and marketplace packaging:

```bash
npm run plugin:validate
```

## Normal Workflow

Use these commands in Claude Code. For new work, start directly with
`/makeitreal:plan <feature request>`. It creates the run, selects it, writes
project config if needed, and keeps `.makeitreal/` ignored.

```text
/makeitreal:plan <feature request>
```

For a Ralph-like one-command start, `/makeitreal:launch <feature request>` is
also valid. With no active run it plans first, opens/reports the Blueprint
dashboard, and stops for review. It does not execute code before Blueprint
approval.

Review the generated Blueprint and browser dashboard. The plan command asks a
Claude Code review question after showing the Blueprint; that answer, and any
later natural-language chat reply, is classified by the same native Claude Code review protocol. For
scripts or explicit approval controls, use:

```text
/makeitreal:plan approve
```

After approval:

```text
/makeitreal:launch
/makeitreal:status
```

Advanced operators can also use:

```text
/makeitreal:setup
/makeitreal:verify
/makeitreal:config
/makeitreal:doctor
```

`/makeitreal:setup` is optional. Use it only to initialize config without
planning yet, or to select an existing run with `--run`.

`/makeitreal:config` and `/mir:config` are semantic operator workflows, not raw
JSON editors. You can say `wiki off`, `dashboard quiet`, or `default`; the
plugin maps that intent to deterministic engine flags such as `--profile quiet`
or `--profile default`. With no arguments, Claude Code asks a settings question
and applies the selected deterministic action.

If you installed the alias plugin, use the equivalent short commands:

```text
/mir:plan <feature request>
/mir:launch
/mir:status
```

These are plugin slash commands from `plugins/makeitreal/commands/`. The
`skills/` directory is supporting guidance, not the slash-command registration
surface.

## Architecture

Make It Real has a small public surface and a stricter internal control plane:

- `plugins/makeitreal/` is the canonical Claude Code plugin.
- `plugins/mir/` is the short alias plugin for `/mir:*` commands.
- `bin/harness.mjs` is the internal engine CLI used by slash commands and tests.
- `src/` contains the deterministic engine modules for planning, gates,
  contracts, Kanban state, hooks, runner orchestration, verification, dashboard
  rendering, diagnostics, and wiki evidence.
- target projects store runtime state under `.makeitreal/`, which is
  automatically ignored by git.

For the full structure, state model, hook lifecycle, and run-packet layout, see
[docs/architecture.md](docs/architecture.md).

For the current GSD/Spec Kit feature review and Make It Real absorption backlog,
see [docs/research/2026-05-08-gsd-speckit-feature-review.md](docs/research/2026-05-08-gsd-speckit-feature-review.md).

## Core Guarantees

- PRD and Blueprint artifacts are created before implementation.
- `.makeitreal/` runtime state is automatically added to `.gitignore`.
- Every executable work item has exactly one responsibility owner.
- Every Blueprint declares module interfaces with public surfaces, inputs,
  outputs, and error contracts before implementation starts.
- Cross-module work happens through declared boundary contracts.
- Ambiguous frontend/backend/data requests fail fast with structured
  `suggestedBoundaries` so the operator can review the proposed split instead
  of guessing how to decompose the work.
- Allowed paths and contract IDs constrain the implementation workspace.
- Successful runner changes are applied back to the real project only for those
  allowed paths, and completion verification runs from the real project root.
- Undeclared fallback behavior is rejected in favor of fail-fast evidence.
- The browser dashboard is read-only observability, not a mutation surface.
- Verification and wiki evidence are engine-owned before Done.

## Prompt Discipline

Make It Real keeps the public command surface small, but the plugin skills carry
engineering workflow discipline:

- `plan` uses a conditional clarification round only when ownership, contracts,
  or verification are genuinely missing.
- `plan` normalizes shared project language into PRD acceptance criteria,
  responsibility units, contract names, and naming constraints.
- `launch` gives scoped subagents selective context for one work item instead
  of flooding them with the whole repository.
- `verify` follows stop-the-line diagnosis: reproduce, localize, reduce, fix the
  root cause, and preserve regression evidence.
- `status` is the zoom-out operator view: current phase, why blocked, missing
  evidence, and one next public action.

## Developer Checks

```bash
npm run check
npm run plugin:validate
```

Real Claude Code execution is exercised through `/makeitreal:launch` or
`/mir:launch` inside Claude Code, using the native `Task` subagent UI. The
repository does not expose a child-process `claude --print` runner.

Public repository target: `https://github.com/mir-makeitreal/makeitreal`.
License: MIT.
