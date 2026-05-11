import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadBoard, saveBoard } from "../src/board/board-store.mjs";
import { decideBlueprintReview } from "../src/blueprint/review.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { latestSuccessfulRunAttempt } from "../src/orchestrator/attempt-store.mjs";
import { completeVerifiedWork } from "../src/orchestrator/board-completion.mjs";
import { finishNativeClaudeTask, orchestratorTick, startNativeClaudeTask } from "../src/orchestrator/orchestrator.mjs";
import { loadRuntimeState } from "../src/orchestrator/runtime-state.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-board-completion-"));
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ root, boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withProjectBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-board-completion-project-"));
  const projectRoot = path.join(root, "project");
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(projectRoot, ".makeitreal", "runs", "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ root, projectRoot, boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function enableClaudeRunner(boardDir) {
  await writeJsonFile(path.join(boardDir, "trust-policy.json"), {
    schemaVersion: "1.0",
    runnerMode: "claude-code",
    realAgentLaunch: "enabled",
    approvalPolicy: "never",
    sandbox: "workspace-only",
    commandExecution: "structured-command-only",
    userInputRequired: "fail-fast",
    unsupportedToolCall: "fail-fast"
  });
}

async function dispatchNativeWork({
  boardDir,
  now,
  workerId = "claude-code.parent",
  changedFiles = ["apps/web/auth/native-output.txt"],
  reviewStatus = "APPROVED"
}) {
  const started = await startNativeClaudeTask({
    boardDir,
    workerId,
    now
  });
  if (!started.ok || !started.nativeTask) {
    return started;
  }

  const resultText = JSON.stringify({
    makeitrealReport: {
      role: "implementation-worker",
      status: "DONE",
      summary: "Implemented through parent-session native Claude Code Task.",
      changedFiles,
      tested: ["native task fixture"],
      concerns: [],
      needsContext: [],
      blockers: []
    },
    makeitrealReviews: ["spec-reviewer", "quality-reviewer", "verification-reviewer"].map((role) => ({
      role,
      status: reviewStatus,
      summary: `${role} approved native task output.`,
      findings: [],
      evidence: ["native task fixture"]
    }))
  });

  const finished = await finishNativeClaudeTask({
    boardDir,
    workItemId: started.nativeTask.workItemId,
    attemptId: started.nativeTask.attemptId,
    workerId,
    resultText,
    now: new Date(now.getTime() + 1000)
  });
  return { ...finished, started };
}

test("orchestrator completion owns board verification, wiki sync, and Done transition", async () => {
  await withBoard(async ({ boardDir }) => {
    await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_completed"]
    });

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, true);
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Done");
    const state = await loadRuntimeState(boardDir);
    assert.equal(state.completedBookkeeping["work.login-ui"].workItemId, "work.login-ui");
  });
});

test("orchestrator completion skips live wiki when disabled by project config", async () => {
  await withBoard(async ({ root, boardDir }) => {
    const projectRunDir = path.join(root, "project", ".makeitreal", "runs", "board");
    await cp(boardDir, projectRunDir, { recursive: true });
    await writeJsonFile(path.join(root, "project", ".makeitreal", "config.json"), {
      schemaVersion: "1.0",
      features: {
        liveWiki: { enabled: false }
      }
    });

    await orchestratorTick({
      boardDir: projectRunDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_completed"]
    });

    const result = await completeVerifiedWork({
      boardDir: projectRunDir,
      workItemId: "work.login-ui",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.wikiSkipped, true);
    assert.equal(result.wikiPath, null);

    const wikiEvidence = await readJsonFile(path.join(projectRunDir, "evidence", "work.login-ui.wiki-sync.json"));
    assert.equal(wikiEvidence.skipped, true);
    const state = await loadRuntimeState(projectRunDir);
    assert.equal(state.completedBookkeeping["work.login-ui"].wikiPath, null);
  });
});

test("orchestrator completion does not claim Done when launch dashboard refresh fails", async () => {
  await withBoard(async ({ boardDir }) => {
    await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_completed"]
    });

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      now: new Date("2026-04-30T00:00:01.000Z"),
      refreshBeforeDone: async () => ({
        ok: false,
        dashboardRefresh: {
          attempted: true,
          skipped: false,
          reason: null,
          configPath: null,
          previewDir: path.join(boardDir, "preview"),
          generatedAt: "2026-04-30T00:00:01.000Z",
          errors: [{ code: "HARNESS_DASHBOARD_REFRESH_FAILED", reason: "test failure", contractId: null, ownerModule: null, evidence: [], recoverable: true }]
        },
        errors: [{ code: "HARNESS_DASHBOARD_REFRESH_FAILED", reason: "test failure", contractId: null, ownerModule: null, evidence: [], recoverable: true }]
      })
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_DASHBOARD_REFRESH_FAILED");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Human Review");
    const state = await loadRuntimeState(boardDir);
    assert.equal(state.completedBookkeeping["work.login-ui"], undefined);
  });
});

test("orchestrator completion rejects claude-code work without successful attempt provenance", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const board = await loadBoard(boardDir);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    workItem.lane = "Verifying";
    await saveBoard(boardDir, board);

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_COMPLETION_ATTEMPT_MISSING");
  });
});

test("orchestrator completion accepts claude-code trust policy after native Task dispatch", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const dispatched = await dispatchNativeWork({
      boardDir,
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(dispatched.ok, true);

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, true);
    const attempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: "work.login-ui" });
    assert.deepEqual(attempt.runner.reviewReports.map((report) => report.role), [
      "spec-reviewer",
      "quality-reviewer",
      "verification-reviewer"
    ]);
    const completed = await loadBoard(boardDir);
    const workItem = completed.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(workItem.lane, "Done");
  });
});

test("parent-session native Claude task reaches completion without spawning child claude", async () => {
  await withProjectBoard(async ({ projectRoot, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const board = await loadBoard(boardDir);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    workItem.verificationCommands = [{
      file: "node",
      args: ["-e", "require('node:fs').accessSync('apps/web/auth/native-output.txt'); console.log('native ok')"]
    }];
    await saveBoard(boardDir, board);
    const approval = await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:native-task-test",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(approval.ok, true);

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(started.ok, true);
    assert.equal(started.nativeTask.workItemId, "work.login-ui");
    assert.match(started.nativeTask.implementationPrompt, /Do not spawn a separate claude CLI process/);
    assert.deepEqual(started.nativeTask.reviewerPrompts.map((prompt) => prompt.role), [
      "spec-reviewer",
      "quality-reviewer",
      "verification-reviewer"
    ]);

    await mkdir(path.join(projectRoot, "apps/web/auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps/web/auth/native-output.txt"), "native parent task output\n");

    const resultText = JSON.stringify({
      makeitrealReport: {
        role: "implementation-worker",
        status: "DONE",
        summary: "Implemented native parent task output.",
        changedFiles: ["apps/web/auth/native-output.txt"],
        tested: ["node -e accessSync native-output"],
        concerns: [],
        needsContext: [],
        blockers: []
      },
      makeitrealReviews: ["spec-reviewer", "quality-reviewer", "verification-reviewer"].map((role) => ({
        role,
        status: "APPROVED",
        summary: `${role} approved native parent task output.`,
        findings: [],
        evidence: ["native parent task fixture"]
      }))
    });

    const finished = await finishNativeClaudeTask({
      boardDir,
      workItemId: started.nativeTask.workItemId,
      attemptId: started.nativeTask.attemptId,
      workerId: "claude-code.parent",
      resultText,
      now: new Date("2026-04-30T00:00:01.000Z")
    });
    assert.equal(finished.ok, true);

    const verifying = await loadBoard(boardDir);
    assert.equal(verifying.workItems.find((item) => item.id === "work.login-ui").lane, "Verifying");
    const attempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: "work.login-ui" });
    assert.equal(attempt.runner.channel, "parent-native-task");
    assert.equal(attempt.runner.executable, undefined);

    const completed = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:02.000Z")
    });
    assert.equal(completed.ok, true);
    const evidence = await readJsonFile(completed.evidencePath);
    assert.equal(evidence.commands[0].cwd, projectRoot);
  });
});

test("native finish CLI can build reports from shorthand flags", async () => {
  await withProjectBoard(async ({ projectRoot, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const approval = await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:native-finish-shorthand-test",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(approval.ok, true);

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(started.ok, true);

    await mkdir(path.join(projectRoot, "apps/web/auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps/web/auth/native-output.txt"), "native parent task output\n");

    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "orchestrator",
      "native",
      "finish",
      boardDir,
      "--work",
      started.nativeTask.workItemId,
      "--attempt",
      started.nativeTask.attemptId,
      "--summary",
      "Implemented shorthand result.",
      "--changed-file",
      "apps/web/auth/native-output.txt",
      "--tested",
      "manual native shorthand test",
      "--review",
      "spec-reviewer=APPROVED",
      "--review",
      "quality-reviewer=APPROVED",
      "--review",
      "verification-reviewer=APPROVED"
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);

    const attempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: started.nativeTask.workItemId });
    assert.equal(attempt.runner.agentReports[0].summary, "Implemented shorthand result.");
    assert.deepEqual(attempt.runner.agentReports[0].changedFiles, ["apps/web/auth/native-output.txt"]);
    assert.deepEqual(attempt.runner.reviewReports.map((review) => review.role), [
      "spec-reviewer",
      "quality-reviewer",
      "verification-reviewer"
    ]);
  });
});

test("native finish accepts Claude Task reviewer arrays under reviews", async () => {
  await withProjectBoard(async ({ projectRoot, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const approval = await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:native-reviews-alias-test",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(approval.ok, true);

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(started.ok, true);

    await mkdir(path.join(projectRoot, "apps/web/auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps/web/auth/native-output.txt"), "native parent task output\n");

    const resultText = JSON.stringify({
      makeitrealReport: {
        role: "implementation-worker",
        status: "DONE",
        summary: "Implemented native parent task output.",
        changedFiles: ["apps/web/auth/native-output.txt"],
        tested: ["node -e accessSync native-output"],
        concerns: [],
        needsContext: [],
        blockers: []
      },
      reviews: ["spec-reviewer", "quality-reviewer", "verification-reviewer"].map((role) => ({
        makeitrealReview: {
          role,
          status: "APPROVED",
          summary: `${role} approved native parent task output.`,
          findings: [],
          evidence: ["native parent task fixture"]
        }
      }))
    });

    const finished = await finishNativeClaudeTask({
      boardDir,
      workItemId: started.nativeTask.workItemId,
      attemptId: started.nativeTask.attemptId,
      workerId: "claude-code.parent",
      resultText,
      now: new Date("2026-04-30T00:00:01.000Z")
    });
    assert.equal(finished.ok, true);

    const attempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: started.nativeTask.workItemId });
    assert.deepEqual(attempt.runner.reviewReports.map((review) => review.role), [
      "spec-reviewer",
      "quality-reviewer",
      "verification-reviewer"
    ]);
  });
});

test("native finish shorthand treats blockers as failed fast", async () => {
  await withProjectBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const approval = await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:native-finish-blocker-test",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(approval.ok, true);

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(started.ok, true);

    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "orchestrator",
      "native",
      "finish",
      boardDir,
      "--work",
      started.nativeTask.workItemId,
      "--attempt",
      started.nativeTask.attemptId,
      "--summary",
      "Blocked on missing contract decision.",
      "--status",
      "DONE",
      "--blocker",
      "missing contract decision",
      "--review",
      "spec-reviewer=APPROVED",
      "--review",
      "quality-reviewer=APPROVED",
      "--review",
      "verification-reviewer=APPROVED"
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 1, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.errors[0].code, "HARNESS_AGENT_BLOCKED");

    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === started.nativeTask.workItemId).lane, "Failed Fast");
  });
});

test("orchestrator complete retries Rework verification after environment recovery", async () => {
  await withProjectBoard(async ({ projectRoot, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const board = await loadBoard(boardDir);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    workItem.verificationCommands = [{
      file: "node",
      args: ["-e", "require('node:fs').accessSync('apps/web/auth/recovered-output.txt'); console.log('recovered ok')"]
    }];
    await saveBoard(boardDir, board);
    const approval = await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:rework-recovery-test",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(approval.ok, true);

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(started.ok, true);

    const resultText = JSON.stringify({
      makeitrealReport: {
        role: "implementation-worker",
        status: "DONE",
        summary: "Implementation is present but verification environment is not ready yet.",
        changedFiles: ["apps/web/auth/recovered-output.txt"],
        tested: [],
        concerns: [],
        needsContext: [],
        blockers: []
      },
      makeitrealReviews: ["spec-reviewer", "quality-reviewer", "verification-reviewer"].map((role) => ({
        role,
        status: "APPROVED",
        summary: `${role} approved recovery fixture.`,
        findings: [],
        evidence: ["native parent task fixture"]
      }))
    });

    const finished = await finishNativeClaudeTask({
      boardDir,
      workItemId: started.nativeTask.workItemId,
      attemptId: started.nativeTask.attemptId,
      workerId: "claude-code.parent",
      resultText,
      now: new Date("2026-04-30T00:00:01.000Z")
    });
    assert.equal(finished.ok, true);

    const failedComplete = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:02.000Z")
    });
    assert.equal(failedComplete.ok, false);
    assert.equal(failedComplete.errors[0].code, "HARNESS_VERIFICATION_COMMAND_FAILED");
    const reworkBoard = await loadBoard(boardDir);
    assert.equal(reworkBoard.workItems.find((item) => item.id === "work.login-ui").lane, "Rework");

    await mkdir(path.join(projectRoot, "apps/web/auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps/web/auth/recovered-output.txt"), "environment recovered\n");

    const recovered = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:03.000Z")
    });
    assert.equal(recovered.ok, true);
    const completed = await loadBoard(boardDir);
    const completedItem = completed.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(completedItem.lane, "Done");
    assert.equal(completedItem.errorCode, undefined);
    const evidence = await readJsonFile(recovered.evidencePath);
    assert.equal(evidence.ok, true);
    assert.equal(evidence.commands[0].exitCode, 0);
  });
});

test("orchestrator completion requires approved dynamic reviewer evidence for claude-code work", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const dispatched = await dispatchNativeWork({
      boardDir,
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(dispatched.ok, true);

    const latestAttempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: "work.login-ui" });
    const attemptPath = path.join(boardDir, "attempts", `${latestAttempt.attemptId}.json`);
    const attempt = await readJsonFile(attemptPath);
    attempt.runner.reviewReports = [];
    await writeJsonFile(attemptPath, attempt);

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_REVIEW_EVIDENCE_MISSING");
    const board = await loadBoard(boardDir);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(workItem.lane, "Rework");
    assert.equal(workItem.errorCode, "HARNESS_REVIEW_EVIDENCE_MISSING");
  });
});

test("orchestrator completion rejects failed dynamic reviewer evidence for claude-code work", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const dispatched = await dispatchNativeWork({
      boardDir,
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(dispatched.ok, true);

    const latestAttempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: "work.login-ui" });
    const attemptPath = path.join(boardDir, "attempts", `${latestAttempt.attemptId}.json`);
    const attempt = await readJsonFile(attemptPath);
    attempt.runner.reviewReports = attempt.runner.reviewReports.map((report) =>
      report.role === "quality-reviewer" ? { ...report, status: "REJECTED" } : report
    );
    await writeJsonFile(attemptPath, attempt);

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_REVIEW_REJECTED");
    assert.match(result.errors[0].reason, /quality-reviewer/);
  });
});

test("orchestrator completion verifies native Claude task output in the real project root", async () => {
  await withProjectBoard(async ({ projectRoot, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await mkdir(path.join(projectRoot, "apps", "web", "auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps", "web", "auth", "native-output.txt"), "inside native task");
    const dispatched = await dispatchNativeWork({
      boardDir,
      now: new Date("2026-04-30T00:00:00.000Z"),
      changedFiles: ["apps/web/auth/native-output.txt"]
    });
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched.errors));
    assert.equal(await readFile(path.join(projectRoot, "apps", "web", "auth", "native-output.txt"), "utf8"), "inside native task");

    const board = await loadBoard(boardDir);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    workItem.verificationCommands = [{
      file: process.execPath,
      args: ["-e", "const fs = require('fs'); const text = fs.readFileSync('apps/web/auth/native-output.txt', 'utf8'); if (text !== 'inside native task') process.exit(7);"]
    }];
    await saveBoard(boardDir, board);

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const evidence = await readJsonFile(path.join(boardDir, "evidence", "work.login-ui.verification.json"));
    assert.equal(evidence.commands[0].cwd, projectRoot);
    const completed = await loadBoard(boardDir);
    assert.equal(completed.workItems.find((item) => item.id === "work.login-ui").lane, "Done");
  });
});

test("orchestrator completion rejects non-native claude-code attempt provenance", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    await dispatchNativeWork({
      boardDir,
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    const attemptPath = path.join(boardDir, "attempts", "work.login-ui.1778025600000.json");
    const attempt = await readJsonFile(attemptPath);
    attempt.runner.channel = "headless-claude-cli";
    await writeJsonFile(attemptPath, attempt);

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-05-06T00:00:01.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_COMPLETION_ATTEMPT_PROVENANCE_MISSING");
    assert.match(result.errors[0].reason, /parent-session native Task/);
  });
});

test("orchestrator completion accepts claude-code trust policy through CLI", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const dispatched = await dispatchNativeWork({
      boardDir,
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(dispatched.ok, true);

    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "orchestrator",
      "complete",
      boardDir,
      "--work",
      "work.login-ui",
      "--runner",
      "claude-code"
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.workItemId, "work.login-ui");

    const completed = await loadBoard(boardDir);
    assert.equal(completed.workItems.find((item) => item.id === "work.login-ui").lane, "Done");
  });
});
