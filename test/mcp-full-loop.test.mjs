import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const SERVER_PATH = path.resolve(
  import.meta.dirname,
  "../plugins/makeitreal/mcp-server/index.mjs"
);
const HARNESS_BIN = path.resolve(import.meta.dirname, "../bin/harness.mjs");

function twoModuleProposal() {
  return {
    title: "MCP full-loop blueprint",
    summary: "Two-module proposal exercising the full plan→launch→finish→complete loop through MCP.",
    goals: ["Auth module provides login", "Todos module depends on auth"],
    nonGoals: ["Real database"],
    acceptanceCriteria: ["Auth module exposes login", "Todos module consumes auth"],
    assumptions: ["Run in tmp project root"],
    modules: [
      {
        name: "auth",
        purpose: "Authenticate users and expose a login contract.",
        ownedPaths: ["src/auth/**", "test/auth/**"],
        dependsOn: [],
        contracts: [
          {
            name: "login",
            type: "function",
            inputs: [{ name: "credentials", type: "object", required: true }],
            outputs: [{ name: "token", type: "string" }],
            errors: [{ code: "AUTH_FAILED", when: "credentials are invalid" }]
          }
        ]
      },
      {
        name: "todos",
        purpose: "Manage todo items for an authenticated user.",
        ownedPaths: ["src/todos/**", "test/todos/**"],
        dependsOn: ["auth"],
        contracts: [
          {
            name: "listTodos",
            type: "function",
            inputs: [{ name: "userId", type: "string", required: true }],
            outputs: [{ name: "items", type: "array" }],
            errors: [{ code: "LIST_FAILED", when: "user not found" }]
          }
        ]
      }
    ],
    workItems: [
      {
        module: "auth",
        title: "Implement auth module",
        dependsOn: [],
        verifyCommand: "node -e process.exit(0)",
        complexity: "small"
      },
      {
        module: "todos",
        title: "Implement todos module",
        dependsOn: ["auth"],
        verifyCommand: "node -e process.exit(0)",
        complexity: "small"
      }
    ]
  };
}

function startServer({ debug = false } = {}) {
  const env = { ...process.env };
  if (debug) env.MAKEITREAL_DEBUG = "1";
  const child = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env
  });
  const rl = createInterface({ input: child.stdout });

  const pending = new Map();
  let nextId = 1;
  let stderrBuf = "";

  child.stderr.on("data", (chunk) => { stderrBuf += chunk.toString(); });

  rl.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && message.id !== null && pending.has(message.id)) {
      const { resolve } = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  });

  function request(method, params) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method };
    if (params !== undefined) payload.params = params;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timeout waiting for ${method}. stderr=${stderrBuf.slice(0, 800)}`));
        }
      }, 20000);
    });
  }

  function notify(method, params) {
    const payload = { jsonrpc: "2.0", method };
    if (params !== undefined) payload.params = params;
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  function shutdown() {
    return new Promise((resolve) => {
      child.once("close", () => resolve());
      child.stdin.end();
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve();
      }, 2000);
    });
  }

  return { child, request, notify, shutdown, stderr: () => stderrBuf };
}

function parseToolText(response) {
  const content = response.result && response.result.content;
  assert.ok(Array.isArray(content) && content.length > 0, "tool response missing content");
  return JSON.parse(content[0].text);
}

describe("make-it-real MCP server full plan→launch→finish→complete loop", () => {
  let server;
  let tempRoot;
  const runSlug = "mcp-full-loop";

  before(async () => {
    server = startServer({ debug: true });
    tempRoot = await mkdtemp(path.join(tmpdir(), "mir-mcp-full-loop-"));

    const init = await server.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcp-full-loop-test", version: "0.0.0" }
    });
    assert.equal(init.result.serverInfo.name, "make-it-real");
    server.notify("notifications/initialized");
  });

  after(async () => {
    if (server) await server.shutdown();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it("submits a two-module blueprint via mir_blueprint", async () => {
    const response = await server.request("tools/call", {
      name: "mir_blueprint",
      arguments: { projectRoot: tempRoot, runSlug, ...twoModuleProposal() }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true, `blueprint failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.workItemCount, 3); // 2 modules + 1 integration work item
  });

  it("mir_launch status reports gate Ready fails until approval and provides an llmHint", async () => {
    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: { projectRoot: tempRoot, runSlug, action: "status" }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true);
    assert.equal(payload.blueprintApproved, false);
    assert.equal(payload.readyGate.ok, false);
    assert.equal(typeof payload.llmHint, "string", "status should return an llmHint while blueprint is unapproved");
    assert.match(payload.llmHint, /Blueprint not approved/);
  });

  it("approves the blueprint via the harness CLI", () => {
    const runDir = path.join(tempRoot, ".makeitreal", "runs", runSlug);
    const result = spawnSync("node", [HARNESS_BIN, "blueprint", "approve", runDir, "--by", "operator:full-loop-test"], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `approve failed: stdout=${result.stdout} stderr=${result.stderr}`);
  });

  it("mir_launch status reports gate Ready passes after approval", async () => {
    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: { projectRoot: tempRoot, runSlug, action: "status" }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true);
    assert.equal(payload.blueprintApproved, true);
    assert.equal(payload.readyGate.ok, true, `readyGate errors: ${JSON.stringify(payload.readyGate.errors)}`);
    assert.ok(payload.launchableWorkItemIds.includes("work.auth"));
    // todos depends on auth, must not be launchable yet
    assert.ok(!payload.launchableWorkItemIds.includes("work.todos"));
  });

  let firstTask = null;

  it("mir_launch start returns nativeTasks with implementationPrompt", async () => {
    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: { projectRoot: tempRoot, runSlug, action: "start", concurrency: 1 }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true, `start failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.nativeTasks.length, 1);
    firstTask = payload.nativeTasks[0];
    assert.equal(firstTask.workItemId, "work.auth");
    assert.equal(typeof firstTask.attemptId, "string");
    assert.equal(typeof firstTask.implementationPrompt, "string");
    assert.ok(firstTask.implementationPrompt.includes("makeitrealReport"));
  });

  it("mir_launch finish records an implementation result envelope", async () => {
    assert.ok(firstTask, "firstTask must be set from start");
    const result = {
      makeitrealReport: {
        role: "implementation-worker",
        status: "DONE",
        summary: "Implemented auth module via MCP full-loop test.",
        changedFiles: ["src/auth/login.mjs"],
        tested: ["node -e process.exit(0)"],
        concerns: [],
        needsContext: [],
        blockers: [],
        workItemId: firstTask.workItemId,
        attemptId: firstTask.attemptId
      },
      makeitrealReviews: ["spec-reviewer", "quality-reviewer", "verification-reviewer"].map((role) => ({
        role,
        status: "APPROVED",
        summary: `${role} approved the auth implementation.`,
        findings: [],
        evidence: ["mcp full-loop test"],
        workItemId: firstTask.workItemId,
        attemptId: firstTask.attemptId
      }))
    };
    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: {
        projectRoot: tempRoot,
        runSlug,
        action: "finish",
        workItemId: firstTask.workItemId,
        attemptId: firstTask.attemptId,
        result
      }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true, `finish failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.workItemId, firstTask.workItemId);
  });

  it("mir_launch complete moves the work item to Done and returns remaining items", async () => {
    assert.ok(firstTask);
    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: {
        projectRoot: tempRoot,
        runSlug,
        action: "complete",
        workItemId: firstTask.workItemId,
        runnerMode: "claude-code"
      }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true, `complete failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.newLane, "Done");
    // todos should remain
    const remainingIds = payload.remainingItems.map((item) => item.id);
    assert.ok(remainingIds.includes("work.todos"), `expected work.todos to remain; got ${JSON.stringify(payload.remainingItems)}`);
    assert.ok(!remainingIds.includes("work.auth"));

    // Sanity check on board file
    const board = JSON.parse(await readFile(path.join(tempRoot, ".makeitreal", "runs", runSlug, "board.json"), "utf8"));
    const auth = board.workItems.find((wi) => wi.id === "work.auth");
    assert.equal(auth.lane, "Done");
  });

  it("MAKEITREAL_DEBUG=1 emits structured JSON-line logs to stderr", () => {
    const stderr = server.stderr();
    const lines = stderr.split(/\n+/).filter((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("{") && trimmed.includes("makeitreal-mcp");
    });
    assert.ok(lines.length > 0, `expected debug log lines; stderr=${stderr.slice(0, 500)}`);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.source, "makeitreal-mcp");
    assert.equal(typeof parsed.timestamp, "string");
    assert.equal(typeof parsed.method, "string");
  });
});
