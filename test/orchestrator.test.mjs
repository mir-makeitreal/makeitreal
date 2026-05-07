import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadBoard } from "../src/board/board-store.mjs";
import { getClaim } from "../src/board/claim-store.mjs";
import { writeJsonFile } from "../src/io/json.mjs";
import { orchestratorTick, reconcileBoard } from "../src/orchestrator/orchestrator.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-orchestrator-"));
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("tick dispatches only unblocked ready work within concurrency", async () => {
  await withBoard(async ({ boardDir }) => {
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 2,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_completed"]
    });
    assert.deepEqual(result.dispatchedWorkItemIds, ["work.login-ui"]);
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Verifying");
    assert.equal(board.workItems.find((item) => item.id === "work.audit-log").lane, "Ready");
  });
});

test("failed turn moves run attempt to Failed Fast and schedules retry", async () => {
  await withBoard(async ({ boardDir }) => {
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_failed"]
    });
    assert.deepEqual(result.retryWorkItemIds, ["work.login-ui"]);
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Failed Fast");
    assert.equal(
      board.workItems.find((item) => item.id === "work.login-ui").nextRetryAt,
      "2026-04-30T00:00:01.000Z"
    );
  });
});

test("reconcile releases terminal active claims", async () => {
  await withBoard(async ({ boardDir }) => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    await writeJsonFile(path.join(boardDir, "claims", "work.auth-contract.json"), {
      workItemId: "work.auth-contract",
      workerId: "worker.auth",
      responsibilityUnitId: "ru.auth-service",
      claimedAt: now.toISOString(),
      leaseExpiresAt: "2026-04-30T00:01:00.000Z"
    });
    assert.equal((await getClaim({ boardDir, workItemId: "work.auth-contract", now })).workerId, "worker.auth");
    const result = await reconcileBoard({ boardDir, now: new Date("2026-04-30T00:00:02.000Z") });
    assert.equal(result.ok, true);
    assert.deepEqual(result.releasedClaimWorkItemIds, ["work.auth-contract"]);
    assert.equal(await getClaim({
      boardDir,
      workItemId: "work.auth-contract",
      now: new Date("2026-04-30T00:00:02.000Z")
    }), null);
  });
});

test("tick surfaces claim conflicts", async () => {
  await withBoard(async ({ boardDir }) => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    await writeJsonFile(path.join(boardDir, "claims", "work.login-ui.json"), {
      workItemId: "work.login-ui",
      workerId: "worker.other",
      responsibilityUnitId: "ru.frontend",
      claimedAt: now.toISOString(),
      leaseExpiresAt: "2026-04-30T00:01:00.000Z"
    });

    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now,
      runnerScript: ["session_started", "turn_completed"]
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_CLAIM_CONFLICT");
  });
});

test("tick rejects unapproved work without dispatch writes", async () => {
  await withBoard(async ({ boardDir }) => {
    await rm(path.join(boardDir, "blueprint-review.json"), { force: true });
    const boardBefore = await readFile(path.join(boardDir, "board.json"), "utf8");
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_completed"]
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_BLUEPRINT_AUDIT_UNLINKED");
    assert.deepEqual(result.dispatchedWorkItemIds, []);
    assert.equal(await readFile(path.join(boardDir, "board.json"), "utf8"), boardBefore);
    await assert.rejects(readFile(path.join(boardDir, "claims", "work.login-ui.json"), "utf8"));
    await assert.rejects(readFile(path.join(boardDir, "events.jsonl"), "utf8"));
    await assert.rejects(readFile(path.join(boardDir, "runtime-state.json"), "utf8"));
  });
});

test("reconcile moves retry-ready failed fast work back to Ready", async () => {
  await withBoard(async ({ boardDir }) => {
    await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_failed"]
    });
    const result = await reconcileBoard({ boardDir, now: new Date("2026-04-30T00:00:02.000Z") });
    assert.equal(result.ok, true);
    assert.deepEqual(result.retryReadyWorkItemIds, ["work.login-ui"]);
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Ready");
  });
});
