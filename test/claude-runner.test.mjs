import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadBoard } from "../src/board/board-store.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { validateClaudeRunnerCommand } from "../src/orchestrator/claude-runner.mjs";
import { readRunAttempt } from "../src/orchestrator/attempt-store.mjs";
import { orchestratorTick } from "../src/orchestrator/orchestrator.mjs";

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
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-claude-runner-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-claude-runner-project-"));
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

async function writeFakeClaude(root, scriptBody) {
  const filePath = path.join(root, "claude");
  await writeFile(filePath, `#!/usr/bin/env node\n${scriptBody}\n`, "utf8");
  await chmod(filePath, 0o755);
  return filePath;
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

test("claude-code runner writes handoff packet and moves successful work to Verifying", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
const fs = require('fs');
const path = require('path');
const sourceDir = path.join(process.env.MAKEITREAL_WORKSPACE, '.makeitreal', 'source');
const prd = JSON.parse(fs.readFileSync(path.join(sourceDir, 'prd.json'), 'utf8'));
const designPack = JSON.parse(fs.readFileSync(path.join(sourceDir, 'design-pack.json'), 'utf8'));
fs.mkdirSync('apps/web/auth', { recursive: true });
fs.writeFileSync('apps/web/auth/runner-output.txt', [prd.id, designPack.workItemId, process.env.MAKEITREAL_WORK_ITEM_ID].join('|'));
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.dispatchedWorkItemIds, ["work.login-ui"]);

    const workspace = path.join(boardDir, "workspaces", "work.login-ui");
    const handoff = await readJsonFile(path.join(workspace, ".makeitreal", "handoff.json"));
    const prompt = await readFile(path.join(workspace, ".makeitreal", "prompt.md"), "utf8");
    assert.equal(handoff.runnerMode, "claude-code");
    assert.equal(handoff.workItem.id, "work.login-ui");
    assert.deepEqual(handoff.workItem.allowedPaths, ["apps/web/auth/**"]);
    assert.equal(handoff.blueprintReview.status, "approved");
    assert.equal(handoff.blueprintReview.reviewedBy, "operator:fixture");
    assert.equal(handoff.contractArtifacts.some((artifact) => artifact.endsWith("contracts/auth-login.openapi.json")), true);
    assert.equal(handoff.sourceArtifacts.some((artifact) => artifact.endsWith("blueprint-review.json")), true);
    assert.equal(handoff.rules.some((rule) => /Do not edit outside allowedPaths/.test(rule)), true);
    assert.match(prompt, /Title: Implement login UI against auth contract/);
    const stagedReview = await readJsonFile(path.join(workspace, ".makeitreal", "source", "blueprint-review.json"));
    assert.equal(stagedReview.status, "approved");
    const stagedContract = await readJsonFile(path.join(workspace, ".makeitreal", "source", "contracts", "auth-login.openapi.json"));
    assert.equal(stagedContract.openapi, "3.1.0");

    const output = await readFile(path.join(workspace, "apps", "web", "auth", "runner-output.txt"), "utf8");
    assert.equal(output, "prd.auth-kanban|work.login-ui|work.login-ui");

    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Verifying");
  });
});

test("claude-code runner stages allowed project files and applies successful workspace changes back to the repo", async () => {
  await withProjectBoard(async ({ root, projectRoot, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await mkdir(path.join(projectRoot, "apps", "web", "auth"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps", "web", "auth", "runner-output.txt"), "before", "utf8");
    await writeFakeClaude(root, `
const fs = require('fs');
const path = require('path');
const filePath = path.join('apps', 'web', 'auth', 'runner-output.txt');
if (fs.readFileSync(filePath, 'utf8') !== 'before') {
  throw new Error('project file was not staged into workspace');
}
fs.writeFileSync(filePath, 'after');
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(await readFile(path.join(projectRoot, "apps", "web", "auth", "runner-output.txt"), "utf8"), "after");

    const attempt = await readRunAttempt({ boardDir, attemptId: "work.login-ui.1778025600000" });
    assert.equal(attempt.runner.projectRoot, projectRoot);
    assert.deepEqual(attempt.runner.stagedProjectPaths, ["apps/web/auth/runner-output.txt"]);
    assert.deepEqual(attempt.runner.projectApply.appliedPaths, ["apps/web/auth/runner-output.txt"]);
  });
});

test("claude-code runner stages completed dependency artifacts as read-only baseline", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const dependencyWorkspace = path.join(boardDir, "workspaces", "work.auth-contract");
    await mkdir(path.join(dependencyWorkspace, "contracts"), { recursive: true });
    await cp(
      path.join(boardDir, "contracts", "auth-login.openapi.json"),
      path.join(dependencyWorkspace, "contracts", "auth-login.openapi.json")
    );
    await writeFakeClaude(root, `
const fs = require('fs');
const contract = JSON.parse(fs.readFileSync('contracts/auth-login.openapi.json', 'utf8'));
if (contract.openapi !== '3.1.0') throw new Error('dependency contract was not staged');
fs.mkdirSync('apps/web/auth', { recursive: true });
fs.writeFileSync('apps/web/auth/uses-staged-contract.txt', contract.info.title);
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const workspace = path.join(boardDir, "workspaces", "work.login-ui");
    const output = await readFile(path.join(workspace, "apps", "web", "auth", "uses-staged-contract.txt"), "utf8");
    assert.equal(output, "Auth Login Contract");
    const handoff = await readJsonFile(path.join(workspace, ".makeitreal", "handoff.json"));
    assert.deepEqual(handoff.dependencyArtifacts.map((artifact) => ({
      fromWorkItemId: artifact.fromWorkItemId,
      path: artifact.path
    })), [
      { fromWorkItemId: "work.auth-contract", path: "contracts/auth-login.openapi.json" }
    ]);
  });
});

test("claude-code runner rejects before handoff staging when Blueprint is not approved", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await rm(path.join(boardDir, "blueprint-review.json"), { force: true });
    await writeFakeClaude(root, "console.log(JSON.stringify({ event: 'turn_completed' }));");
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_BLUEPRINT_AUDIT_UNLINKED");
    const workspace = path.join(boardDir, "workspaces", "work.login-ui");
    await assert.rejects(readFile(path.join(workspace, ".makeitreal", "handoff.json"), "utf8"));
    await assert.rejects(readFile(path.join(boardDir, "events.jsonl"), "utf8"));
    await assert.rejects(readFile(path.join(boardDir, "runtime-state.json"), "utf8"));
    await assert.rejects(readFile(path.join(boardDir, "claims", "work.login-ui.json"), "utf8"));
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Ready");
  });
});

test("claude-code runner treats OMC session files as runner metadata", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
const fs = require('fs');
fs.mkdirSync('.omc/sessions', { recursive: true });
fs.writeFileSync('.omc/sessions/session.json', JSON.stringify({ sessionId: 'fake-session' }));
fs.mkdirSync('apps/web/auth', { recursive: true });
fs.writeFileSync('apps/web/auth/runner-output.txt', 'inside boundary');
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, true);
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Verifying");
  });
});

test("claude-code runner boundary-checks non-session OMC files", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
const fs = require('fs');
fs.mkdirSync('.omc', { recursive: true });
fs.writeFileSync('.omc/other.json', JSON.stringify({ leaked: true }));
fs.mkdirSync('apps/web/auth', { recursive: true });
fs.writeFileSync('apps/web/auth/runner-output.txt', 'inside boundary');
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_PATH_BOUNDARY_VIOLATION");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Failed Fast");
  });
});

test("claude-code runner fails fast when staged source artifacts are modified", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
const fs = require('fs');
fs.writeFileSync('.makeitreal/source/prd.json', JSON.stringify({ mutated: true }));
fs.mkdirSync('apps/web/auth', { recursive: true });
fs.writeFileSync('apps/web/auth/runner-output.txt', 'inside boundary');
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_METADATA_BOUNDARY_VIOLATION");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Failed Fast");
  });
});

test("claude-code runner requires an explicit structured command", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code"
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_RUNNER_COMMAND_REQUIRED");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Ready");
  });
});

test("claude-code runner rejects commands that widen permissions or workspace access", () => {
  const duplicatePermission = validateClaudeRunnerCommand({
    file: "claude",
    args: [
      "--print",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      SAFE_CLAUDE_TOOLS,
      "--add-dir",
      "${workspace}",
      "--",
      "${prompt}"
    ]
  });
  assert.equal(duplicatePermission.ok, false);
  assert.equal(duplicatePermission.errors[0].code, "HARNESS_RUNNER_COMMAND_INVALID");

  const extraAddDir = validateClaudeRunnerCommand({
    file: "claude",
    args: [
      "--print",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      SAFE_CLAUDE_TOOLS,
      "--add-dir",
      "${workspace}",
      "--add-dir",
      "/tmp",
      "--",
      "${prompt}"
    ]
  });
  assert.equal(extraAddDir.ok, false);
  assert.equal(extraAddDir.errors[0].code, "HARNESS_RUNNER_COMMAND_INVALID");

  const bashTool = validateClaudeRunnerCommand({
    file: "claude",
    args: [
      "--print",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "Read,Write,Bash",
      "--add-dir",
      "${workspace}",
      "--",
      "${prompt}"
    ]
  });
  assert.equal(bashTool.ok, false);
  assert.equal(bashTool.errors[0].code, "HARNESS_RUNNER_COMMAND_INVALID");
});

test("claude-code runner rejects prompt arguments without the CLI option separator", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: [
          "--print",
          "--output-format",
          "json",
          "--permission-mode",
          "dontAsk",
          "--allowedTools",
          SAFE_CLAUDE_TOOLS,
          "--add-dir",
          "${workspace}",
          "${prompt}"
        ]
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_RUNNER_COMMAND_INVALID");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Ready");
  });
});

test("claude-code runner treats structured failure events as failed fast even with exit zero", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, "console.log(JSON.stringify({ event: 'unsupported_tool_call' }));");
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_CLAUDE_RUNNER_COMMAND_REJECTED");
    assert.equal(result.failure.category, "command-rejection");
    const board = await loadBoard(boardDir);
    const failed = board.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(failed.lane, "Failed Fast");
    assert.equal(failed.errorCode, "HARNESS_CLAUDE_RUNNER_COMMAND_REJECTED");
    const attempt = await readRunAttempt({ boardDir, attemptId: failed.latestAttemptId });
    assert.equal(attempt.runner.failure.category, "command-rejection");
  });
});

test("claude-code runner treats Claude result errors as failed fast even with exit zero", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
console.log(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  api_error_status: 429,
  result: 'usage limit'
}));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_CLAUDE_RUNNER_QUOTA");
    assert.equal(result.failure.category, "quota");
    const board = await loadBoard(boardDir);
    const failed = board.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(failed.lane, "Failed Fast");
    assert.equal(failed.errorCode, "HARNESS_CLAUDE_RUNNER_QUOTA");
    assert.equal(failed.errorCategory, "quota");
  });
});

test("claude-code runner classifies hook failures separately", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
console.error('Stop hook failed: command timed out');
process.exit(1);
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_CLAUDE_HOOK_FAILED");
    assert.equal(result.failure.category, "hook-failure");
  });
});

test("claude-code runner keeps bare turn ended errors generic", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, "console.log(JSON.stringify({ event: 'turn_ended_with_error' }));");
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_CLAUDE_RUNNER_FAILED");
    assert.equal(result.failure.category, "generic");
    const board = await loadBoard(boardDir);
    const failed = board.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(failed.errorCode, "HARNESS_CLAUDE_RUNNER_FAILED");
    assert.equal(failed.errorNextAction, "/makeitreal:status");
  });
});

test("claude-code runner classifies timeouts separately", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
console.error('Request timed out after 30000ms');
process.exit(1);
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_CLAUDE_RUNNER_TIMEOUT");
    assert.equal(result.failure.category, "timeout");
    const board = await loadBoard(boardDir);
    const failed = board.workItems.find((item) => item.id === "work.login-ui");
    assert.equal(failed.errorCategory, "timeout");
    assert.equal(failed.errorNextAction, "/makeitreal:launch");
  });
});

test("claude-code runner rejects non-Claude commands before claiming work", async () => {
  await withBoard(async ({ boardDir }) => {
    await enableClaudeRunner(boardDir);
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: process.execPath,
        args: VALID_CLAUDE_ARGS
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_RUNNER_COMMAND_INVALID");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Ready");
  });
});

test("claude-code runner rejects caller-supplied claude executable paths", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    const fakeClaude = await writeFakeClaude(root, "console.log(JSON.stringify({ event: 'turn_completed' }));");
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: fakeClaude,
        args: VALID_CLAUDE_ARGS
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_RUNNER_COMMAND_INVALID");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Ready");
  });
});

test("claude-code runner fails fast when the runner writes outside allowed paths", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
const fs = require('fs');
fs.writeFileSync('README.md', 'outside boundary');
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = await withFakeClaudeOnPath(root, () => orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: {
        file: "claude",
        args: VALID_CLAUDE_ARGS
      }
    }));

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_PATH_BOUNDARY_VIOLATION");
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Failed Fast");
  });
});

test("claude-code runner refuses scripted trust policy", async () => {
  await withBoard(async ({ boardDir }) => {
    const result = await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:00.000Z"),
      runnerMode: "claude-code",
      runnerCommand: { file: process.execPath, args: ["-e", "process.exit(0)"] }
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_RUNNER_MODE_UNSUPPORTED");
  });
});

test("claude-code runner works through the internal CLI with structured command JSON", async () => {
  await withBoard(async ({ root, boardDir }) => {
    await enableClaudeRunner(boardDir);
    await writeFakeClaude(root, `
const fs = require('fs');
fs.mkdirSync('apps/web/auth', { recursive: true });
fs.writeFileSync('apps/web/auth/cli-runner-output.txt', process.env.MAKEITREAL_PROMPT_PATH);
console.log(JSON.stringify({ event: 'turn_completed' }));
`);
    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "orchestrator",
      "tick",
      boardDir,
      "--runner",
      "claude-code",
      "--runner-command",
      JSON.stringify({
        file: "claude",
        args: VALID_CLAUDE_ARGS
      })
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH}`
      }
    });

    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.dispatchedWorkItemIds, ["work.login-ui"]);
    const workspace = path.join(boardDir, "workspaces", "work.login-ui");
    const promptPath = await readFile(path.join(workspace, "apps", "web", "auth", "cli-runner-output.txt"), "utf8");
    assert.equal(promptPath, path.join(workspace, ".makeitreal", "prompt.md"));
  });
});
