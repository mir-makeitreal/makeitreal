# Make It Real OMC-Style Command UX Design

## Problem

Make It Real already has a strict deterministic engine, but several Claude Code
slash-command prompts still expose engine-shaped concepts to operators. The most
visible case is `/mir:config`, which suggests key/value edits such as
`features.liveWiki.enabled=false` instead of presenting a small set of meaningful
workflow choices.

This is not only copy polish. It leaks implementation details across the
operator boundary and makes the plugin feel less like a Claude Code workflow
than mature references such as OMC.

## Goals

- Make `/mir:config` and `/makeitreal:config` work like an operator-facing
  semantic workflow.
- Preserve deterministic engine writes. The LLM may classify intent, but the
  engine must receive typed flags or presets, not arbitrary config patches.
- Apply the same UX contract to `status`, `doctor`, `verify`, and `launch`
  prompts so raw engine fields stay in diagnostics instead of primary output.
- Keep the browser dashboard read-only; command UX remains inside Claude Code.

## Non-Goals

- Do not add browser dashboard mutation controls.
- Do not add a large general-purpose settings editor.
- Do not let the LLM write `.makeitreal/config.json` directly.
- Do not remove the existing low-level engine flags used by tests and scripts.

## Reference Pattern From OMC

OMC uses user-facing skills and presets rather than asking the operator to know
internal config keys:

- Notification setup is a natural-language configuration skill. If provider
  intent is missing, it uses `AskUserQuestion` to choose Telegram, Discord, or
  Slack before writing a config file.
- HUD configuration exposes semantic commands such as `minimal`, `focused`,
  `full`, and `status`; its internal settings are stored under Claude config
  files and not treated as the normal user surface.

Make It Real should follow the same boundary:

```text
operator intent -> Claude Code prompt / AskUserQuestion -> deterministic engine flag
```

## UX Contract

Each public slash command should have a primary operator report and an advanced
diagnostic layer.

| Command | Primary Surface | Advanced Surface |
| --- | --- | --- |
| `/mir:config` | current settings table, semantic choices, natural-language toggles | raw config path, engine flags |
| `/mir:status` | phase, Kanban lane counts, blockers, next action | run id, file paths, raw diagnostic fields |
| `/mir:doctor` | check table with pass/warn/fail and fix action | raw `checks.*` JSON |
| `/mir:launch` | one-command start narrative and Blueprint gate status | `orchestrator tick`, runner command JSON |
| `/mir:verify` | verification result, failing command, next rework action | evidence file paths and raw envelope |

## Config Semantic Intents

The config workflow supports these operator intents:

| Intent | Engine Action |
| --- | --- |
| Show current settings | `config get <projectRoot>` |
| Default mode | `config set <projectRoot> --profile default` |
| Quiet dashboard mode | `config set <projectRoot> --profile quiet` |
| Enable or disable live wiki | `config set <projectRoot> --live-wiki enabled|disabled` |
| Enable or disable dashboard auto-open | `config set <projectRoot> --dashboard-auto-open enabled|disabled` |
| Enable or disable refresh on status/launch/verify | corresponding `--dashboard-refresh-on-* enabled|disabled` |

`quiet` keeps verification-facing dashboard artifacts fresh while reducing
operator noise:

```json
{
  "features": {
    "liveWiki": { "enabled": true },
    "dashboard": {
      "autoOpen": false,
      "refreshOnStatus": false,
      "refreshOnLaunch": true,
      "refreshOnVerify": true
    }
  }
}
```

`default` restores all optional features to the current default config.

## Interaction Rules

- Empty `/mir:config` must first read the current config, then present a compact
  settings table and an `AskUserQuestion` choice list.
- Natural-language arguments such as `wiki off`, `dashboard quiet`, and
  `status refresh off` should be interpreted by the LLM and mapped to one of
  the supported engine actions.
- Ambiguous or multi-meaning arguments must ask one follow-up question instead
  of guessing.
- The response must not tell users to edit `features.*` keys or pass raw
  `key=value` arguments as the normal path.
- Engine JSON, `HARNESS_*` codes, hashes, run ids, and contract ids belong in
  diagnostics only.

## Responsibility Boundaries

| Unit | Responsibility |
| --- | --- |
| Plugin command markdown | Defines Claude Code operator workflow, question UI, and presentation rules. |
| Plugin skill markdown | Defines durable UX contract and safety rules shared by canonical and alias commands. |
| Engine config module | Validates and writes deterministic config objects and semantic profiles. |
| Engine CLI | Converts supported flags or profiles into config writes; rejects unsupported input. |
| Tests | Prevent regression to raw key/value UX and verify profile behavior. |

## Acceptance Criteria

- `/mir:config` and `/makeitreal:config` docs instruct Claude to show settings
  first and use `AskUserQuestion` when no clear intent is supplied.
- Config docs define semantic operator choices and forbid normal key/value UX.
- Engine supports `--profile default` and `--profile quiet`.
- Tests verify both profiles and both plugin namespaces.
- Command docs for status, doctor, launch, and verify explicitly keep raw engine
  output out of the primary operator report.
- `npm run check` and `npm run plugin:validate` pass.
