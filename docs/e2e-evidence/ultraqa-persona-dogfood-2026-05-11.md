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

## Feedback Loop 2

After commit `03a4f3c`, FE, BE/API, and Ops personas re-ran focused dogfood
checks against the committed tree.

| Persona | Score | Finding | Resolution |
| --- | ---: | --- | --- |
| FE | 7/10 | `StatusPill` request with `label/status/tone` lost the explicit `label` prop, and component Done evidence over-promised type/a11y/visual files the orchestrator did not produce. | Planner now preserves explicit `label` props and component work items declare only evidence the engine produces. |
| BE/API | 7/10 -> 8.5/10 after fix | Orders API contracts had schema-mismatched examples, generic `ok/result` responses, and dependency contracts did not reach work item/native prompts. | OpenAPI examples are schema-shaped, success responses use `ok/data`, dependency contracts are copied to work items and native prompts, and `contracts openapi` rejects mismatched examples. |
| Ops/DevEx | 6.5/10 -> 9/10 after fix | `hooks install` wrote target-project `dev-harness/hooks` paths, stale failed generic verification stayed visible after Done, and `status --run` was missing. | Hook settings now use the actual installed hook root, stale project-relative hooks are replaced, superseded generic verification failures are labelled, `--version` exists, hooks help documents `--run`, and `status --run` works. |

Loop 2 verification:

- `node --test test/run-status-audit.test.mjs test/plan-generator.test.mjs test/hook-settings.test.mjs test/adapters.test.mjs test/cli.test.mjs`
  passed 33 tests.
- `npm run release:check` passed 182 tests plus canonical render, OpenAPI
  validation, Ready gate, verification, wiki sync, Done gate, and plugin /
  marketplace validation.

## Feedback Loop 3

Loop 3 targeted the remaining BE/API and native-finish DX concerns.

| Persona | Score | Finding | Resolution |
| --- | ---: | --- | --- |
| BE/API | 8/10 | OpenAPI example validation still missed `additionalProperties:false`, enum, and const edge cases. | Example validation now rejects undeclared object keys, scalar enum mismatches, and structurally compares object/array enum and const values. |
| Claude Code DX | 8/10 | The CLI supported native-finish shorthand, but the native task prompt still nudged workers to hand-build result JSON. | Native task prompts now describe shorthand finish as the preferred parent-session recording path. |
| Code review | request changes | `--blocker` shorthand could default to `DONE`, and object enum/const used identity comparison. | `--blocker` defaults to `BLOCKED`, `--needs-context` to `NEEDS_CONTEXT`, `--concern` to `DONE_WITH_CONCERNS`, and JSON enum/const comparison is structural. |

Loop 3 verification:

- `node --test test/adapters.test.mjs test/board-completion.test.mjs` passed
  22 tests after RED/GREEN regression.
- `npm run release:check` passed 186 tests plus canonical render, OpenAPI
  validation, Ready gate, verification, wiki sync, Done gate, and plugin /
  marketplace validation.

Remaining backlog after loop 3:

- OpenAPI validation still intentionally avoids full AJV-level JSON Schema
  semantics such as `oneOf`/`anyOf`/`allOf`, string formats, min/max
  constraints, and array cardinality.
- Native finish now has shorthand flags, but higher-level slash-command wording
  can still make the wrapper more discoverable.
