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
/plugin update mir@52g
/reload-plugins
```
