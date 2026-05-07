# Make It Real

Make It Real is a Claude Code plugin and local engineering harness for PRD-first,
contract-gated software work.

It turns a feature request into a reviewable Blueprint, a read-only Kanban
dashboard, responsibility-owned work items, declared boundary contracts, real
Claude Code execution, verification evidence, and a Done gate that cannot be
passed by assertion alone.

## Install Locally

From this repository root:

```bash
claude plugin marketplace add . --scope local
claude plugin install makeitreal@makeitreal-tools --scope local
claude plugin list
```

Validate the local plugin and marketplace packaging:

```bash
npm run plugin:validate
```

## Normal Workflow

Use these commands in Claude Code:

```text
/makeitreal:setup
/makeitreal:plan <feature request>
```

Review the generated Blueprint and browser dashboard. Approval is normally
handled conversationally by the plugin hook's LLM judge. For scripts or explicit
fallbacks, use:

```text
/makeitreal:plan approve
```

After approval:

```text
/makeitreal:launch
/makeitreal:status
```

Advanced operators can also use:

```text
/makeitreal:verify
/makeitreal:config
```

## Core Guarantees

- PRD and Blueprint artifacts are created before implementation.
- Every executable work item has exactly one responsibility owner.
- Cross-module work happens through declared boundary contracts.
- Allowed paths and contract IDs constrain the implementation workspace.
- Undeclared fallback behavior is rejected in favor of fail-fast evidence.
- The browser dashboard is read-only observability, not a mutation surface.
- Verification and wiki evidence are engine-owned before Done.

## Developer Checks

```bash
npm run check
npm run plugin:validate
```

Real Claude Code E2E is opt-in because it consumes Claude Code quota:

```bash
npm run e2e:real-claude
```

Public repository target: `https://github.com/mir-makeitreal/makeitreal`.
Public release still needs a license decision.
