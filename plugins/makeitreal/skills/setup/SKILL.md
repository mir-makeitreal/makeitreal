---
name: setup
description: Use when a Claude Code project needs Make It Real initialization, hook setup, run-state wiring, or first-time harness configuration before planning or launch.
---

# Make It Real Setup

Prepare the project so Make It Real can run as a Claude Code harness. Keep hook registration and engine details internal; the user-facing action is `/makeitreal:setup`.

Setup is optional for ordinary new work. `/makeitreal:plan <request>` creates `.makeitreal/runs/...`, selects the current run, and writes the ignore entry automatically. Use setup when the operator wants a first-run diagnostic/config bootstrap or wants to select an existing run with `--run`.


## Dashboard Boundary

The browser dashboard is read-only observability. It may show the next recommended Claude Code command, evidence paths, and Kanban status.
State changes belong to Claude Code conversation, Make It Real hooks, and internal engine gates. Do not add browser buttons for approval, launch, retry, reconcile, or Done transitions.

## Procedure

1. Locate the project root and the intended run directory.
2. Initialize `.makeitreal/`, default config, and the project `.gitignore` entry for `/.makeitreal/`.
3. If `--run <runDir>` is provided, record that run as the active run with `makeitreal-engine setup "${CLAUDE_PROJECT_DIR:-$PWD}" --run <runDir>`.
4. If no run is provided, report that setup is initialized and the next action is `/makeitreal:plan <request>`.
5. Confirm plugin-native hooks are available from `hooks/hooks.json`, or use the engine's fallback hook setup only when the plugin is not loaded.
6. Do not present `hooks install` or hook file paths as normal workflow commands.

## First-Run Contract

The normal user journey for a new feature can start directly at plan:

1. `/makeitreal:plan <request>`
2. Review the generated Blueprint preview and answer naturally in the conversation
3. Make It Real asks an LLM judge to classify the reply and records clear approval/rejection decisions as `makeitreal:interactive-review:llm`; if approval includes launch intent, continue to `/makeitreal:launch`
4. `/makeitreal:status`

`/makeitreal:setup` may be run before that flow, but it is not a required gate for ordinary planning.

Keep setup focused on project/run wiring. Do not split ordinary first-time configuration into additional user-facing commands.
Use `/makeitreal:config` only when the user wants to change optional feature flags such as live wiki sync.

## Stop Conditions

- Stop before planning if the project root or run directory cannot be determined.
- Stop if hook setup fails; report the exact command, exit status, and error output.
