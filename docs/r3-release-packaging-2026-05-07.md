# R3 Release Packaging - 2026-05-07

## Goal

R3 makes the current Make It Real MVP installable, auditable, and easier to
operate as a Claude Code plugin without expanding the user-facing command set.

## User-Facing Surface

Normal workflow:

- `/makeitreal:plan <request>`
- `/makeitreal:launch`

Read-only or advanced workflow:

- `/makeitreal:setup`
- `/makeitreal:status`
- `/makeitreal:verify`
- `/makeitreal:config`

The browser Kanban dashboard remains read-only. It can show current phase,
Blueprint status, evidence paths, blockers, next recommended command, and work
item state. It must not add browser actions for approval, launch, retry,
reconcile, wiki sync, or Done transitions.

## Packaging Checks

Local Claude Code plugin validation is now an explicit developer command:

```bash
npm run plugin:validate
```

It runs:

```bash
claude plugin validate plugins/makeitreal
claude plugin validate plugins/mir
claude plugin validate .claude-plugin/marketplace.json
```

This check does not run real Claude Code work and does not consume model quota.

The broader local release gate is:

```bash
npm run release:check
```

`release:check` runs the full deterministic harness check and then the Claude
plugin packaging validation.

## Install Path

Public marketplace install:

```text
/plugin marketplace add mir-makeitreal/makeitreal
/plugin install makeitreal@52g
# or short slash-command alias:
/plugin install mir@52g
/reload-plugins
```

Public marketplace update:

```text
/plugin marketplace update 52g
/plugin update makeitreal@52g
# if installed:
/plugin update mir@52g
/reload-plugins
```

Local install from the repository root:

```bash
claude plugin marketplace add . --scope local
claude plugin install makeitreal@52g --scope local
# or short slash-command alias:
claude plugin install mir@52g --scope local
claude plugin list
```

## Evidence Expectations

Before claiming release readiness, gather:

- deterministic harness check output from `npm run check`
- plugin packaging output from `npm run plugin:validate`
- real Claude Code golden path evidence from `/mir:launch` or
  `/makeitreal:launch` in an interactive Claude Code session when quota and
  time allow
- latest dashboard/Blueprint evidence path for the tested run

## Remaining Public Release Gap

The local plugin and marketplace manifests validate. The public repository target
is `https://github.com/mir-makeitreal/makeitreal`. Public distribution is
licensed under MIT.
