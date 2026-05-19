---
description: Generate a demo blueprint from a built-in template
argument-hint: "[todo-app | rest-api | auth-system]"
allowed-tools: ["Bash", "Read"]
---

# Make It Real Demo

Generate a Make It Real blueprint from a built-in sample request without requiring a real project.

Available templates:
- `todo-app` — Simple: a todo list module with CRUD operations
- `rest-api` — Medium: a REST API for managing books with auth (default)
- `auth-system` — Complex: a full authentication system with RBAC

Usage:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" demo [template]
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" demo list
```

The demo creates a temporary project directory, sets up a minimal `package.json`, and runs `generatePlanRun()` with `runnerMode: 'scripted-simulator'`. After generation, open the dashboard:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine" dashboard open "$RUN_DIR" --project-root "$PROJECT_ROOT"
```

Report:
- Template used and complexity level
- Generated run directory
- Dashboard URL
- Whether the blueprint passed the Ready gate (pending Blueprint approval is expected)
