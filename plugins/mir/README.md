# mir

`mir` is the short Claude Code slash-command alias for Make It Real.

Install the alias plugin when you want `/mir:*` commands instead of the longer
`/makeitreal:*` namespace:

```bash
claude plugin install mir@52g --scope user
```

The alias depends on the canonical `makeitreal@52g` plugin for the
engine and native hooks. It intentionally does not register its own hooks, so
installing both plugins does not double-run gate checks.

Common commands:

```text
/mir:plan <feature request>
/mir:launch
/mir:status
```

`/mir:launch <feature request>` can be used as a one-command start. It plans
first and stops at Blueprint review; implementation still waits for approval.
The plan review question and later natural-language replies are classified by
the same LLM judge; `/mir:plan approve` remains the explicit scriptable
fallback.

Advanced commands:

```text
/mir:setup
/mir:verify
/mir:config
/mir:doctor
```

Update:

```text
/plugin marketplace update 52g
/plugin update makeitreal@52g
/plugin update mir@52g
/reload-plugins
```

Then run `/plugin list` and confirm both `makeitreal@52g` and `mir@52g` show
the latest version. If Claude Code still executes an older
`~/.claude/plugins/cache/52g/mir/<version>/...` path, uninstall and reinstall
both plugins from the refreshed marketplace.
