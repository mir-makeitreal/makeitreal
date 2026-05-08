# Make It Real

Make It Real is a Claude Code plugin and local engineering harness for PRD-first,
contract-gated software work.

It turns a feature request into a reviewable Blueprint, a read-only Kanban
dashboard, responsibility-owned work items, declared boundary contracts, real
Claude Code execution, verification evidence, and a Done gate that cannot be
passed by assertion alone.

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

Review the generated Blueprint and browser dashboard. Approval is normally
handled conversationally by the plugin hook's LLM judge. For scripts or explicit
fallbacks, use:

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

If you installed the alias plugin, use the equivalent short commands:

```text
/mir:plan <feature request>
/mir:launch
/mir:status
```

These are plugin slash commands from `plugins/makeitreal/commands/`. The
`skills/` directory is supporting guidance, not the slash-command registration
surface.

## Core Guarantees

- PRD and Blueprint artifacts are created before implementation.
- `.makeitreal/` runtime state is automatically added to `.gitignore`.
- Every executable work item has exactly one responsibility owner.
- Cross-module work happens through declared boundary contracts.
- Allowed paths and contract IDs constrain the implementation workspace.
- Undeclared fallback behavior is rejected in favor of fail-fast evidence.
- The browser dashboard is read-only observability, not a mutation surface.
- Verification and wiki evidence are engine-owned before Done.

## Developer Checks

```bash
npm run check
npm run plugin:validate
```

Real Claude Code E2E is opt-in because it consumes Claude Code quota:

```bash
npm run e2e:real-claude
```

Public repository target: `https://github.com/mir-makeitreal/makeitreal`.
License: MIT.
