import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readRunAttempt } from "../src/orchestrator/attempt-store.mjs";
import { runScriptedAttempt } from "../src/orchestrator/runner-simulator.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-runner-"));
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("scripted runner writes attempt events", async () => {
  await withBoard(async ({ boardDir }) => {
    const result = await runScriptedAttempt({
      boardDir,
      workItem: { id: "work.login-ui" },
      workerId: "worker.frontend",
      now: new Date("2026-04-30T00:00:00.000Z"),
      script: ["session_started", "turn_completed"]
    });
    assert.equal(result.ok, true);
    const log = await readFile(path.join(boardDir, "events.jsonl"), "utf8");
    assert.match(log, /session_started/);
    assert.match(log, /turn_completed/);
    const attempt = await readRunAttempt({ boardDir, attemptId: result.attemptId });
    assert.equal(attempt.workItemId, "work.login-ui");
    assert.equal(attempt.workerId, "worker.frontend");
    assert.equal(attempt.status, "completed");
    assert.deepEqual(attempt.events, ["session_started", "turn_completed"]);
  });
});

test("scripted runner rejects unknown events and unsafe workspaces", async () => {
  await withBoard(async ({ boardDir }) => {
    const unknown = await runScriptedAttempt({
      boardDir,
      workItem: { id: "work.login-ui" },
      workerId: "worker.frontend",
      now: new Date("2026-04-30T00:00:00.000Z"),
      script: ["turn_typo"]
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.errors[0].code, "HARNESS_RUNNER_EVENT_UNKNOWN");

    const escaped = await runScriptedAttempt({
      boardDir,
      workItem: { id: "../escape" },
      workerId: "worker.frontend",
      now: new Date("2026-04-30T00:00:00.000Z"),
      script: ["session_started"]
    });
    assert.equal(escaped.ok, false);
    assert.equal(escaped.errors[0].code, "HARNESS_WORKSPACE_ESCAPE");
  });
});
