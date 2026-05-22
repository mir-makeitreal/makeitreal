import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const HARNESS_BIN = path.resolve(import.meta.dirname, "../bin/harness.mjs");

function validProposal(overrides = {}) {
  return {
    intent: {
      title: "Build auth with email and password",
      summary: "Implement email/password authentication",
      goals: ["Users can register", "Users can log in"],
      nonGoals: ["OAuth support"],
      userVisibleBehavior: ["Registration form accepts email/password"],
      acceptanceCriteria: [
        { id: "AC-001", statement: "User can register with email and password", verifiedBy: "wi.auth-api" },
        { id: "AC-002", statement: "User can log in", verifiedBy: "wi.auth-api" }
      ],
      assumptions: [
        { assumption: "Express is used", confidence: "high", ifWrong: "Route setup differs" }
      ]
    },
    architecture: {
      style: "layered",
      rationale: "Simple layered architecture",
      nodes: [
        { id: "auth-api", label: "Auth API", kind: "service", responsibilityUnitId: "ru.auth-api", description: "Handles auth" },
        { id: "db", label: "Database", kind: "database", responsibilityUnitId: "ru.auth-api", description: "Stores users" }
      ],
      edges: [
        { from: "auth-api", to: "db", contractId: "contract.auth.db", label: "queries", style: "sync" }
      ]
    },
    responsibilityUnits: [
      {
        id: "ru.auth-api",
        label: "Auth API Unit",
        moduleName: "auth-api",
        owner: "team.backend",
        owns: ["src/auth/**", "test/auth/**"],
        mustProvideContracts: ["contract.auth.login"],
        mayUseContracts: ["contract.auth.db"],
        responsibility: "Handles authentication",
        publicSurfaces: [
          {
            name: "login",
            kind: "endpoint",
            contractIds: ["contract.auth.login"],
            signature: {
              inputs: [{ name: "email", type: "string" }, { name: "password", type: "string" }],
              outputs: [{ name: "token", type: "string" }],
              errors: [{ code: 401, reason: "Invalid credentials" }]
            }
          }
        ]
      }
    ],
    contracts: [
      {
        contractId: "contract.auth.login",
        kind: "openapi",
        title: "Auth Login Endpoint",
        provider: "ru.auth-api",
        consumers: [],
        surface: {
          method: "POST",
          path: "/api/auth/login",
          requestSchema: { type: "object", properties: { email: { type: "string" }, password: { type: "string" } } },
          responseSchema: { type: "object", properties: { token: { type: "string" } } },
          errorCodes: [400, 401]
        }
      },
      {
        contractId: "contract.auth.db",
        kind: "openapi",
        title: "Auth DB Contract",
        provider: "ru.auth-api",
        consumers: [],
        surface: {
          method: "POST",
          path: "/api/internal/find-user",
          requestSchema: { type: "object", properties: { email: { type: "string" } } },
          responseSchema: { type: "object", properties: { user: { type: "object" } } },
          errorCodes: [404]
        }
      }
    ],
    workItems: [
      {
        id: "wi.auth-api",
        title: "Implement auth API",
        kind: "implementation",
        responsibilityUnitId: "ru.auth-api",
        contractIds: ["contract.auth.login", "contract.auth.db"],
        dependsOn: [],
        allowedPaths: ["src/auth/**", "test/auth/**"],
        estimatedComplexity: "medium",
        decomposable: false,
        verificationCommands: [
          { command: "npm test -- --grep auth", purpose: "Run auth tests" }
        ],
        deliverables: ["src/auth/routes.mjs", "test/auth/routes.test.mjs"],
        acceptanceCriteriaIds: ["AC-001", "AC-002"]
      }
    ],
    sequences: [
      {
        title: "Login Flow",
        participants: ["Client", "Auth API", "Database"],
        steps: [
          { from: "Client", to: "Auth API", action: "POST /login", data: "email, password" },
          { from: "Auth API", to: "Database", action: "findUserByEmail" },
          { from: "Database", to: "Auth API", action: "return user" },
          { from: "Auth API", to: "Client", action: "return token" }
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

    // Verify artifacts exist
    const prd = JSON.parse(await readFile(path.join(tempDir, "prd.json"), "utf8"));
    assert.equal(prd.title, "Build auth with email and password");

    const designPack = JSON.parse(await readFile(path.join(tempDir, "design-pack.json"), "utf8"));
    assert.ok(designPack.architecture, "design-pack should have architecture");

    const board = JSON.parse(await readFile(path.join(tempDir, "board.json"), "utf8"));
    assert.ok(board.workItems, "board should have workItems");

    const trustPolicy = JSON.parse(await readFile(path.join(tempDir, "trust-policy.json"), "utf8"));
    assert.equal(trustPolicy.runnerMode, "claude-code");

    const workItem = JSON.parse(await readFile(path.join(tempDir, "work-items", "wi.auth-api.json"), "utf8"));
    assert.equal(workItem.id, "wi.auth-api");
    assert.equal(workItem.title, "Implement auth API");

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
      workItems: [
        {
          id: "wi.a",
          title: "A",
          responsibilityUnitId: "ru.auth-api",
          allowedPaths: ["src/auth/**"],
          dependsOn: ["wi.b"]
        },
        {
          id: "wi.b",
          title: "B",
          responsibilityUnitId: "ru.auth-api",
          allowedPaths: ["src/auth/**"],
          dependsOn: ["wi.a"]
        }
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
