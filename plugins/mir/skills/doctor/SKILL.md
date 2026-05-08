---
name: doctor
description: Use when a Make It Real installation, slash command, hook, dashboard, current-run, or Claude Code runner environment needs read-only diagnostics.
---

# Make It Real Doctor

Diagnose the local harness without changing implementation state.

## Dashboard Boundary

The browser dashboard is read-only observability. Doctor may report dashboard paths and missing preview files, but it must not add browser actions or mutate board, Blueprint, approval, evidence, or config state.

## Procedure

1. Run `makeitreal-engine doctor "${CLAUDE_PROJECT_DIR:-$PWD}"` through the plugin binary.
2. Inspect `checks.config`, `checks.plugin`, `checks.currentRun`, `checks.hooks`, `checks.dashboard`, and `checks.claudeBinary`.
3. Treat `healthy:false` as a diagnostic result, not a command failure.
4. Use `supportMatrix` to separate environment problems from harness state problems.
5. Report `nextAction` exactly when it is a public command or an install/PATH repair instruction.

## Operator Report

Lead with a pass/warn/fail diagnostic table and the smallest next fix. Keep raw
engine fields, JSON envelopes, run ids, hashes, contract ids, and HARNESS codes
in an advanced diagnostic note only when the user asks or troubleshooting
requires it. Do not lead with raw engine fields.

## Output

Keep the report short: healthy state, failing checks, evidence paths, support matrix highlights, and the next safe action.
