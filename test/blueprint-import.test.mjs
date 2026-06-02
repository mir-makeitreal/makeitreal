import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const HARNESS_BIN = path.resolve(import.meta.dirname, "../bin/harness.mjs");

function validProposal(overrides = {}) {
  return {
    title: "Build auth with email and password",
    summary: "Implement email/password authentication",
    goals: ["Users can register", "Users can log in"],
    nonGoals: ["OAuth support"],
    acceptanceCriteria: [
      "User can register with email and password",
      "User can log in"
    ],
    assumptions: ["Express is used"],
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
        name: "auth",
        purpose: "JWT authentication",
        owner: "team.implementation",
        ownedPaths: ["src/auth/**", "test/auth/**"],
        dependsOn: [],
        contracts: [
          {
            name: "POST /auth/login",
            type: "http",
            inputs: [
              { name: "email", type: "string", required: true },
              { name: "password", type: "string", required: true }
            ],
            outputs: [{ name: "token", type: "string" }],
            errors: [{ code: "INVALID_CREDENTIALS", when: "email/password mismatch" }]
          }
        ]
      }
    ],
    workItems: [
      {
        module: "auth",
        title: "Implement auth module",
        dependsOn: [],
        verifyCommand: "npm test -- --grep auth",
        complexity: "medium",
        doneEvidence: [
          { kind: "verification", path: "evidence/work.auth.verification.json" },
          { kind: "wiki-sync", path: "evidence/work.auth.wiki-sync.json" }
        ]
      }
    ],
    scenarios: [
      {
        title: "Login Flow",
        steps: [
          { from: "Client", to: "Auth", action: "POST /auth/login" },
          { from: "Auth", to: "Client", action: "return JWT token" }
        ]
      }
    ],
    ...overrides
  };
}

function runBlueprintImport(runDir, proposalInput, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [HARNESS_BIN, "blueprint", "import", ...(runDir ? [runDir] : []), ...extraArgs];
    const child = spawn("node", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);

    const inputStr = typeof proposalInput === "string" ? proposalInput : JSON.stringify(proposalInput);
    child.stdin.write(inputStr);
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout. stdout=${stdout.slice(0,300)} stderr=${stderr.slice(0,300)}`));
    }, 15000);

    child.on("close", code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout);
        resolve({ result, code, stderr });
      } catch {
        reject(new Error(`Could not parse stdout as JSON. code=${code} stdout=${stdout.slice(0,500)} stderr=${stderr.slice(0,500)}`));
      }
    });
  });
}

describe("blueprint import CLI command", () => {
  let tempDir;

  it("imports a valid BlueprintProposal and writes artifacts", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "blueprint-import-test-"));
    const proposal = validProposal();
    const { result } = await runBlueprintImport(tempDir, proposal);

    assert.equal(result.ok, true, `Expected ok=true, got errors: ${JSON.stringify(result.errors)}`);
    assert.equal(result.command, "blueprint import");
    assert.equal(result.workItemCount, 1);
    assert.equal(result.runDir, tempDir);

    const prd = JSON.parse(await readFile(path.join(tempDir, "prd.json"), "utf8"));
    assert.equal(prd.title, "Build auth with email and password");

    const designPack = JSON.parse(await readFile(path.join(tempDir, "design-pack.json"), "utf8"));
    assert.ok(designPack.architecture, "design-pack should have architecture");

    const board = JSON.parse(await readFile(path.join(tempDir, "board.json"), "utf8"));
    assert.ok(board.workItems, "board should have workItems");

    const trustPolicy = JSON.parse(await readFile(path.join(tempDir, "trust-policy.json"), "utf8"));
    assert.equal(trustPolicy.runnerMode, "claude-code");

    const workItem = JSON.parse(await readFile(path.join(tempDir, "work-items", "work.auth.json"), "utf8"));
    assert.equal(workItem.id, "work.auth");
    assert.equal(workItem.title, "Implement auth module");

    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects invalid JSON on stdin", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "blueprint-import-test-"));
    const { result, code } = await runBlueprintImport(tempDir, "not valid json{{{");
    assert.equal(result.ok, false);
    assert.equal(result.command, "blueprint import");
    assert.ok(result.errors.some(e => e.code === "HARNESS_BLUEPRINT_PARSE_ERROR"));
    assert.equal(code, 1);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects a proposal with validation errors (cycle)", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "blueprint-import-test-"));
    const proposal = validProposal({
      modules: [
        {
          name: "alpha",
          purpose: "Alpha module",
          ownedPaths: ["src/alpha/**"],
          dependsOn: ["beta"],
          contracts: []
        },
        {
          name: "beta",
          purpose: "Beta module",
          ownedPaths: ["src/beta/**"],
          dependsOn: ["alpha"],
          contracts: []
        }
      ],
      workItems: [
        { module: "alpha", title: "Build alpha", dependsOn: [], verifyCommand: "node --test" },
        { module: "beta", title: "Build beta", dependsOn: [], verifyCommand: "node --test" }
      ]
    });
    const { result, code } = await runBlueprintImport(tempDir, proposal);
    assert.equal(result.ok, false);
    assert.equal(result.command, "blueprint import");
    assert.ok(result.errors.some(e => e.code.includes("DAG_IS_ACYCLIC")));
    assert.equal(code, 1);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects empty stdin", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "blueprint-import-test-"));
    const { result, code } = await runBlueprintImport(tempDir, "");
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === "HARNESS_BLUEPRINT_STDIN_EMPTY"));
    assert.equal(code, 1);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects missing runDir", async () => {
    const { result, code } = await runBlueprintImport(null, validProposal());
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === "HARNESS_RUN_DIR_REQUIRED"));
    assert.equal(code, 1);
  });

  it("passes --slug through as runId", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "blueprint-import-test-"));
    const proposal = validProposal();
    const { result } = await runBlueprintImport(tempDir, proposal, ["--slug", "my-custom-run"]);

    assert.equal(result.ok, true, `Expected ok=true, got errors: ${JSON.stringify(result.errors)}`);
    assert.equal(result.runId, "my-custom-run");

    const designPack = JSON.parse(await readFile(path.join(tempDir, "design-pack.json"), "utf8"));
    assert.equal(designPack.runId, "my-custom-run");

    await rm(tempDir, { recursive: true, force: true });
  });
});
