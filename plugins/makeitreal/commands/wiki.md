---
description: Open the live wiki for the current Make It Real run in the browser
argument-hint: "[open|watch]"
allowed-tools: ["Bash"]
---

# Make It Real Wiki

Open the live wiki — a browsable HTML view of all verified work items.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" wiki open "${CLAUDE_PROJECT_DIR:-$PWD}"
```

The wiki opens in your default browser at `.makeitreal/wiki/index.html`.

If no wiki pages exist yet, it will show an empty state. Wiki pages are written automatically after each work item is verified (`wiki sync` runs as part of the Done gate).

To watch for changes and auto-refresh:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" wiki watch "${CLAUDE_PROJECT_DIR:-$PWD}" &
```
