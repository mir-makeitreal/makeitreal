---
name: config
description: Use when a Make It Real project needs optional settings reviewed or changed through semantic operator choices.
---

# Make It Real Config

Read or update project-local Make It Real options. The normal user-facing action
is `/mir:config`; keep internal config file paths and engine subcommands out of
ordinary workflow narration unless the user asks.

Treat config as a semantic operator workflow, not a raw settings editor. The
operator should be able to say "wiki off", "dashboard quiet", "restore defaults",
or invoke `/mir:config` with no arguments and answer a Claude Code question.

## Procedure

1. Start with `makeitreal-engine config get "${CLAUDE_PROJECT_DIR:-$PWD}"` to inspect current settings.
2. If no clear argument was provided, present a compact table:

| Setting | Current value | What it affects |
| --- | --- | --- |
| Live Wiki | on/off | whether verified work syncs to the live wiki |
| Dashboard auto-open | on/off | whether the browser dashboard opens automatically |
| Refresh on status | on/off | whether status refreshes preview files |
| Refresh on launch | on/off | whether launch refreshes preview files |
| Refresh on verify | on/off | whether verify refreshes preview files |

Then use AskUserQuestion with these choices:

1. **Quiet dashboard** - Stop auto-opening the dashboard and skip status-time refreshes.
2. **Restore defaults** - Turn all optional features back on.
3. **Toggle live wiki** - Enable or disable live wiki sync.
4. **Adjust dashboard refresh** - Choose which dashboard refresh triggers are enabled.
5. **Advanced view** - Show exact engine flags and config path.
6. **No change** - Leave settings as they are.

3. If arguments are present, classify the semantic operator intent. Do not pass raw `$ARGUMENTS` through. Use only the deterministic engine actions below.

## Semantic Operator Intent Map

| Operator wording | Engine action |
| --- | --- |
| "quiet", "dashboard quiet", "stop popping open dashboard" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --profile quiet` |
| "default", "restore defaults", "turn everything back on" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --profile default` |
| "wiki off", "disable wiki", "no live wiki" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --live-wiki disabled` |
| "wiki on", "enable wiki" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --live-wiki enabled` |
| "auto-open off", "do not open browser" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-auto-open disabled` |
| "auto-open on", "open dashboard automatically" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-auto-open enabled` |
| "status refresh off" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-refresh-on-status disabled` |
| "status refresh on" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-refresh-on-status enabled` |
| "launch refresh off" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-refresh-on-launch disabled` |
| "launch refresh on" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-refresh-on-launch enabled` |
| "verify refresh off" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-refresh-on-verify disabled` |
| "verify refresh on" | `makeitreal-engine config set "${CLAUDE_PROJECT_DIR:-$PWD}" --dashboard-refresh-on-verify enabled` |

## Rules

- Do not present key/value config editing as the normal path.
- Do not tell users to modify `features.*` keys directly unless they explicitly ask for advanced/manual configuration.
- The LLM may classify semantic operator intent, but the engine write must use one of the deterministic commands above.
- Ask one follow-up question when intent is ambiguous; do not guess between live wiki and dashboard settings.
- Live wiki is optional. Turning it off must not weaken verification, Blueprint approval, responsibility-boundary, contract, or Done evidence gates.
- When live wiki is disabled, Make It Real still writes explicit wiki-skip evidence after successful verification so Done remains auditable.
- Dashboard generation is not globally disableable. Plan-time `preview/index.html` remains mandatory because Ready gating depends on it.
- Dashboard auto-open only controls whether Make It Real should open the generated browser dashboard for the operator; it does not affect gate evidence.
- Dashboard refresh flags only control whether status, launch, and verify regenerate the dashboard after state changes.
- Disabled dashboard refresh must produce an explicit `dashboardRefresh.skipped` result; it must not weaken gates or evidence.
- Do not expose low-level `wiki sync` as the normal toggle mechanism.
- Use project config for team-shared behavior; do not encode this preference in prompts.

## Output

Lead with a user-facing settings table and a short sentence describing what
changed. Put raw `features.liveWiki.enabled`, `features.dashboard.*`, engine
flags, and the config path under "Advanced diagnostics" only when useful.
