# Native DAG Dogfood Evidence - 2026-05-15

## Scope

Validate Make It Real as a Claude Code plugin harness, not a hidden Claude CLI runner:

- Blueprint-first planning with explicit approval through Claude Code's native question UI.
- Responsibility DAG fanout into scoped native Task subagents.
- Real project-root edits, not `.makeitreal` workspace edits.
- Work-item verification, wiki evidence, and Done gating.
- Fail-fast handling when declared verification does not prove the implementation.

## Environment

- Repository: `/Users/eugene/Workspace/52g-tools/dev-harness`
- Dogfood project: `/Users/eugene/Workspace/52g-tools/makeitreal-dogfood-dag-20260515`
- Claude Code: `2.1.142`
- Plugin version under test: `0.1.29` during the interactive run, then fixed and bumped to `0.1.30`
- Session command: `claude --dangerously-skip-permissions`
- Resume id: `72461013-fd39-4219-bcfd-6a40ddb06841`

## Request

Implement `POST /orders` as two explicit responsibility units.

| Unit | Owns | Public Surface |
| --- | --- | --- |
| Repository | `src/data/orders/repository.mjs`, `test/data/orders/repository.test.mjs` | `createOrderRepository`, `createOrder`, `listOrders` |
| API Handler | `src/api/orders/handler.mjs`, `test/api/orders/handler.test.mjs` | `handlePostOrders(request, repository)` |

The API unit may depend on the repository contract only; it must not inspect persistence implementation internals.

## Observed Native Flow

The plan generated a reviewable Blueprint and asked for approval through the native Claude Code question UI. Selecting approval moved the run into launch.

Launch used native Claude Code Task subagents, visible in the Claude Code agent UI:

- `oh-my-claudecode:executor(Implement orders repository)`
- `feature-dev:code-reviewer(Spec review for orders repository)`
- `oh-my-claudecode:critic(Quality review for orders repository)`
- `oh-my-claudecode:verifier(Verification review for orders repository)`
- `oh-my-claudecode:executor(Implement orders API handler)`
- `feature-dev:code-reviewer(Spec review for orders API handler)`
- `oh-my-claudecode:critic(Quality review for orders API handler)`
- `oh-my-claudecode:verifier(Verification review for orders API handler)`

No `claude --print` or JSON child-runner process was observed while checking `ps`.

## Project-Root Writes

The native tasks wrote implementation files directly under the dogfood project root:

- `src/data/orders/repository.mjs`
- `test/data/orders/repository.test.mjs`
- `src/api/orders/handler.mjs`
- `test/api/orders/handler.test.mjs`

Generated harness state stayed under `.makeitreal/runs/...`, as intended.

## Defect Found

The dogfood run exposed a gate defect:

```text
npm test -> node --test test/*.test.mjs
tests 0
pass 0
fail 0
exit 0
```

The old engine recorded that as `ok: true` verification evidence for both work items. That violated the Make It Real contract: exit code 0 is not enough when the test runner proves that zero tests executed.

The same run also showed responsibility-surface drift: the API responsibility unit exposed `createOrderRepository` instead of the requested `handlePostOrders`.

## Fixes Applied

- `runVerification`, `completeVerifiedWork`, and Done gate evidence reading now reject Node test output with zero executed tests using `HARNESS_VERIFICATION_NO_TESTS_EXECUTED`.
- API/Repository decomposition now preserves explicit labeled surfaces from the Blueprint request.
- Split responsibility architecture no longer leaves stale single-unit architecture nodes after DAG decomposition.
- Embedded plugin engine sync was added and wired into release checks so `plugins/makeitreal/dev-harness` cannot drift from the canonical engine.
- Plugin manifests were bumped to `0.1.30`.

## Verification

Commands run:

```bash
node --test test/verification.test.mjs test/board-completion.test.mjs test/plan-generator.test.mjs test/gates-cli.test.mjs
npm run plugin:sync -- --check
node --test test/makeitreal-plugin.test.mjs
npm run check
npm run plugin:validate
```

Evidence:

- Focused regression suite: 60 tests passed.
- Full check: 241 tests passed.
- Plugin validation passed for `makeitreal`, `mir`, and the marketplace manifest.
- `plugins/mir/bin/makeitreal-engine gate ... --target Done` now rejects the old dogfood evidence with `HARNESS_VERIFICATION_NO_TESTS_EXECUTED`.

