# UltraQA Persona Dogfood - 2026-05-11

Goal: validate Make It Real as a contract-first, responsibility-boundary,
native-subagent development harness competitive with Superpowers, OMC/OMX, and
Ruflo.

## Persona Runs

| Persona | Temp run | Result | Score | Main finding |
| --- | --- | --- | --- | --- |
| FE | `/tmp/mir-fe-dogfood-xAnLZH/project/.makeitreal/runs/fe-welcome-card` | Done | 8/10 | Native lifecycle solid; generic component props needed better extraction. |
| BE/API | `/tmp/mir-be-api-dogfood.gSfAsW/.makeitreal/runs/be-catalog-api` | Done | 6.5/10 | Native lifecycle solid; REST contract route/fields/conformance UX needed improvement. |
| Ops/DevEx | `/tmp/mir-ops-health-IsEoL3/.makeitreal/runs/ops-health-check` | Done | 8/10 | Native lifecycle solid; verification env was being silently dropped. |

All persona runs used the native path:

1. `plan --runner claude-code`
2. `blueprint approve`
3. `orchestrator native start`
4. parent-session implementation and reviewer evidence
5. `orchestrator native finish`
6. `orchestrator complete --runner claude-code`
7. `status` / gate evidence

## Fixes Applied

- FE contracts now derive request-specific props for card-style components such
  as `WelcomeCard.props` with `title`, `subtitle`, `ctaLabel`, `tone`,
  `status`, and retry/click callbacks.
- REST contracts now infer common resource paths when no explicit `METHOD
  /path` is provided. The catalog API dogfood shape now produces
  `POST /catalog/books` with `title`, `author`, and declared `201/400/409`
  responses.
- Verification commands now preserve `env` and reject unsupported fields instead
  of silently dropping them.

## Regression Evidence

FE contract regression:

```json
{
  "surface": "WelcomeCard.props",
  "props": ["title", "subtitle", "ctaLabel", "tone", "status", "onRetry", "onClick"],
  "stories": ["ready", "loading", "error", "variants"]
}
```

BE contract regression:

```json
{
  "path": "/catalog/books",
  "method": "post",
  "fields": ["author", "title"],
  "responses": ["201", "400", "409"]
}
```

Ops verification regression:

```json
{
  "verify": {
    "file": "node",
    "env": {
      "MAKEITREAL_DOGFOOD_ENV": "enabled"
    }
  }
}
```

## Benchmark Verdict

Make It Real is stronger than Superpowers on enforceable contract/control-plane
gates because guidance becomes PRD, Blueprint, module IO signatures, allowed
paths, Kanban lanes, hooks, verification evidence, and Done gates.

Make It Real is narrower than OMX/Ruflo on broad durable multi-agent runtime,
memory, swarm, and MCP breadth. The right positioning remains:
contract-first Claude Code development harness, not a general swarm platform.

## Release QA

`npm run release:check` passed:

- 176 tests
- canonical design render
- OpenAPI contract validation
- Ready gate
- verification
- wiki sync
- Done gate
- Claude plugin validation for `makeitreal`, `mir`, and marketplace manifest
