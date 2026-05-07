---
name: config
description: Use when a Make It Real project needs optional feature flags changed, especially enabling or disabling live wiki sync.
---

# Make It Real Config

Read or update project-local Make It Real options. The normal user-facing action is `/makeitreal:config`; keep internal config file paths and engine subcommands out of ordinary workflow narration unless the user asks.

## Procedure

1. Start with `makeitreal-engine config get "$CLAUDE_PROJECT_DIR"` to inspect current settings.
2. To enable live wiki sync, run:

```bash
makeitreal-engine config set "$CLAUDE_PROJECT_DIR" --live-wiki enabled
```

3. To disable live wiki sync, run:

```bash
makeitreal-engine config set "$CLAUDE_PROJECT_DIR" --live-wiki disabled
```

4. To change dashboard refresh behavior, use the dedicated flags:

```bash
makeitreal-engine config set "$CLAUDE_PROJECT_DIR" --dashboard-auto-open enabled
makeitreal-engine config set "$CLAUDE_PROJECT_DIR" --dashboard-refresh-on-status enabled
makeitreal-engine config set "$CLAUDE_PROJECT_DIR" --dashboard-refresh-on-launch enabled
makeitreal-engine config set "$CLAUDE_PROJECT_DIR" --dashboard-refresh-on-verify enabled
```

5. Report the resulting `features.liveWiki.enabled`, `features.dashboard.*` values, and the config path.

## Rules

- Live wiki is optional. Turning it off must not weaken verification, Blueprint approval, responsibility-boundary, contract, or Done evidence gates.
- When live wiki is disabled, Make It Real still writes explicit wiki-skip evidence after successful verification so Done remains auditable.
- Dashboard generation is not globally disableable. Plan-time `preview/index.html` remains mandatory because Ready gating depends on it.
- Dashboard auto-open only controls whether Make It Real should open the generated browser dashboard for the operator; it does not affect gate evidence.
- Dashboard refresh flags only control whether status, launch, and verify regenerate the dashboard after state changes.
- Disabled dashboard refresh must produce an explicit `dashboardRefresh.skipped` result; it must not weaken gates or evidence.
- Do not expose low-level `wiki sync` as the normal toggle mechanism.
- Use project config for team-shared behavior; do not encode this preference in prompts.
