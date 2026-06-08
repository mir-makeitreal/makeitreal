# Session-Scoped Multi-Run Implementation Plan

## Problem Statement

`.makeitreal/current-run.json` is a single file. When two concurrent Make It Real runs
are active in the same repo (two separate Claude Code sessions), whichever session last
called `setup --run <runDir>` wins. The other session's hooks silently pick up the wrong
run and enforce path boundaries against the wrong blueprint.

## Proposed Solution

Add per-session run pointers:

    .makeitreal/current-runs/{session_id}.json   ← new, session-scoped
    .makeitreal/current-run.json                 ← keep, legacy fallback only

On READS (hooks): prefer session-scoped pointer when session_id is available.
On WRITES (setup): write both files — session-scoped AND legacy.
On FALLBACK: if session file is absent (old Claude Code, CLI context), use legacy.

---

## File-by-File Changes

---

### 1. src/project/run-state.mjs

This is the only file that owns the file paths. All session-scope logic lives here.

#### New exported function: `sessionCurrentRunStatePath`

```js
export function sessionCurrentRunStatePath(projectRoot, sessionId) {
  // sessionId is the raw string from input.session_id.
  // Callers must validate it before calling this.
  return path.join(projectRoot, ".makeitreal", "current-runs", `${sessionId}.json`);
}
```

Line delta: +5 lines.

#### New internal function: `writeSessionRunPointer`

```js
async function writeSessionRunPointer({ projectRoot, sessionId, runDir, source, enforcement, now }) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const dir = path.join(resolvedProjectRoot, ".makeitreal", "current-runs");
  await mkdir(dir, { recursive: true });  // needs: import { mkdir } from "node:fs/promises"
  const statePath = sessionCurrentRunStatePath(resolvedProjectRoot, sessionId);
  const state = {
    schemaVersion: "1.0",
    sessionId,
    currentRunDir: relativeToProject(resolvedProjectRoot, runDir),
    enforcement,
    source,
    updatedAt: now.toISOString()
  };
  await writeJsonFile(statePath, state);
  return { statePath, state };
}
```

Line delta: +14 lines. Requires adding `mkdir` to the imports from `node:fs/promises`.

#### Modified: `writeCurrentRunState`

Accept new optional param `sessionId = null`. After writing the legacy file, also write
the session-scoped file if sessionId is a non-empty string.

```js
export async function writeCurrentRunState({
  projectRoot,
  runDir,
  sessionId = null,                    // NEW
  source = "makeitreal:setup",
  enforcement = "attached",
  now = new Date()
}) {
  // ... existing validation unchanged ...

  const statePath = currentRunStatePath(resolvedProjectRoot);
  const state = {
    schemaVersion: "1.0",
    currentRunDir: relativeToProject(resolvedProjectRoot, resolvedRunDir),
    enforcement,
    source,
    updatedAt: now.toISOString()
  };
  await writeJsonFile(statePath, state);

  // NEW: also write session-scoped pointer when a valid sessionId is provided
  let sessionStatePath = null;
  if (sessionId && typeof sessionId === "string" && sessionId.trim().length > 0) {
    const sessionResult = await writeSessionRunPointer({
      projectRoot: resolvedProjectRoot,
      sessionId: sessionId.trim(),
      runDir: resolvedRunDir,
      source,
      enforcement,
      now
    });
    sessionStatePath = sessionResult.statePath;
  }

  return {
    ok: true,
    command: "setup",
    projectRoot: resolvedProjectRoot,
    runDir: resolvedRunDir,
    statePath,
    sessionStatePath,                  // NEW field, null if no sessionId
    state,
    errors: []
  };
}
```

Line delta: +14 lines (net, after replacing old return block).

#### New exported function: `readSessionRunState`

Mirrors `readCurrentRunState` but reads from the session-scoped path.

```js
export async function readSessionRunState(projectRoot, sessionId) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    return { ok: false, source: "session-missing", projectRoot: resolvedProjectRoot,
      runDir: null, state: null,
      errors: [{ code: "HARNESS_SESSION_ID_INVALID", reason: "sessionId is required.",
        contractId: null, ownerModule: null, evidence: [], recoverable: true }] };
  }
  const statePath = sessionCurrentRunStatePath(resolvedProjectRoot, sessionId.trim());
  if (!await fileExists(statePath)) {
    return { ok: false, source: "session-missing", projectRoot: resolvedProjectRoot,
      statePath, runDir: null, state: null,
      errors: [{ code: "HARNESS_SESSION_RUN_MISSING",
        reason: `No session-scoped run pointer for session ${sessionId}.`,
        contractId: null, ownerModule: null, evidence: [statePath], recoverable: true }] };
  }
  const state = await readJsonFile(statePath);
  const runDir = resolveProjectPath(resolvedProjectRoot, state.currentRunDir);
  return { ok: true, source: "session-run", projectRoot: resolvedProjectRoot,
    statePath, runDir, state, errors: [] };
}
```

Line delta: +21 lines.

#### Modified: `resolveCurrentRunDir`

Accept new optional param `sessionId = null`. Session-scoped lookup becomes the
first step before falling back to legacy.

```js
export async function resolveCurrentRunDir({
  projectRoot = process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd(),
  runDir = null,
  sessionId = null,                    // NEW
  env = process.env
} = {}) {
  const resolvedProjectRoot = path.resolve(
    projectRoot?.trim?.() || process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd()
  );
  const explicitRunDir = runDir ?? env.HARNESS_RUN_DIR ?? env.MAKEITREAL_RUN_DIR ?? null;

  // Explicit runDir always wins — sub-agents use MAKEITREAL_BOARD_DIR, which callers
  // pass as runDir; no session scoping needed for them.
  if (explicitRunDir) {
    return {
      ok: true,
      source: "explicit",
      projectRoot: resolvedProjectRoot,
      runDir: resolveProjectPath(resolvedProjectRoot, explicitRunDir),
      errors: []
    };
  }

  // NEW: try session-scoped pointer first when sessionId is available
  const cleanSessionId = sessionId && typeof sessionId === "string"
    ? sessionId.trim() : null;
  if (cleanSessionId) {
    const sessionState = await readSessionRunState(resolvedProjectRoot, cleanSessionId);
    if (sessionState.ok) {
      return {
        ok: true,
        source: "session-run",         // new source value
        projectRoot: resolvedProjectRoot,
        runDir: sessionState.runDir,
        state: sessionState.state,
        statePath: sessionState.statePath,
        sessionId: cleanSessionId,
        errors: []
      };
    }
    // session file absent → fall through to legacy
  }

  // Legacy fallback (existing behavior, unchanged)
  const current = await readCurrentRunState(resolvedProjectRoot);
  if (!current.ok) {
    return {
      ok: false,
      source: "missing",
      projectRoot: resolvedProjectRoot,
      runDir: null,
      errors: current.errors
    };
  }

  return {
    ok: true,
    source: "current-run",
    projectRoot: resolvedProjectRoot,
    runDir: current.runDir,
    state: current.state,
    statePath: current.statePath,
    errors: []
  };
}
```

Line delta: +16 lines (net, added the session block).

**Total run-state.mjs line delta: approximately +70 lines. Requires adding `mkdir` import.**

---

### 2. hooks/claude/user-prompt-submit.mjs

Two callsites need sessionId threaded in.

#### Change 1: Extract sessionId from input (top of main())

```js
async function main() {
  const input = await readHookInput();
  const projectRoot = input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const runDir = input.runDir ?? input.makeitreal?.runDir ?? null;
  const sessionId = input.session_id ?? null;          // NEW line
```

#### Change 2: Pass sessionId to resolveCurrentRunDir (line 55)

Before:
```js
  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, env: process.env });
```

After:
```js
  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, sessionId, env: process.env });
```

The call to `applyInteractiveBlueprintApproval` at line 61-68 already passes
`sessionId: input.session_id ?? null` — no change needed there.

**Line delta: +2 lines.**

---

### 3. hooks/claude/pre-tool-use.mjs

Two resolveCurrentRunDir calls exist. Both need sessionId.

#### Change 1: Extract sessionId in main()

After extracting projectRoot (line 326), add:
```js
  const sessionId = input.session_id ?? null;          // NEW line
```

#### Change 2: First resolveCurrentRunDir call (line ~350, runner context path)

Before:
```js
  if (runnerContext.complete || explicitRunDir) {
    resolved = await resolveCurrentRunDir({
      projectRoot,
      runDir: runnerRunDir ?? explicitRunDir
    });
```

After:
```js
  if (runnerContext.complete || explicitRunDir) {
    resolved = await resolveCurrentRunDir({
      projectRoot,
      runDir: runnerRunDir ?? explicitRunDir
      // Note: explicit runDir wins inside resolveCurrentRunDir anyway;
      // sessionId not needed here but harmless to include for consistency.
    });
```

Actually the runner context path always has an explicit runDir (runnerRunDir or explicitRunDir),
so sessionId would be ignored inside resolveCurrentRunDir regardless. No change needed for
that branch. Only the fallback path (line ~355) matters:

#### Change 3: Fallback resolveCurrentRunDir call (line ~355)

Before:
```js
  } else {
    resolved = await resolveCurrentRunDir({ projectRoot });
```

After:
```js
  } else {
    resolved = await resolveCurrentRunDir({ projectRoot, sessionId });
```

Also note the error message at line ~402 references `.makeitreal/current-run.json`.
Update that evidence array to include both files:

Before:
```js
      evidence: ["CLAUDE_PROJECT_DIR", ".makeitreal/current-run.json"],
```

After:
```js
      evidence: ["CLAUDE_PROJECT_DIR", ".makeitreal/current-run.json", ".makeitreal/current-runs/{session_id}.json"],
```

**Line delta: +2 lines (net).**

---

### 4. hooks/claude/stop.mjs

One resolveCurrentRunDir call.

#### Change: Extract sessionId and pass it

In `main()`, add after line 67:
```js
async function main() {
  const input = await readHookInput();
  const sessionId = input.session_id ?? null;          // NEW line
  const resolved = await resolveCurrentRunDir({
    projectRoot: input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    runDir: input.runDir ?? input.makeitreal?.runDir ?? null,
    sessionId                                           // NEW param
  });
```

**Line delta: +2 lines.**

---

### 5. src/blueprint/interactive-approval.mjs

Two functions call resolveCurrentRunDir: `applyInteractiveBlueprintApproval` (line 306)
and `applyNativeBlueprintReviewDecision` (line 154). Both already receive `sessionId`
as a parameter but don't pass it to resolveCurrentRunDir.

#### Change in applyInteractiveBlueprintApproval (line 306)

Before:
```js
  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, env });
```

After:
```js
  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, sessionId, env });
```

#### Change in applyNativeBlueprintReviewDecision (line 154)

Before:
```js
  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, env });
```

After:
```js
  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, sessionId, env });
```

**Line delta: +2 lines.**

---

### 6. src/project/bootstrap.mjs (initializeProject)

`initializeProject` is called by the `setup` CLI command. The CLI doesn't have a
session_id today, but with a new `--session-id` flag it can.

#### Change: Accept and pass sessionId

```js
export async function initializeProject({
  projectRoot,
  runDir = null,
  sessionId = null,                    // NEW
  source = "makeitreal:setup",
  now = new Date()
}) {
  // ...
  const currentRun = runDir
    ? await writeCurrentRunState({
        projectRoot: resolvedProjectRoot,
        runDir,
        sessionId,                     // NEW — passed through
        source,
        now
      })
    : null;
  // ...
  return {
    // ...
    statePath: currentRun?.statePath ?? path.join(resolvedProjectRoot, ".makeitreal", "current-run.json"),
    sessionStatePath: currentRun?.sessionStatePath ?? null,    // NEW field in return
    // ...
  };
}
```

**Line delta: +4 lines.**

---

### 7. bin/harness.mjs

The `setup` command must support `--session-id` so skill files can pass the session
context when invoking it via Bash.

#### Change: Parse and forward --session-id for setup

Before (lines 729-736):
```js
  if (argv[0] === "setup") {
    const result = await initializeProject({
      projectRoot: resolveProjectRootArg(argv[1]),
      runDir: parseFlag(argv, "--run"),
      source: "makeitreal:setup",
      now: deterministicNow(argv)
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }
```

After:
```js
  if (argv[0] === "setup") {
    const result = await initializeProject({
      projectRoot: resolveProjectRootArg(argv[1]),
      runDir: parseFlag(argv, "--run"),
      sessionId: parseFlag(argv, "--session-id") ?? null,     // NEW
      source: "makeitreal:setup",
      now: deterministicNow(argv)
    });
    return { exitCode: result.ok ? 0 : 1, result };
  }
```

Also update the help text at line 50:
```
  setup <projectRoot>          Initialize Make It Real state and optionally record --run [--session-id <id>]
```

**Line delta: +2 lines.**

---

### 8. plugins/makeitreal/mcp-server/index.mjs

The MCP server constructs runDir directly from `projectRoot + runSlug` (line 219) and
never calls `resolveCurrentRunDir`. It does NOT need session_id for its own operation.

However: `handleBlueprintTool` creates the run artifacts but never writes
`current-run.json`. That responsibility belongs to the `setup` CLI command. If the skill
file invokes `mir_blueprint` but not `setup`, no current-run pointer is written at all.

Recommended change: After a successful blueprint creation, call `writeCurrentRunState`
with an optional sessionId from the tool args. This makes the "plan" step also establish
the session pointer, so a second `setup` call is not required.

#### Change: Accept sessionId in mir_blueprint args

```js
const TOOL_DEFINITIONS = [
  {
    name: "mir_blueprint",
    description: "...",
    inputSchema: {
      ...buildToolInputSchema(),
      properties: {
        ...buildToolInputSchema().properties,
        sessionId: {                              // NEW optional property
          type: "string",
          description: "Claude Code session ID (input.session_id). Used to write a session-scoped run pointer."
        }
      }
    }
  },
  // ...
```

In `handleBlueprintTool(args)`, after the artifacts are written successfully:

```js
  // NEW: write current-run pointer so hooks can find this run
  const { writeCurrentRunState } = await import("../dev-harness/src/project/run-state.mjs");
  await writeCurrentRunState({
    projectRoot,
    runDir,
    sessionId: typeof args.sessionId === "string" ? args.sessionId : null,
    source: "makeitreal:plan"
  });
```

Note: The import path above is relative to the plugin location. Confirm actual path
at `plugins/makeitreal/dev-harness/src/project/run-state.mjs`.

**Line delta: +15 lines.**

---

### 9. src/diagnostics/doctor.mjs

Doctor should surface stale session files so operators can understand what's running.

#### Change: List session-scoped run pointers in doctor output

In the run-state section of doctor, scan `.makeitreal/current-runs/` directory and
include each file's sessionId, currentRunDir, and updatedAt in the output. Mark files
older than 48h as stale.

No function signature change needed — doctor already accepts `projectRoot`. Add a
new internal helper `readAllSessionPointers(projectRoot)` that reads the directory.

**Estimated line delta: +30 lines.**

---

## Migration: Existing current-run.json Files

No migration required. The read path falls back to the legacy file when no session-scoped
file exists. Existing setups continue working unchanged on the first request, then
optionally get a session-scoped pointer written when the next `setup --session-id` is run.

**No migration script needed.**

---

## Edge Cases

### A. session_id is null (old Claude Code versions or CLI context)

`resolveCurrentRunDir` skips the session lookup entirely when `sessionId` is null or
empty. Behavior is identical to today: reads legacy `current-run.json` only.

All hook changes use `input.session_id ?? null`, so null propagates cleanly.

No code path can crash on null sessionId.

### B. Multiple runs in same session (user switches mid-session via setup)

Calling `setup --run run-b --session-id S1` after `setup --run run-a --session-id S1`
simply overwrites `.makeitreal/current-runs/S1.json`. The session pointer always
reflects the most recent setup call for that session.

This is correct behavior: when a user explicitly re-runs setup, they are changing
their active run.

### C. Stale session files (Claude crashed, never cleaned up)

Session files are small JSON (~200 bytes). They do not self-expire. Over time, one
accumulates one file per historical Claude Code session. This is low risk but doctor
should surface files older than 48h as informational warnings (not errors).

Optional future work: add `harness.mjs session gc <projectRoot>` that removes session
pointer files whose runDir no longer exists or whose updatedAt is older than N days.

No cleanup logic is required for the initial implementation.

### D. Sub-agent sessions (should they inherit parent session run?)

Sub-agents are explicitly excluded from session-scoped lookup by the existing mechanism:
`MAKEITREAL_WORK_ITEM_ID` env var is set in sub-agent context, which causes
`runnerContext.complete` to be true in pre-tool-use.mjs. That branch uses an explicit
`runnerRunDir` (from `MAKEITREAL_BOARD_DIR`), not `resolveCurrentRunDir` with session
scoping. Sub-agents never reach the session-lookup code path.

Sub-agents also have their own session_id distinct from the parent session. If they
somehow reached the session lookup, they would find no file and fall back to legacy —
but they never reach it because `MAKEITREAL_BOARD_DIR` is always explicit.

**No sub-agent special casing needed.**

---

## Exact Files to Change

| File | Type | Lines Changed | Notes |
|------|------|---------------|-------|
| src/project/run-state.mjs | Primary logic | +70 | New functions, new param |
| src/project/bootstrap.mjs | Pass-through | +4 | Accept + forward sessionId |
| bin/harness.mjs | CLI | +2 | --session-id flag for setup |
| hooks/claude/user-prompt-submit.mjs | Hook | +2 | Extract + forward sessionId |
| hooks/claude/pre-tool-use.mjs | Hook | +2 | Extract + forward sessionId |
| hooks/claude/stop.mjs | Hook | +2 | Extract + forward sessionId |
| src/blueprint/interactive-approval.mjs | Library | +2 | Forward sessionId to resolver |
| plugins/makeitreal/mcp-server/index.mjs | MCP server | +15 | Optional: write pointer at plan time |
| src/diagnostics/doctor.mjs | Diagnostics | +30 | Surface session files |

Mirror files in `plugins/makeitreal/dev-harness/` must be updated identically:
- plugins/makeitreal/dev-harness/src/project/run-state.mjs (+70)
- plugins/makeitreal/dev-harness/src/project/bootstrap.mjs (+4)
- plugins/makeitreal/dev-harness/hooks/claude/user-prompt-submit.mjs (+2)
- plugins/makeitreal/dev-harness/hooks/claude/pre-tool-use.mjs (+2)
- plugins/makeitreal/dev-harness/hooks/claude/stop.mjs (+2)
- plugins/makeitreal/dev-harness/src/blueprint/interactive-approval.mjs (+2)
- plugins/makeitreal/dev-harness/src/diagnostics/doctor.mjs (+30)

**Total estimated line delta across all files: ~250 lines added, 0 deleted.**

---

## Test Changes

### test/run-state.test.mjs — add new test cases

1. "session-scoped pointer is written when sessionId is provided to writeCurrentRunState"
   - Call writeCurrentRunState with sessionId="test-session-123"
   - Assert sessionStatePath exists
   - Assert file content has correct sessionId, currentRunDir
   - Assert legacy current-run.json also exists

2. "resolveCurrentRunDir prefers session-scoped pointer over legacy"
   - Write legacy current-run.json pointing to run-a
   - Write session-scoped file for "session-s1" pointing to run-b
   - Call resolveCurrentRunDir with sessionId="session-s1"
   - Assert runDir resolves to run-b
   - Assert source === "session-run"

3. "resolveCurrentRunDir falls back to legacy when session file is absent"
   - Write only legacy current-run.json pointing to run-a
   - Call resolveCurrentRunDir with sessionId="session-no-file"
   - Assert runDir resolves to run-a
   - Assert source === "current-run"

4. "resolveCurrentRunDir ignores null sessionId and reads legacy"
   - Write only legacy current-run.json
   - Call resolveCurrentRunDir with sessionId=null
   - Assert source === "current-run"

5. "two sessions get independent run resolution"
   - Write session pointer for S1 → run-a
   - Write session pointer for S2 → run-b
   - Write legacy → run-c (e.g. from a third setup call)
   - resolveCurrentRunDir(sessionId="S1") → run-a
   - resolveCurrentRunDir(sessionId="S2") → run-b
   - resolveCurrentRunDir(sessionId=null) → run-c

6. "sessionId with whitespace is normalized (trimmed)"
   - Write session pointer for "  session-abc  "
   - resolveCurrentRunDir(sessionId=" session-abc ") → resolves correctly

**Estimated: +80 lines in test/run-state.test.mjs**

### test/claude-hooks.test.mjs — add new test cases

The `runHook` helper in this file passes a raw input object. Tests can inject
`session_id` in the input to exercise session-scoped lookup.

1. "UserPromptSubmit with session_id resolves session-scoped run (no active review → noop)"
   - Write session pointer for "hook-session-1" → fixture runDir
   - runHook with input including session_id: "hook-session-1"
   - Assert hook returns continue: true without errors

2. "PreToolUse with session_id uses session-scoped run for path enforcement"
   - Write session pointer for "hook-session-2" → fixture runDir with approved blueprint
   - runHook pre-tool-use with Edit tool + session_id
   - Assert allow decision

3. "Stop hook with session_id finds correct run"
   - Write session pointer → fixture runDir without active execution
   - runHook stop with session_id
   - Assert passThrough (no active execution → pass)

**Estimated: +60 lines in test/claude-hooks.test.mjs**

---

## Implementation Order

1. src/project/run-state.mjs (all new functions and modifications)
2. src/project/bootstrap.mjs (pass sessionId through)
3. bin/harness.mjs (--session-id flag)
4. hooks/claude/user-prompt-submit.mjs
5. hooks/claude/pre-tool-use.mjs
6. hooks/claude/stop.mjs
7. src/blueprint/interactive-approval.mjs
8. plugins/makeitreal/mcp-server/index.mjs (write pointer at plan time)
9. src/diagnostics/doctor.mjs (session file listing)
10. Mirror all changes to plugins/makeitreal/dev-harness/
11. Tests

Steps 1-7 are the critical path. Steps 8-10 are optional quality-of-life additions.

---

## Verification

After implementation, verify with a two-session simulation:

```bash
# Setup
PROJ=$(mktemp -d)
node bin/harness.mjs setup $PROJ
node bin/harness.mjs blueprint import $PROJ/... # import fixture blueprint

# Simulate two concurrent setups
node bin/harness.mjs setup $PROJ --run $PROJ/.makeitreal/runs/run-a --session-id session-1
node bin/harness.mjs setup $PROJ --run $PROJ/.makeitreal/runs/run-b --session-id session-2

# Legacy file now points to run-b (session-2 was last)
cat $PROJ/.makeitreal/current-run.json           # run-b

# But session-1 still has its own pointer
cat $PROJ/.makeitreal/current-runs/session-1.json  # run-a
cat $PROJ/.makeitreal/current-runs/session-2.json  # run-b

# Hook simulation: session-1 sees run-a
echo '{"session_id":"session-1","repoRoot":"'$PROJ'"}' \
  | node hooks/claude/user-prompt-submit.mjs

# Hook simulation: session-2 sees run-b
echo '{"session_id":"session-2","repoRoot":"'$PROJ'"}' \
  | node hooks/claude/user-prompt-submit.mjs
```

---

## What Does NOT Need to Change

- `src/status/run-status.mjs` — Called from CLI only, no session context needed.
- `src/orchestrator/orchestrator.mjs` — Uses explicit MAKEITREAL_BOARD_DIR.
- `src/gates/index.mjs` — Takes explicit runDir, no resolution.
- Any board/work-item logic — Always uses explicit runDir, never resolves via session.
- The session file format for the MCP server (it does not do resolution).
- Gitignore — `.makeitreal/` already covers the new `current-runs/` subdirectory.
