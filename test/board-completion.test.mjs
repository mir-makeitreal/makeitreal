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

async function addGraphNodeWorkItem({ boardDir, workItem, node }) {
  const board = await loadBoard(boardDir);
  for (const item of board.workItems) {
    if (item.lane === "Ready") {
      item.lane = "Done";
    }
  }
  board.workItems.push(workItem);
  board.workItemDAG.nodes.push({
    workItemId: workItem.id,
    kind: node.kind,
    requiredForDone: node.requiredForDone !== false
  });
  await saveBoard(boardDir, board);

  const dagPath = path.join(boardDir, "work-item-dag.json");
  const dag = await readJsonFile(dagPath);
  dag.nodes.push({
    id: workItem.id,
    kind: node.kind,
    responsibilityUnitId: workItem.responsibilityUnitId,
    requiredForDone: node.requiredForDone !== false
  });
  await writeJsonFile(dagPath, dag);

  await writeJsonFile(path.join(boardDir, "work-items", `${workItem.id}.json`), {
    schemaVersion: "1.0",
    prdId: "prd.auth-kanban",
    ...workItem
  });

  const responsibilityPath = path.join(boardDir, "responsibility-units.json");
  const responsibilityUnits = await readJsonFile(responsibilityPath);
  responsibilityUnits.units.push({
    id: workItem.responsibilityUnitId,
    owner: node.kind === "domain-pm" ? "team.pm" : "team.verification",
    owns: workItem.allowedPaths ?? [],
    publicSurfaces: [workItem.title],
    mayUseContracts: workItem.contractIds ?? []
  });
  await writeJsonFile(responsibilityPath, responsibilityUnits);
}

function onlyNativeTask(started) {
  assert.equal(Object.hasOwn(started, "nativeTask"), false);
  assert.equal(Array.isArray(started.nativeTasks), true);
  assert.equal(started.nativeTasks.length, 1);
  return started.nativeTasks[0];
}

test("domain PM node completes from pm report without changed files", async () => {
  await withProjectBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    await addGraphNodeWorkItem({
      boardDir,
      node: { kind: "domain-pm" },
      workItem: {
        id: "work.auth-pm",
        title: "Coordinate auth responsibility split",
        lane: "Ready",
        responsibilityUnitId: "ru.auth-pm",
        contractIds: ["contract.auth.login"],
        dependsOn: [],
        allowedPaths: ["docs/auth/**"],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('pm ok')"] }],
        doneEvidence: [
          { kind: "verification", path: "evidence/work.auth-pm.verification.json" },
          { kind: "wiki-sync", path: "evidence/work.auth-pm.wiki-sync.json" }
        ]
      }
    });
    await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:domain-pm-node-test",
      now: new Date("2026-05-15T00:00:00.000Z")
    });

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      concurrency: 1,
      now: new Date("2026-05-15T00:00:00.000Z")
    });
    assert.equal(started.ok, true, JSON.stringify(started.errors));
    const task = onlyNativeTask(started);
    assert.equal(task.workItemId, "work.auth-pm");

    const finished = await finishNativeClaudeTask({
      boardDir,
      workItemId: "work.auth-pm",
      attemptId: task.attemptId,
      resultText: JSON.stringify({
        makeitrealPmReport: {
          role: "domain-pm",
          status: "DONE",
          summary: "No child split required.",
          childWorkProposal: null,
          workItemId: "work.auth-pm",
          attemptId: task.attemptId
        },
        makeitrealReviews: [{
          role: "spec-reviewer",
          status: "APPROVED",
          summary: "PM split is consistent with Blueprint.",
          findings: [],
          evidence: [],
          workItemId: "work.auth-pm",
          attemptId: task.attemptId
        }]
      }),
      now: new Date("2026-05-15T00:00:01.000Z")
    });
    assert.equal(finished.ok, true, JSON.stringify(finished.errors));
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.auth-pm").lane, "Verifying");
  });
});

test("integration evidence node completes with verification reviewer and no changed files", async () => {
  await withProjectBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    await addGraphNodeWorkItem({
      boardDir,
      node: { kind: "integration-evidence" },
      workItem: {
        id: "work.auth-integration-evidence",
        title: "Record auth integration evidence",
        lane: "Ready",
        responsibilityUnitId: "ru.auth-evidence",
        contractIds: ["contract.auth.login"],
        dependsOn: [],
        allowedPaths: ["evidence/**"],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('integration evidence ok')"] }],
        doneEvidence: [
          { kind: "verification", path: "evidence/work.auth-integration-evidence.verification.json" },
          { kind: "wiki-sync", path: "evidence/work.auth-integration-evidence.wiki-sync.json" }
        ]
      }
    });
    await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:integration-evidence-node-test",
      now: new Date("2026-05-15T00:00:00.000Z")
    });

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      concurrency: 1,
      now: new Date("2026-05-15T00:00:00.000Z")
    });
    assert.equal(started.ok, true, JSON.stringify(started.errors));
    const task = onlyNativeTask(started);
    assert.equal(task.workItemId, "work.auth-integration-evidence");

    const finished = await finishNativeClaudeTask({
      boardDir,
      workItemId: "work.auth-integration-evidence",
      attemptId: task.attemptId,
      resultText: JSON.stringify({
        makeitrealEvidenceReport: {
          role: "integration-evidence",
          status: "DONE",
          summary: "Integration evidence is ready for engine-owned verification.",
          tested: ["node -e integration evidence ok"],
          workItemId: "work.auth-integration-evidence",
          attemptId: task.attemptId
        },
        makeitrealReviews: [{
          role: "verification-reviewer",
          status: "APPROVED",
          summary: "Verification evidence path is sufficient.",
          findings: [],
          evidence: ["integration evidence fixture"],
          workItemId: "work.auth-integration-evidence",
          attemptId: task.attemptId
        }]
      }),
      now: new Date("2026-05-15T00:00:01.000Z")
    });
    assert.equal(finished.ok, true, JSON.stringify(finished.errors));

    const completed = await completeVerifiedWork({
      boardDir,
      workItemId: "work.auth-integration-evidence",
      runnerMode: "claude-code",
      now: new Date("2026-05-15T00:00:02.000Z")
    });
    assert.equal(completed.ok, true, JSON.stringify(completed.errors));
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.auth-integration-evidence").lane, "Done");
  });
});

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
  if (!started.ok || (started.nativeTasks ?? []).length === 0) {
    return started;
  }
  const nativeTask = onlyNativeTask(started);

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
    workItemId: nativeTask.workItemId,
    attemptId: nativeTask.attemptId,
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
    const nativeTask = onlyNativeTask(started);
    assert.equal(nativeTask.workItemId, "work.login-ui");
    assert.match(nativeTask.implementationPrompt, /Do not spawn a separate claude CLI process/);
    assert.deepEqual(nativeTask.reviewerPrompts.map((prompt) => prompt.role), [
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
      workItemId: nativeTask.workItemId,
      attemptId: nativeTask.attemptId,
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

test("native Claude start returns every unblocked ready node through nativeTasks", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const board = await loadBoard(boardDir);
    const auditWork = board.workItems.find((item) => item.id === "work.audit-log");
    auditWork.dependsOn = [];
    await saveBoard(boardDir, board);
    const approval = await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:native-batch-test",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(approval.ok, true);

    const started = await startNativeClaudeTask({
      boardDir,
      workerId: "claude-code.parent",
      concurrency: 2,
      now: new Date("2026-04-30T00:00:00.000Z")
    });

    assert.equal(started.ok, true);
    assert.equal(Object.hasOwn(started, "nativeTask"), false);
    assert.equal(started.nativeTasks.length, 2);
    assert.deepEqual(started.nativeTasks.map((task) => task.workItemId), [
      "work.login-ui",
      "work.audit-log"
    ]);
    assert.equal(started.nativeTasks.every((task) => task.implementationPrompt.includes("Do not spawn a separate claude CLI process")), true);

    const running = await loadBoard(boardDir);
    assert.equal(running.workItems.find((item) => item.id === "work.login-ui").lane, "Running");
    assert.equal(running.workItems.find((item) => item.id === "work.audit-log").lane, "Running");
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
    const nativeTask = onlyNativeTask(started);

    await mkdir(path.join(projectRoot, "apps/web/auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps/web/auth/native-output.txt"), "native parent task output\n");

    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "orchestrator",
      "native",
      "finish",
      boardDir,
      "--work",
      nativeTask.workItemId,
      "--attempt",
      nativeTask.attemptId,
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

    const attempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: nativeTask.workItemId });
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
    const nativeTask = onlyNativeTask(started);

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
      workItemId: nativeTask.workItemId,
      attemptId: nativeTask.attemptId,
      workerId: "claude-code.parent",
      resultText,
      now: new Date("2026-04-30T00:00:01.000Z")
    });
    assert.equal(finished.ok, true);

    const attempt = await latestSuccessfulRunAttempt({ boardDir, workItemId: nativeTask.workItemId });
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
    const nativeTask = onlyNativeTask(started);

    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "orchestrator",
      "native",
      "finish",
      boardDir,
      "--work",
      nativeTask.workItemId,
      "--attempt",
      nativeTask.attemptId,
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
    assert.equal(board.workItems.find((item) => item.id === nativeTask.workItemId).lane, "Failed Fast");
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
    const nativeTask = onlyNativeTask(started);

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
      workItemId: nativeTask.workItemId,
      attemptId: nativeTask.attemptId,
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

test("orchestrator completion sends work to Rework when Node test output executes zero tests", async () => {
  await withProjectBoard(async ({ projectRoot, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await mkdir(path.join(projectRoot, "apps", "web", "auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps", "web", "auth", "native-output.txt"), "inside native task");

    const board = await loadBoard(boardDir);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    workItem.verificationCommands = [{
      file: "node",
      args: ["-e", "console.log('> node --test test/*.test.mjs\\n\\nℹ tests 0\\nℹ suites 0\\nℹ pass 0\\nℹ fail 0')"]
    }];
    await saveBoard(boardDir, board);
    const approval = await decideBlueprintReview({
      runDir: boardDir,
      status: "approved",
      reviewedBy: "operator:zero-test-regression",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.equal(approval.ok, true, JSON.stringify(approval.errors));

    const dispatched = await dispatchNativeWork({
      boardDir,
      now: new Date("2026-04-30T00:00:00.000Z"),
      changedFiles: ["apps/web/auth/native-output.txt"]
    });
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched.errors));

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-04-30T00:00:01.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_VERIFICATION_NO_TESTS_EXECUTED");
    const completed = await loadBoard(boardDir);
    const completedItem = completed.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(completedItem.lane, "Rework");
    assert.equal(completedItem.errorCode, "HARNESS_VERIFICATION_NO_TESTS_EXECUTED");
    const evidence = await readJsonFile(path.join(boardDir, "evidence", "work.login-ui.verification.json"));
    assert.equal(evidence.ok, false);
    assert.match(evidence.commands[0].stdout, /tests 0/);
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
