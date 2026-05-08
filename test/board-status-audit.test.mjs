import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readBoardStatus } from "../src/status/board-status.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { generatePlanRun } from "../src/plan/plan-generator.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-board-status-"));
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ root, boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function snapshot(paths) {
  const out = {};
  for (const filePath of paths) {
    try {
      out[filePath] = await readFile(filePath, "utf8");
    } catch {
      out[filePath] = null;
    }
  }
  return out;
}

test("board status preserves lane counts and reports approved audit", async () => {
  await withBoard(async ({ boardDir }) => {
    const result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:00.000Z") });
    assert.equal(result.ok, true);
    assert.deepEqual(result.laneCounts, { Done: 1, Ready: 2 });
    assert.equal(result.audit.ok, true);
    assert.equal(result.phase, "launch-ready");
    assert.equal(result.nextAction, "/makeitreal:launch");
  });
});

test("board status reports stale Blueprint work and is no-write", async () => {
  await withBoard(async ({ boardDir }) => {
    const watched = [
      path.join(boardDir, "board.json"),
      path.join(boardDir, "blueprint-review.json"),
      path.join(boardDir, "events.jsonl")
    ];
    const board = await readJsonFile(path.join(boardDir, "board.json"));
    board.workItems.push({
      id: "work.extra",
      title: "Extra",
      lane: "Ready",
      responsibilityUnitId: "ru.frontend",
      contractIds: ["contract.auth.login"],
      dependsOn: [],
      allowedPaths: ["apps/web/auth/**"]
    });
    await writeJsonFile(path.join(boardDir, "board.json"), board);
    const before = await snapshot(watched);

    const result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:00.000Z") });
    assert.equal(result.audit.ok, false);
    assert.equal(result.audit.staleBlueprintWorkItemIds.includes("work.login-ui"), true);
    assert.equal(result.audit.gateFailures[0].code, "HARNESS_BLUEPRINT_APPROVAL_STALE");
    assert.equal(result.phase, "approval-required");
    assert.equal(result.blockers[0].nextAction, "Approve the Blueprint in chat, or run /makeitreal:plan approve");
    assert.deepEqual(await snapshot(watched), before);
  });
});

test("board status blocks Contract Frozen planned work until Blueprint approval", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "harness-board-status-plan-"));
  try {
    const plan = await generatePlanRun({
      projectRoot,
      request: "Build a board status approval module",
      runId: "board-status-approval",
      allowedPaths: ["modules/board-status-approval/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('board status ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = await readBoardStatus({ boardDir: plan.runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    assert.equal(result.phase, "approval-required");
    assert.equal(result.blockers[0].code, "HARNESS_BLUEPRINT_APPROVAL_PENDING");
    assert.deepEqual(result.audit.blueprintBlockedWorkItemIds, [plan.workItemId]);
    assert.equal(result.nextAction, "Approve the Blueprint in chat, or run /makeitreal:plan approve");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});


test("board status reports unlinked and drifted board authority", async () => {
  await withBoard(async ({ boardDir }) => {
    await rm(path.join(boardDir, "blueprint-review.json"), { force: true });
    let result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:00.000Z") });
    assert.equal(result.audit.skipped, true);
    assert.equal(result.audit.code, "HARNESS_BLUEPRINT_AUDIT_UNLINKED");

    await cp(new URL("../examples/kanban/.makeitreal/board/blueprint-review.json", import.meta.url), path.join(boardDir, "blueprint-review.json"));
    const board = await readJsonFile(path.join(boardDir, "board.json"));
    board.blueprintRunDir = "../other-run";
    await writeJsonFile(path.join(boardDir, "board.json"), board);
    result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:00.000Z") });
    assert.equal(result.audit.skipped, true);
    assert.equal(result.audit.code, "HARNESS_BLUEPRINT_APPROVAL_DRIFT");
  });
});

test("board status explains Failed Fast retry and Rework without writing state", async () => {
  await withBoard(async ({ boardDir }) => {
    const watched = [
      path.join(boardDir, "board.json"),
      path.join(boardDir, "events.jsonl"),
      path.join(boardDir, "runtime-state.json")
    ];
    const boardPath = path.join(boardDir, "board.json");
    const board = await readJsonFile(boardPath);
    const workItem = board.workItems.find((item) => item.id === "work.login-ui");
    workItem.lane = "Failed Fast";
    workItem.nextRetryAt = "2026-05-06T00:00:01.000Z";
    workItem.errorCode = "HARNESS_CLAUDE_HOOK_FAILED";
    workItem.errorCategory = "hook-failure";
    workItem.errorReason = "Claude Code hook execution failed.";
    workItem.errorNextAction = "/makeitreal:doctor";
    workItem.latestAttemptId = "work.login-ui.1777996800000";
    await writeJsonFile(boardPath, board);
    const before = await snapshot(watched);

    let result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:00.000Z") });
    assert.equal(result.phase, "failed-fast");
    assert.equal(result.nextAction, "/makeitreal:doctor");
    assert.equal(result.blockers[0].code, "HARNESS_CLAUDE_HOOK_FAILED");
    assert.deepEqual(result.failedFast[0], {
      id: "work.login-ui",
      nextRetryAt: "2026-05-06T00:00:01.000Z",
      attemptNumber: null,
      errorCode: "HARNESS_CLAUDE_HOOK_FAILED",
      errorCategory: "hook-failure",
      errorReason: "Claude Code hook execution failed.",
      latestAttemptId: "work.login-ui.1777996800000"
    });
    assert.deepEqual(await snapshot(watched), before);

    result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:02.000Z") });
    assert.equal(result.phase, "failed-fast");
    assert.equal(result.nextAction, "/makeitreal:doctor");

    const timeoutBoard = await readJsonFile(boardPath);
    const timeoutItem = timeoutBoard.workItems.find((item) => item.id === "work.login-ui");
    timeoutItem.nextRetryAt = "2026-05-06T00:00:05.000Z";
    timeoutItem.errorCode = "HARNESS_CLAUDE_RUNNER_TIMEOUT";
    timeoutItem.errorCategory = "timeout";
    timeoutItem.errorReason = "Claude Code runner timed out.";
    timeoutItem.errorNextAction = "/makeitreal:launch";
    await writeJsonFile(boardPath, timeoutBoard);
    const timeoutBefore = await snapshot(watched);

    result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:02.000Z") });
    assert.equal(result.phase, "failed-fast");
    assert.equal(result.nextAction, "/makeitreal:status");
    assert.equal(result.blockers[0].nextAction, "/makeitreal:status");
    assert.deepEqual(await snapshot(watched), timeoutBefore);

    result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:06.000Z") });
    assert.equal(result.phase, "failed-fast");
    assert.equal(result.nextAction, "/makeitreal:launch");

    const reworkBoard = await readJsonFile(boardPath);
    const reworkItem = reworkBoard.workItems.find((item) => item.id === "work.login-ui");
    reworkItem.lane = "Rework";
    delete reworkItem.nextRetryAt;
    reworkItem.errorCode = "HARNESS_VERIFICATION_FAILED";
    await writeJsonFile(boardPath, reworkBoard);
    const reworkBefore = await snapshot(watched);

    result = await readBoardStatus({ boardDir, now: new Date("2026-05-06T00:00:02.000Z") });
    assert.equal(result.phase, "rework-required");
    assert.equal(result.blockers[0].code, "HARNESS_VERIFICATION_FAILED");
    assert.equal(result.nextAction, "/makeitreal:launch");
    assert.deepEqual(await snapshot(watched), reworkBefore);
  });
});
