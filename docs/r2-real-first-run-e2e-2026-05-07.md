# R2 Real First-Run E2E - 2026-05-07

## Scope

R2 promotes Make It Real from a fixture-backed harness into a repeatable Claude Code first-run path.
The verified public workflow is:

1. `/makeitreal:setup`
2. `/makeitreal:plan <request>`
3. read-only dashboard review
4. Blueprint approval
5. `/makeitreal:launch`
6. engine-owned verification and Done gate

The implementation keeps the browser dashboard read-only. Claude Code remains the only implementation surface, and the Make It Real engine remains the authority for gates, verification, wiki evidence, and Done transitions.

## Product Change

The internal `plan` command now accepts:

```bash
makeitreal-engine plan "$CLAUDE_PROJECT_DIR" --runner claude-code --request "$ARGUMENTS" --verify '{"file":"npm","args":["test"]}'
```

When `--runner claude-code` is used, the generated `trust-policy.json` declares:

```json
{
  "runnerMode": "claude-code",
  "realAgentLaunch": "enabled",
  "commandExecution": "structured-command-only",
  "userInputRequired": "fail-fast",
  "unsupportedToolCall": "fail-fast"
}
```

This fixes the previous product gap where real Claude Code execution existed but a freshly planned run still defaulted to a scripted-simulator trust policy.

## Opt-In Verification Command

Real Claude Code E2E is intentionally outside `npm run check` because it consumes Claude Code quota:

```bash
npm run e2e:real-claude
```

The command writes evidence to `dev-harness/docs/e2e-evidence/`.

## Latest Evidence

Evidence file:

```text
docs/e2e-evidence/real-claude-golden-path-1778137695717.json
```

Observed result:

- `planTrustPolicy`: `claude-code`
- pre-approval launch attempt blocked by Blueprint gate
- Ready gate passed only after approval
- real Claude Code runner wrote `modules/slug-stats/index.cjs`
- latest successful attempt recorded runner mode `claude-code`
- engine verification passed
- wiki evidence was produced
- Done gate passed
- final phase was `done`
- operator cockpit stayed read-only with `controlSurface: "claude-code"`

Claude executable provenance:

```text
resolvedPath: /Users/eugene/.local/bin/claude
realPath: /Users/eugene/.local/share/claude/versions/2.1.132
hash: sha256:2ce6b9007f38f5caf0d116ae35d59f1a6d40e902ae7f9f19aca6ec483697b764
```

## Boundary Verdict

R2 satisfies the core Make It Real philosophy:

- PRD and Blueprint artifacts are staged as source of truth.
- exactly one responsibility unit owns the work item.
- Claude sees only declared allowed paths and contract IDs.
- the runner cannot mark work Done by assertion.
- unsupported tool use does not become a fallback path.
- verification and wiki evidence are engine-owned.
- browser UI provides observability and copy-only guidance, not state mutation.
