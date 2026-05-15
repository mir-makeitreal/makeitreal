import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runVerification } from "../src/adapters/command-evidence.mjs";
import { decideBlueprintReview, readBlueprintReview, seedBlueprintReview } from "../src/blueprint/review.mjs";
import { writeJsonFile } from "../src/io/json.mjs";
import { renderDesignPreview } from "../src/preview/render-preview.mjs";
import { writeCurrentRunState } from "../src/project/run-state.mjs";
import { syncLiveWiki } from "../src/wiki/live-wiki.mjs";
import { withFixture } from "./helpers/fixture.mjs";

const harnessRoot = fileURLToPath(new URL("../", import.meta.url));

function runHook(script, input, options = {}) {
  const scriptPath = script.startsWith("/") ? script : `${harnessRoot}${script}`;
  return spawnSync(process.execPath, [scriptPath], {
    cwd: options.cwd ?? harnessRoot,
    encoding: "utf8",
    input: JSON.stringify(input),
    env: options.env ?? process.env
  });
}

async function setActiveExecution(runDir) {
  await writeJsonFile(path.join(runDir, "runtime-state.json"), {
    schemaVersion: "1.0",
    running: {
      "work.feature-auth": {
        attemptId: "attempt.stop-hook",
        lastEventAt: "2026-05-06T00:00:00.000Z",
        startedAt: "2026-05-06T00:00:00.000Z",
        workerId: "worker.stop-hook",
        workItemId: "work.feature-auth"
      }
    },
    retries: {},
    terminals: {}
  });
}

test("pre-tool-use blocks writes outside allowed paths", async () => {
  await withFixture(async ({ runDir }) => {
    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      runDir,
      tool_name: "Edit",
      tool_input: { file_path: "services/auth/private.ts" }
    });
    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.match(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecisionReason, /HARNESS_PATH_BOUNDARY_VIOLATION/);

    const allowed = runHook("hooks/claude/pre-tool-use.mjs", {
      runDir,
      tool_name: "Edit",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    });
    assert.equal(allowed.status, 0, allowed.stdout || allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision, "allow");
  });
});

test("pre-tool-use blocks mutating tools before Blueprint approval", async () => {
  await withFixture(async ({ runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      runDir,
      tool_name: "Edit",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    });
    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.match(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecisionReason, /HARNESS_BLUEPRINT_APPROVAL_PENDING/);

    const readOnly = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Read",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    });
    assert.equal(readOnly.status, 0, readOnly.stdout || readOnly.stderr);
    assert.equal(JSON.parse(readOnly.stdout).hookSpecificOutput.permissionDecision, "allow");
  });
});

test("pre-tool-use blocks current-run writes while Blueprint approval is pending", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:01:00.000Z")
    });

    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Write",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });

    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    const output = JSON.parse(blocked.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /HARNESS_BLUEPRINT_APPROVAL_PENDING/);
  });
});

test("stop blocks until Done gate evidence is complete", async () => {
  await withFixture(async ({ runDir }) => {
    await writeJsonFile(path.join(runDir, "board.json"), {
      schemaVersion: "1.0",
      boardId: "board.stop-hook",
      workItems: [{ id: "work.feature-auth", lane: "Verifying" }]
    });
    const approval = await decideBlueprintReview({
      runDir,
      status: "approved",
      reviewedBy: "operator:stop-hook-test",
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    assert.equal(approval.ok, true);

    const blocked = runHook("hooks/claude/stop.mjs", { runDir });
    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).decision, "block");
    assert.match(JSON.parse(blocked.stdout).reason, /HARNESS_PREVIEW_MISSING/);

    await renderDesignPreview({ runDir });
    await runVerification({ runDir });
    await syncLiveWiki({ runDir });

    const allowed = runHook("hooks/claude/stop.mjs", { runDir });
    assert.equal(allowed.status, 0, allowed.stdout || allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).decision, "approve");
  });
});

test("stop reports active runner instead of missing Done evidence while work is Running", async () => {
  await withFixture(async ({ runDir }) => {
    await setActiveExecution(runDir);
    const blocked = runHook("hooks/claude/stop.mjs", { runDir });
    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    const output = JSON.parse(blocked.stdout);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /HARNESS_RUNNER_IN_PROGRESS/);
    assert.doesNotMatch(output.reason, /HARNESS_EVIDENCE_MISSING/);
  });
});

test("stop is quiet when no Make It Real run is active", async () => {
  await withFixture(async ({ root }) => {
    const result = runHook("hooks/claude/stop.mjs", {}, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      continue: true,
      suppressOutput: true
    });
  });
});

test("stop is quiet for planned runs that are not executing", async () => {
  await withFixture(async ({ root, runDir }) => {
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    const result = runHook("hooks/claude/stop.mjs", {}, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      continue: true,
      suppressOutput: true
    });
  });
});

test("Claude hooks resolve run directory from project current-run state", async () => {
  await withFixture(async ({ root, runDir }) => {
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    await setActiveExecution(runDir);

    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Edit",
      tool_input: { file_path: "services/auth/private.ts" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, "deny");

    const stop = runHook("hooks/claude/stop.mjs", {}, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(stop.status, 0, stop.stdout || stop.stderr);
    assert.equal(JSON.parse(stop.stdout).decision, "block");
  });
});

test("user-prompt-submit delegates pending Blueprint review to the native Claude Code session", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:01:00.000Z")
    });

    const result = runHook("hooks/claude/user-prompt-submit.mjs", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-natural-approval",
      prompt: "그 방향으로 갑시다"
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: "/plugin/makeitreal" }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(output.hookSpecificOutput.additionalContext, /Judge the latest user message yourself in this same Claude Code session/);
    assert.match(output.hookSpecificOutput.additionalContext, /--decision-json/);
    assert.match(output.hookSpecificOutput.additionalContext, /Do not use keyword heuristics/);
    assert.match(output.hookSpecificOutput.additionalContext, /Do not spawn `claude --print`/);
    assert.equal(output.makeitreal.action, "native-review-delegated");
    assert.equal(output.makeitreal.launchRequested, false);

    const review = await readBlueprintReview({ runDir });
    assert.equal(review.review.status, "pending");
    assert.equal(review.review.reviewSource, "makeitreal:plan");
  });
});

test("user-prompt-submit never writes approval evidence from keyword-looking text", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:01:00.000Z")
    });

    const result = runHook("hooks/claude/user-prompt-submit.mjs", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-negated-approval",
      prompt: "승인이라는 단어가 들어있지만 아직 판단하지 마세요"
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.equal(output.makeitreal.action, "native-review-delegated");

    const review = await readBlueprintReview({ runDir });
    assert.equal(review.review.status, "pending");
    assert.equal(review.review.reviewSource, "makeitreal:plan");
  });
});

test("user-prompt-submit is quiet when Blueprint review is already decided", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await decideBlueprintReview({
      runDir,
      status: "approved",
      reviewedBy: "operator:test",
      now: new Date("2026-05-06T00:01:00.000Z")
    });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:02:00.000Z")
    });

    const result = runHook("hooks/claude/user-prompt-submit.mjs", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-after-approval",
      prompt: "일반 채팅입니다"
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.continue, true);
    assert.equal(output.suppressOutput, true);
    assert.equal(output.hookSpecificOutput, undefined);
    assert.equal(output.makeitreal.action, "noop");
  });
});

test("user-prompt-submit delegates revision-looking replies without mutating review evidence", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:01:00.000Z")
    });

    const result = runHook("hooks/claude/user-prompt-submit.mjs", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-revision-requested",
      prompt: "아직 승인하지 말고 책임경계를 더 쪼개서 수정해주세요"
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.makeitreal.action, "native-review-delegated");
    assert.match(output.hookSpecificOutput.additionalContext, /revision_requested/);
    assert.match(output.hookSpecificOutput.additionalContext, /do not write review evidence/i);

    const review = await readBlueprintReview({ runDir });
    assert.equal(review.review.status, "pending");
    assert.equal(review.review.reviewSource, "makeitreal:plan");
    assert.equal(review.review.reviewedBy, null);
    assert.equal(review.review.revisionRequestedBy, undefined);
  });
});

test("user-prompt-submit passes short replies and assistant context to native review guidance", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:01:00.000Z")
    });
    const transcriptPath = `${root}/transcript.jsonl`;
    await writeFile(transcriptPath, `${JSON.stringify({
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Blueprint preview is ready. 이 Blueprint를 승인하고 시작할까요?" }]
      }
    })}\n`);

    const result = runHook("hooks/claude/user-prompt-submit.mjs", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-short-approval",
      prompt: "네",
      transcript_path: transcriptPath
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);

    const output = JSON.parse(result.stdout);
    assert.equal(output.makeitreal.action, "native-review-delegated");
    assert.match(output.hookSpecificOutput.additionalContext, /Latest user message:\n네/);
    assert.match(output.hookSpecificOutput.additionalContext, /Blueprint preview is ready/);

    const review = await readBlueprintReview({ runDir });
    assert.equal(review.review.status, "pending");
  });
});

test("user-prompt-submit remains native even for ambiguous short replies", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:01:00.000Z")
    });

    const result = runHook("hooks/claude/user-prompt-submit.mjs", {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-short-no-context",
      prompt: "네"
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.makeitreal.action, "native-review-delegated");
    assert.match(output.hookSpecificOutput.additionalContext, /If decision is none, continue the conversation normally/);

    const review = await readBlueprintReview({ runDir });
    assert.equal(review.review.status, "pending");
  });
});

test("pre-tool-use allows ordinary edits when active run context is missing", async () => {
  await withFixture(async ({ root }) => {
    const allowed = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Edit",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });

    assert.equal(allowed.status, 0, allowed.stdout || allowed.stderr);
    const output = JSON.parse(allowed.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /No active Make It Real enforcement context/);
  });
});

test("pre-tool-use allows unrelated edits when only an inactive current-run pointer exists", async () => {
  await withFixture(async ({ root, runDir }) => {
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    const allowed = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Edit",
      tool_input: { file_path: "tools-external/coder/src/middleware/token-auth.ts" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });

    assert.equal(allowed.status, 0, allowed.stdout || allowed.stderr);
    const output = JSON.parse(allowed.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /not executing/);
  });
});

test("pre-tool-use allows ordinary edits when current run is detached", async () => {
  await withFixture(async ({ root, runDir }) => {
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      enforcement: "detached",
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    const result = runHook("hooks/claude/pre-tool-use.mjs", {
      cwd: root,
      tool_name: "Edit",
      tool_input: { file_path: "unrelated/file.ts" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "allow");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /detached/);
  });
});

test("pre-tool-use enforces runner boundaries from MAKEITREAL_BOARD_DIR", async () => {
  await withFixture(async ({ root, runDir }) => {
    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Edit",
      tool_input: { file_path: "tools-external/coder/src/middleware/token-auth.ts" }
    }, {
      cwd: root,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        MAKEITREAL_BOARD_DIR: runDir,
        MAKEITREAL_WORK_ITEM_ID: "work.feature-auth",
        MAKEITREAL_WORKSPACE: root
      }
    });

    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    const output = JSON.parse(blocked.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /HARNESS_PATH_BOUNDARY_VIOLATION/);
  });
});

test("pre-tool-use uses explicit makeitreal hook context for concurrent native work", async () => {
  await withFixture(async ({ root, runDir }) => {
    const denied = runHook("hooks/claude/pre-tool-use.mjs", {
      cwd: root,
      makeitreal: { runDir, workItemId: "work.feature-auth" },
      tool_name: "Edit",
      tool_input: { file_path: "services/auth/private.ts" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(denied.status, 0, denied.stdout || denied.stderr);
    assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, "deny");

    const allowed = runHook("hooks/claude/pre-tool-use.mjs", {
      cwd: root,
      makeitreal: { runDir, workItemId: "work.feature-auth" },
      tool_name: "Edit",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(allowed.status, 0, allowed.stdout || allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision, "allow");
  });
});

test("pre-tool-use denies scoped native read of provider private implementation", async () => {
  await withFixture(async ({ root, runDir }) => {
    const result = runHook("hooks/claude/pre-tool-use.mjs", {
      cwd: root,
      makeitreal: {
        runDir,
        workItemId: "work.feature-auth",
        agentPacket: {
          scope: { responsibilityUnitId: "ru.frontend" },
          readScope: {
            requiredReads: ["prd.json", "design-pack.json"],
            forbiddenReads: ["services/auth/**"]
          }
        }
      },
      tool_name: "Read",
      tool_input: { file_path: "services/auth/private.ts" }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /HARNESS_READ_SCOPE_VIOLATION/);
  });
});

test("pre-tool-use normalizes absolute native tool paths against CLAUDE_PROJECT_DIR", async () => {
  await withFixture(async ({ root, runDir }) => {
    const allowed = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Write",
      tool_input: { file_path: path.join(root, "apps/web/auth/LoginForm.tsx") }
    }, {
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        MAKEITREAL_BOARD_DIR: runDir,
        MAKEITREAL_WORK_ITEM_ID: "work.feature-auth",
        MAKEITREAL_WORKSPACE: root
      }
    });

    assert.equal(allowed.status, 0, allowed.stdout || allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision, "allow");

    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Write",
      tool_input: { file_path: path.join(root, "services/auth/private.ts") }
    }, {
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        MAKEITREAL_BOARD_DIR: runDir,
        MAKEITREAL_WORK_ITEM_ID: "work.feature-auth",
        MAKEITREAL_WORKSPACE: root
      }
    });

    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    const output = JSON.parse(blocked.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /HARNESS_PATH_BOUNDARY_VIOLATION/);
  });
});

test("pre-tool-use blocks malformed Make It Real runner environments", async () => {
  await withFixture(async ({ root }) => {
    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Edit",
      tool_input: { file_path: "apps/web/auth/LoginForm.tsx" }
    }, {
      cwd: root,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: root,
        MAKEITREAL_WORK_ITEM_ID: "work.feature-auth"
      }
    });

    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    const output = JSON.parse(blocked.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /HARNESS_RUN_CONTEXT_MISSING/);
  });
});

test("pre-tool-use allows bootstrap Make It Real Bash commands without run context", async () => {
  await withFixture(async ({ root }) => {
    const setup = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Bash",
      tool_input: {
        command: `"${harnessRoot}/plugins/makeitreal/bin/makeitreal-engine" setup "$CLAUDE_PROJECT_DIR" 2>&1`
      }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });

    assert.equal(setup.status, 0, setup.stdout || setup.stderr);
    assert.equal(JSON.parse(setup.stdout).hookSpecificOutput.permissionDecision, "allow");
  });
});

test("pre-tool-use allows Make It Real control Bash while Blueprint approval is pending", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({
      projectRoot: root,
      runDir,
      now: new Date("2026-05-06T00:01:00.000Z")
    });

    const approve = runHook("hooks/claude/pre-tool-use.mjs", {
      tool_name: "Bash",
      tool_input: {
        command: `"${harnessRoot}/plugins/makeitreal/bin/makeitreal-engine" blueprint approve "${runDir}" --by operator:test`
      }
    }, {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });

    assert.equal(approve.status, 0, approve.stdout || approve.stderr);
    assert.equal(JSON.parse(approve.stdout).hookSpecificOutput.permissionDecision, "allow");
  });
});

test("pre-tool-use validates mutating Bash paths against the active run boundary", async () => {
  await withFixture(async ({ runDir }) => {
    const allowed = runHook("hooks/claude/pre-tool-use.mjs", {
      runDir,
      tool_name: "Bash",
      tool_input: { command: "mkdir -p apps/web/auth && echo ok > apps/web/auth/generated.txt" }
    });
    assert.equal(allowed.status, 0, allowed.stdout || allowed.stderr);
    assert.equal(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision, "allow");

    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      runDir,
      tool_name: "Bash",
      tool_input: { command: "echo ok > services/auth/private.txt" }
    });
    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.match(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecisionReason, /HARNESS_PATH_BOUNDARY_VIOLATION/);
  });
});

test("pre-tool-use blocks unstructured Bash mutations in an explicit run context", async () => {
  await withFixture(async ({ runDir }) => {
    const readOnly = runHook("hooks/claude/pre-tool-use.mjs", {
      runDir,
      tool_name: "Bash",
      tool_input: { command: "git diff -- apps/web/auth/LoginForm.tsx && npm test" }
    });
    assert.equal(readOnly.status, 0, readOnly.stdout || readOnly.stderr);
    assert.equal(JSON.parse(readOnly.stdout).hookSpecificOutput.permissionDecision, "allow");

    const blocked = runHook("hooks/claude/pre-tool-use.mjs", {
      runDir,
      tool_name: "Bash",
      tool_input: { command: "git apply feature.patch" }
    });
    assert.equal(blocked.status, 0, blocked.stdout || blocked.stderr);
    const output = JSON.parse(blocked.stdout);
    assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /HARNESS_BASH_WRITE_UNSUPPORTED/);
  });
});
