import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const SERVER_PATH = path.resolve(
  import.meta.dirname,
  "../plugins/makeitreal/mcp-server/index.mjs"
);

function validProposal(overrides = {}) {
  return {
    title: "MCP test blueprint",
    summary: "Validate that the MCP server saves a blueprint.",
    goals: ["Server accepts proposals"],
    nonGoals: ["Network access"],
    acceptanceCriteria: ["Server writes prd.json"],
    assumptions: ["Run inside the dev-harness workspace"],
    stateFlow: {
      lanes: [
        "Intake", "Discovery", "Scoped", "Blueprint Bound",
        "Contract Frozen", "Ready", "Claimed", "Running",
        "Verifying", "Human Review", "Done"
      ],
      transitions: [
        { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
        { from: "Human Review", to: "Done", gate: "wiki" }
      ]
    },
    modules: [
      {
        name: "alpha",
        purpose: "Primary module for the MCP test.",
        owner: "team.implementation",
        ownedPaths: ["src/alpha/**", "test/alpha/**"],
        dependsOn: [],
        contracts: [
          {
            name: "alphaCall",
            type: "function",
            inputs: [{ name: "input", type: "string", required: true }],
            outputs: [{ name: "result", type: "string" }],
            errors: [{ code: "ALPHA_FAILED", when: "input is invalid" }]
          }
        ]
      }
    ],
    workItems: [
      {
        module: "alpha",
        title: "Implement alpha module",
        dependsOn: [],
        verifyCommand: "node --test",
        complexity: "small",
        // Explicit zero-reviewer declaration: import requires requiredReviewRoles.
        requiredReviewRoles: [],
        doneEvidence: [
          { kind: "verification", path: "evidence/work.alpha.verification.json" },
          { kind: "wiki-sync", path: "evidence/work.alpha.wiki-sync.json" }
        ]
      }
    ],
    scenarios: [
      {
        title: "Alpha invocation flow",
        steps: [{ from: "Caller", to: "alpha", action: "invoke alphaCall" }]
      }
    ],
    ...overrides
  };
}

function startServer() {
  const child = spawn("node", [SERVER_PATH], { stdio: ["pipe", "pipe", "pipe"] });
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
          reject(new Error(`Timeout waiting for ${method}. stderr=${stderrBuf.slice(0, 500)}`));
        }
      }, 10000);
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

describe("make-it-real MCP server", () => {
  let server;
  let tempRoot;

  before(async () => {
    server = startServer();
    tempRoot = await mkdtemp(path.join(tmpdir(), "mir-mcp-test-"));
  });

  after(async () => {
    if (server) await server.shutdown();
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it("responds to initialize with tools capability", async () => {
    const response = await server.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "0.0.0" }
    });
    assert.equal(response.result.serverInfo.name, "make-it-real");
    assert.ok(response.result.capabilities.tools, "must advertise tools capability");
    server.notify("notifications/initialized");
  });

  it("lists mir_blueprint with the expected schema", async () => {
    const response = await server.request("tools/list");
    assert.ok(Array.isArray(response.result.tools));
    const tool = response.result.tools.find((t) => t.name === "mir_blueprint");
    assert.ok(tool, "mir_blueprint tool must be exposed");
    assert.equal(typeof tool.description, "string");
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.inputSchema.required.includes("projectRoot"));
    assert.ok(tool.inputSchema.required.includes("runSlug"));
    assert.ok(tool.inputSchema.required.includes("title"));
    assert.ok(tool.inputSchema.required.includes("summary"));
    assert.ok(tool.inputSchema.required.includes("modules"));
    assert.ok(tool.inputSchema.required.includes("workItems"));
    assert.equal(tool.inputSchema.properties.projectRoot.type, "string");
    assert.equal(tool.inputSchema.properties.runSlug.type, "string");
  });

  it("writes artifacts when given a valid proposal", async () => {
    const runSlug = "mcp-valid";
    const response = await server.request("tools/call", {
      name: "mir_blueprint",
      arguments: { projectRoot: tempRoot, runSlug, ...validProposal() }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true, `tool reported errors: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.workItemCount, 1);
    const expectedRunDir = path.join(tempRoot, ".makeitreal", "runs", runSlug);
    assert.equal(payload.runDir, expectedRunDir);

    const prd = JSON.parse(await readFile(path.join(expectedRunDir, "prd.json"), "utf8"));
    assert.equal(prd.title, "MCP test blueprint");

    const board = JSON.parse(await readFile(path.join(expectedRunDir, "board.json"), "utf8"));
    assert.ok(Array.isArray(board.workItems) && board.workItems.length === 1);

    const review = JSON.parse(await readFile(path.join(expectedRunDir, "blueprint-review.json"), "utf8"));
    assert.equal(review.status, "pending");

    await stat(path.join(expectedRunDir, "preview", "index.html"));
  });

  it("returns a structured error for an invalid proposal", async () => {
    const runSlug = "mcp-invalid";
    const proposal = validProposal({ modules: [] });
    const response = await server.request("tools/call", {
      name: "mir_blueprint",
      arguments: { projectRoot: tempRoot, runSlug, ...proposal }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, false);
    assert.ok(Array.isArray(payload.errors) && payload.errors.length > 0);
  });

  it("rejects missing projectRoot", async () => {
    const response = await server.request("tools/call", {
      name: "mir_blueprint",
      arguments: { runSlug: "no-root", ...validProposal() }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, false);
    assert.ok(payload.errors.some((e) => e.code === "MISSING_PROJECT_ROOT"));
  });

  it("exposes mir_launch in tools/list with the expected schema", async () => {
    const response = await server.request("tools/list");
    const tool = response.result.tools.find((t) => t.name === "mir_launch");
    assert.ok(tool, "mir_launch tool must be exposed");
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(tool.inputSchema.required.includes("projectRoot"));
    assert.ok(tool.inputSchema.required.includes("runSlug"));
    assert.ok(tool.inputSchema.required.includes("action"));
    assert.deepEqual(
      tool.inputSchema.properties.action.enum.sort(),
      ["complete", "finish", "start", "status"]
    );
  });

  it("mir_launch status returns structured launch state after blueprint creation", async () => {
    const runSlug = "mcp-launch-status";
    const blueprint = await server.request("tools/call", {
      name: "mir_blueprint",
      arguments: { projectRoot: tempRoot, runSlug, ...validProposal() }
    });
    const blueprintPayload = parseToolText(blueprint);
    assert.equal(blueprintPayload.ok, true, `blueprint failed: ${JSON.stringify(blueprintPayload.errors)}`);

    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: { projectRoot: tempRoot, runSlug, action: "status" }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, true, `status failed: ${JSON.stringify(payload.errors)}`);
    assert.equal(payload.action, "status");
    assert.equal(typeof payload.runDir, "string");
    assert.ok(Array.isArray(payload.launchableWorkItemIds));
    assert.equal(typeof payload.laneCounts, "object");
    assert.ok(Array.isArray(payload.blockers));
    assert.equal(payload.blueprintApproved, false, "blueprint review must be pending after creation");
    assert.ok(payload.readyGate, "readyGate must be reported");
  });

  it("mir_launch start returns a structured response when run is not yet launchable", async () => {
    const runSlug = "mcp-launch-start";
    const blueprint = await server.request("tools/call", {
      name: "mir_blueprint",
      arguments: { projectRoot: tempRoot, runSlug, ...validProposal() }
    });
    const blueprintPayload = parseToolText(blueprint);
    assert.equal(blueprintPayload.ok, true);

    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: { projectRoot: tempRoot, runSlug, action: "start" }
    });
    const payload = parseToolText(response);
    assert.equal(payload.action, "start");
    assert.ok(Array.isArray(payload.nativeTasks));
    assert.ok(Array.isArray(payload.errors));
    // Blueprint is unapproved, so start should report errors and produce no native tasks.
    assert.equal(payload.nativeTasks.length, 0);
    assert.equal(payload.ok, false);
  });

  it("mir_launch rejects an invalid action", async () => {
    const response = await server.request("tools/call", {
      name: "mir_launch",
      arguments: { projectRoot: tempRoot, runSlug: "mcp-launch-status", action: "bogus" }
    });
    const payload = parseToolText(response);
    assert.equal(payload.ok, false);
    assert.ok(payload.errors.some((e) => e.code === "INVALID_ACTION"));
  });
});
