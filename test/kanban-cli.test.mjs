import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { minimalProposal } from "./helpers/blueprint-import.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-cli-board-"));
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function runHarness(args, options = {}) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    ...options
  });
}

test("board ready and orchestrator tick work through CLI", async () => {
  await withBoard(async ({ boardDir }) => {
    const status = runHarness(["board", "status", boardDir]);
    assert.equal(status.status, 0, status.stdout || status.stderr);
    assert.equal(JSON.parse(status.stdout).boardId, "board.auth");
    assert.deepEqual(JSON.parse(status.stdout).laneCounts, { Done: 1, Ready: 2 });

    const ready = runHarness(["board", "ready", boardDir]);
    assert.equal(ready.status, 0, ready.stdout || ready.stderr);
    assert.deepEqual(JSON.parse(ready.stdout).workItemIds, ["work.login-ui"]);

    const blockedClaim = runHarness(["board", "claim", boardDir, "--work", "work.audit-log", "--worker", "worker.audit"]);
    assert.equal(blockedClaim.status, 1, blockedClaim.stdout || blockedClaim.stderr);
    assert.equal(JSON.parse(blockedClaim.stdout).errors[0].code, "HARNESS_WORK_BLOCKED");

    const claim = runHarness(["board", "claim", boardDir, "--work", "work.login-ui", "--worker", "worker.frontend"]);
    assert.equal(claim.status, 0, claim.stdout || claim.stderr);
    assert.equal(JSON.parse(claim.stdout).workItemId, "work.login-ui");
    assert.equal(JSON.parse(claim.stdout).claim.responsibilityUnitId, "ru.frontend");

    const missingWork = runHarness(["board", "claim", boardDir, "--worker", "worker.frontend"]);
    assert.equal(missingWork.status, 1, missingWork.stdout || missingWork.stderr);
    assert.equal(JSON.parse(missingWork.stdout).errors[0].code, "HARNESS_WORK_ID_REQUIRED");

    const mailbox = runHarness([
      "board",
      "mailbox",
      "send",
      boardDir,
      "--from",
      "worker.frontend",
      "--to",
      "worker.auth",
      "--work",
      "work.login-ui",
      "--message",
      "contract.auth.login verified"
    ]);
    assert.equal(mailbox.status, 0, mailbox.stdout || mailbox.stderr);
    assert.equal(JSON.parse(mailbox.stdout).toWorkerId, "worker.auth");

    const reconcile = runHarness(["orchestrator", "reconcile", boardDir]);
    assert.equal(reconcile.status, 0, reconcile.stdout || reconcile.stderr);
    assert.deepEqual(JSON.parse(reconcile.stdout).releasedClaimWorkItemIds, []);

    const tick = runHarness(["orchestrator", "tick", boardDir, "--concurrency", "2"]);
    assert.equal(tick.status, 0, tick.stdout || tick.stderr);
    const tickOutput = JSON.parse(tick.stdout);
    assert.deepEqual(tickOutput.dispatchedWorkItemIds, []);
    assert.equal(tickOutput.dashboardRefresh.attempted, true);
    assert.equal(tickOutput.dashboardRefresh.skipped, false);
    assert.equal(tickOutput.dashboardRefreshBefore.attempted, true);
  });
});

test("orchestrator reconcile can advance retry time through CLI", async () => {
  await withBoard(async ({ boardDir }) => {
    const boardPath = path.join(boardDir, "board.json");
    const board = await readJsonFile(boardPath);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    workItem.lane = "Failed Fast";
    workItem.nextRetryAt = "2026-04-30T00:00:01.000Z";
    await writeJsonFile(boardPath, board);

    const result = runHarness([
      "orchestrator",
      "reconcile",
      boardDir,
      "--now",
      "2026-04-30T00:00:02.000Z"
    ]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).retryReadyWorkItemIds, ["work.login-ui"]);
  });
});

test("freshly planned and approved run can enter Ready through public CLI path", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "harness-cli-planned-"));
  try {
    const workItemId = "work.launchable-report";
    const runDir = path.join(projectRoot, ".makeitreal", "runs", "launchable-report");
    const proposal = minimalProposal({
      title: "Launchable Report Module",
      moduleName: "launchable-report",
      allowedPaths: ["modules/launchable-report/**"],
      verifyCommand: "node -e console.log('report ok')"
    });

    // Claude Code produces the BlueprintProposal; the engine validates+writes it.
    // scripted-simulator matches the runner used by the public `orchestrator tick` CLI.
    const imported = runHarness(
      ["blueprint", "import", runDir, "--run", "launchable-report", "--runner", "scripted-simulator"],
      { input: JSON.stringify(proposal) }
    );
    assert.equal(imported.status, 0, imported.stdout || imported.stderr);
    const importOutput = JSON.parse(imported.stdout);
    assert.equal(importOutput.ok, true);
    assert.equal(importOutput.runDir, runDir);

    // Freshly imported run is not implementation-ready until the Blueprint is approved.
    const preApprovalGate = runHarness(["gate", runDir, "--target", "Ready"]);
    assert.equal(preApprovalGate.status, 1, preApprovalGate.stdout || preApprovalGate.stderr);

    const board = await readJsonFile(path.join(runDir, "board.json"));
    assert.equal(board.workItems[0].lane, "Contract Frozen");
    assert.equal(board.workItems[0].id, workItemId);

    const approve = runHarness([
      "blueprint",
      "approve",
      runDir,
      "--by",
      "operator:test"
    ]);
    assert.equal(approve.status, 0, approve.stdout || approve.stderr);

    const readyGate = runHarness(["gate", runDir, "--target", "Ready"]);
    assert.equal(readyGate.status, 0, readyGate.stdout || readyGate.stderr);

    // Doctrine: the engine emits only runnerMode/realAgentLaunch; the operator/blueprint
    // declares the runner security posture the public `orchestrator tick` requires.
    await writeJsonFile(path.join(runDir, "trust-policy.json"), {
      schemaVersion: "1.0",
      runnerMode: "scripted-simulator",
      runId: "launchable-report",
      realAgentLaunch: "disabled",
      commandExecution: "trusted-fixture-only",
      userInputRequired: "fail-fast",
      unsupportedToolCall: "fail-fast"
    });

    const tick = runHarness(["orchestrator", "tick", runDir, "--concurrency", "1"]);
    assert.equal(tick.status, 0, tick.stdout || tick.stderr);
    assert.deepEqual(JSON.parse(tick.stdout).promotedWorkItemIds, [workItemId]);
    assert.deepEqual(JSON.parse(tick.stdout).dispatchedWorkItemIds, [workItemId]);

    const launchedBoard = await readJsonFile(path.join(runDir, "board.json"));
    assert.equal(launchedBoard.workItems[0].lane, "Verifying");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
