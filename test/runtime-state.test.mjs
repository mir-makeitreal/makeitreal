import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadRuntimeState } from "../src/orchestrator/runtime-state.mjs";
import { orchestratorTick } from "../src/orchestrator/orchestrator.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-runtime-state-"));
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("runtime state records authoritative running and retry bookkeeping", async () => {
  await withBoard(async ({ boardDir }) => {
    await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-04-30T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_failed"]
    });

    const state = await loadRuntimeState(boardDir);
    assert.deepEqual(Object.keys(state.claimed), []);
    assert.deepEqual(Object.keys(state.running), []);
    assert.equal(state.retryAttempts["work.login-ui"].attemptNumber, 1);
    assert.equal(state.sessionMetrics.startedSessions, 1);
    assert.equal(state.sessionMetrics.failedTurns, 1);
  });
});
