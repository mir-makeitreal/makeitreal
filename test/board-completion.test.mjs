import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadBoard, saveBoard } from "../src/board/board-store.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { completeVerifiedWork } from "../src/orchestrator/board-completion.mjs";
import { orchestratorTick } from "../src/orchestrator/orchestrator.mjs";
import { loadRuntimeState } from "../src/orchestrator/runtime-state.mjs";

const SAFE_CLAUDE_TOOLS = "Read,Write,Edit,MultiEdit,Glob,Grep,LS";
const VALID_CLAUDE_ARGS = [
  "--print",
  "--output-format",
  "json",
  "--permission-mode",
  "dontAsk",
  "--allowedTools",
  SAFE_CLAUDE_TOOLS,
  "--add-dir",
  "${workspace}",
  "--",
  "${prompt}"
];

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

async function writeFakeClaude(root) {
  const filePath = path.join(root, "claude");
  await writeFile(filePath, `#!/usr/bin/env node
const fs = require('fs');
fs.mkdirSync('apps/web/auth', { recursive: true });
fs.writeFileSync('apps/web/auth/runner-output.txt', 'inside boundary');
console.log(JSON.stringify({ event: 'turn_completed' }));
`, "utf8");
  await chmod(filePath, 0o755);
}

async function withFakeClaudeOnPath(root, callback) {
  const previousPath = process.env.PATH;
  process.env.PATH = `${root}${path.delimiter}${previousPath}`;
  try {
    return await callback();
  } finally {
    process.env.PATH = previousPath;
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

async function dispatchClaudeWork({ root, boardDir, now }) {
  await writeFakeClaude(root);
  return withFakeClaudeOnPath(root, () => orchestratorTick({
    boardDir,
    workerId: "worker.frontend",
    concurrency: 1,
    now,
    runnerMode: "claude-code",
    runnerCommand: {
      file: "claude",
      args: VALID_CLAUDE_ARGS
    }
  }));
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

test("orchestrator completion accepts claude-code trust policy after real runner dispatch", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const dispatched = await dispatchClaudeWork({
      root,
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
    const completed = await loadBoard(boardDir);
    assert.equal(completed.workItems.find((item) => item.id === "work.login-ui").lane, "Done");
  });
});

test("orchestrator completion requires claude-code executable provenance", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await dispatchClaudeWork({
      root,
      boardDir,
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    const attemptPath = path.join(boardDir, "attempts", "work.login-ui.1778025600000.json");
    const attempt = await readJsonFile(attemptPath);
    delete attempt.runner.executable;
    await writeJsonFile(attemptPath, attempt);

    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      runnerMode: "claude-code",
      now: new Date("2026-05-06T00:00:01.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_COMPLETION_ATTEMPT_PROVENANCE_MISSING");
    assert.match(result.errors[0].reason, /executable identity/);
  });
});

test("orchestrator completion accepts claude-code trust policy through CLI", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const dispatched = await dispatchClaudeWork({
      root,
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
