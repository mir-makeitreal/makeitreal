# Getting Started

Install to first Blueprint in 90 seconds.

## Install

```bash
claude plugin marketplace add mir-makeitreal/makeitreal
claude plugin install makeitreal@52g
```

The marketplace registers under the name `52g`.

For short aliases, install the companion alias plugin:

```bash
claude plugin install mir@52g
```

This gives you two plugin surfaces:
- `makeitreal` — the full command suite (`/makeitreal:plan`, `/makeitreal:launch`, etc.)
- `mir` — short aliases (`/mir:plan`, `/mir:launch`, etc.)

## Your First Blueprint

### 1. Plan

Open Claude Code in your project directory and type:

```
/makeitreal:plan "Add JWT authentication with login, logout, and token refresh endpoints"
```

If you run `/makeitreal:plan` without a request, the intake system asks targeted clarifying questions to build a precise specification. It reads your project structure and asks only what it can't infer.

The engine generates:
- **PRD** — goals, acceptance criteria, non-goals, user-visible behavior
- **Design Pack** — architecture topology, state flow, API specs, responsibility boundaries, module interfaces, call stacks, sequence diagrams
- **Contracts** — OpenAPI 3.x specs with schemas and examples, module interface signatures with typed inputs/outputs/errors
- **Work Item DAG** — dependency graph with contract edges
- **Responsibility Units** — ownership boundaries with allowed file paths
- **Work Items** — individual tasks with contract bindings, verification commands, PRD traces
- **Dashboard** — visual preview of the entire architecture

### 2. Review

After planning, Make It Real shows you a summary:

- **What will be delivered** — outcome and acceptance evidence
- **Scope** — in-scope, out-of-scope, safe-to-change areas
- **Work packages** — each package, purpose, dependencies, verification
- **Review decisions** — what you need to approve

It then asks: approve, request changes, or reject.

You can also use the explicit commands:
```
/makeitreal:plan approve
/makeitreal:plan reject
```

### 3. Launch

Once approved:

```
/makeitreal:launch
```

This:
1. Validates all Ready gates (PRD traces, contract completeness, path boundaries, verification plans)
2. Dispatches sub-agents in DAG order using Claude Code native Tasks
3. Each sub-agent implements within their responsibility boundary
4. Reviewer sub-agents (spec-reviewer, quality-reviewer, verification-reviewer) validate each piece
5. Contract conformance and path boundary checks run automatically
6. Evidence is collected for every work item

### 4. Monitor

```
/makeitreal:status
```

Shows: current phase, work item states, blockers, evidence summary, and dashboard URL.

The dashboard opens in your browser with an interactive view of the architecture topology, task DAG, contract details, and kanban board.

## Project Structure

Make It Real creates a `.makeitreal/` directory in your project root:

```
your-project/
├── .makeitreal/
│   ├── config.json          # Project configuration
│   └── runs/
│       └── <run-id>/        # One directory per plan
│           ├── prd.json
│           ├── design-pack.json
│           ├── work-item-dag.json
│           ├── responsibility-units.json
│           ├── blueprint-review.json
│           ├── board.json
│           ├── work-items/
│           ├── contracts/
│           ├── evidence/
│           └── preview/
├── src/                     # Your code (sub-agents edit here)
└── .gitignore               # .makeitreal/ auto-added
```

The `.makeitreal/` directory is automatically added to `.gitignore`. Run artifacts are local development state, not checked-in code.

## What's Next

- [How It Works](how-it-works.md) — full pipeline visual walkthrough
- [Blueprints](concepts/blueprints.md) — understanding architecture-first planning
- [Contracts](concepts/contracts.md) — the key differentiator, deep dive
- [Responsibility Units](concepts/responsibility-units.md) — ownership boundaries
- [Orchestration](concepts/orchestration.md) — DAG execution, gates, retry
