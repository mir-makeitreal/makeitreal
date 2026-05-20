import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { validateBlueprintProposal, VALIDATION_RULES } from "../src/plan/blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "../src/plan/blueprint-normalizer.mjs";
import { getSystemPrompt, getBlueprintSchema, buildUserPrompt } from "../src/plan/claude-blueprint.mjs";

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
        owner: "team.backend",
        owns: ["src/auth/**", "test/auth/**"],
        mustProvideContracts: ["contract.auth.login"],
        mayUseContracts: ["contract.auth.db"],
        responsibility: "Handles authentication"
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
        kind: "module-io",
        title: "Auth DB Contract",
        provider: "ru.auth-api",
        consumers: [],
        surface: {
          functionName: "findUserByEmail",
          inputTypes: [{ name: "email", type: "string" }],
          outputType: "User | null"
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

describe("blueprint-validator", () => {
  it("accepts a valid proposal", () => {
    const result = validateBlueprintProposal(validProposal());
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it("rejects null proposal", () => {
    const result = validateBlueprintProposal(null);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "INVALID_PROPOSAL");
  });

  it("rejects missing required fields", () => {
    const result = validateBlueprintProposal({ intent: { title: "test" } });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "MISSING_FIELDS");
  });

  it("UNIQUE_NODE_IDS — detects duplicate node IDs", () => {
    const proposal = validProposal();
    proposal.architecture.nodes.push(proposal.architecture.nodes[0]);
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "UNIQUE_NODE_IDS"));
  });

  it("UNIQUE_WORK_ITEM_IDS — detects duplicate work item IDs", () => {
    const proposal = validProposal();
    proposal.workItems.push({ ...proposal.workItems[0] });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "UNIQUE_WORK_ITEM_IDS"));
  });

  it("EDGES_REFERENCE_DECLARED_NODES — detects undeclared node refs", () => {
    const proposal = validProposal();
    proposal.architecture.edges.push({ from: "auth-api", to: "nonexistent", contractId: "contract.auth.db" });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "EDGES_REFERENCE_DECLARED_NODES"));
  });

  it("DAG_IS_ACYCLIC — detects cycles in work item dependencies", () => {
    const proposal = validProposal();
    proposal.workItems = [
      { ...proposal.workItems[0], id: "wi.a", dependsOn: ["wi.b"], allowedPaths: ["src/auth/**"], responsibilityUnitId: "ru.auth-api" },
      { ...proposal.workItems[0], id: "wi.b", dependsOn: ["wi.a"], allowedPaths: ["test/auth/**"], responsibilityUnitId: "ru.auth-api" }
    ];
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "DAG_IS_ACYCLIC"));
  });

  it("CONTRACTS_REFERENCED_EXIST — detects missing contracts", () => {
    const proposal = validProposal();
    proposal.workItems[0].contractIds.push("contract.nonexistent");
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "CONTRACTS_REFERENCED_EXIST"));
  });

  it("NO_OVERLAPPING_OWNERSHIP — detects overlapping RU paths", () => {
    const proposal = validProposal();
    proposal.responsibilityUnits.push({
      id: "ru.other",
      label: "Other Unit",
      owner: "team.other",
      owns: ["src/auth/**"],
      mustProvideContracts: [],
      mayUseContracts: [],
      responsibility: "Also handles auth"
    });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "NO_OVERLAPPING_OWNERSHIP"));
  });

  it("WORK_ITEMS_WITHIN_RU_PATHS — detects out-of-bounds work item paths", () => {
    const proposal = validProposal();
    proposal.workItems[0].allowedPaths = ["src/other/**"];
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "WORK_ITEMS_WITHIN_RU_PATHS"));
  });

  it("ALLOWED_PATHS_ARE_VALID — detects invalid path patterns", () => {
    const proposal = validProposal();
    proposal.workItems[0].allowedPaths.push("/absolute/path");
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "ALLOWED_PATHS_ARE_VALID"));
  });

  it("EVERY_RU_HAS_WORK_ITEMS — warns about uncovered RUs", () => {
    const proposal = validProposal();
    proposal.responsibilityUnits.push({
      id: "ru.lonely",
      label: "Lonely Unit",
      owner: "team.lonely",
      owns: ["src/lonely/**"],
      mustProvideContracts: [],
      mayUseContracts: [],
      responsibility: "Nobody works here"
    });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.warnings.some(w => w.code === "EVERY_RU_HAS_WORK_ITEMS"));
    assert.equal(result.ok, true, "Warnings don't block validation");
  });

  it("EVERY_CONTRACT_HAS_PROVIDER_WORK_ITEM — warns about orphan contracts", () => {
    const proposal = validProposal();
    proposal.contracts.push({
      contractId: "contract.orphan",
      kind: "module-io",
      title: "Orphan Contract",
      provider: "ru.auth-api",
      consumers: [],
      surface: {}
    });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.warnings.some(w => w.code === "EVERY_CONTRACT_HAS_PROVIDER_WORK_ITEM"));
  });

  it("ACCEPTANCE_CRITERIA_COVERED — warns about uncovered AC", () => {
    const proposal = validProposal();
    proposal.intent.acceptanceCriteria.push({ id: "AC-003", statement: "Not covered" });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.warnings.some(w => w.code === "ACCEPTANCE_CRITERIA_COVERED"));
  });

  it("WORK_ITEM_COUNT_WITHIN_LIMITS — rejects too many work items", () => {
    const proposal = validProposal();
    for (let i = 1; i <= 13; i++) {
      proposal.workItems.push({
        id: `wi.extra-${i}`,
        title: `Extra ${i}`,
        kind: "implementation",
        responsibilityUnitId: "ru.auth-api",
        contractIds: [],
        dependsOn: [],
        allowedPaths: ["src/auth/**"],
        verificationCommands: [],
        acceptanceCriteriaIds: []
      });
    }
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "WORK_ITEM_COUNT_WITHIN_LIMITS"));
  });

  it("DEPENDENCY_DEPTH_WITHIN_LIMITS — warns about deep chains", () => {
    const proposal = validProposal();
    proposal.workItems = [];
    for (let i = 0; i < 7; i++) {
      proposal.workItems.push({
        id: `wi.chain-${i}`,
        title: `Chain ${i}`,
        kind: "implementation",
        responsibilityUnitId: "ru.auth-api",
        contractIds: [],
        dependsOn: i > 0 ? [`wi.chain-${i - 1}`] : [],
        allowedPaths: ["src/auth/**"],
        verificationCommands: [],
        acceptanceCriteriaIds: []
      });
    }
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.warnings.some(w => w.code === "DEPENDENCY_DEPTH_WITHIN_LIMITS"));
  });

  it("has all 14 validation rules", () => {
    assert.equal(VALIDATION_RULES.length, 14);
  });
});

describe("blueprint-normalizer", () => {
  it("produces canonical prd.json shape", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    assert.equal(result.prd.schemaVersion, "1.0");
    assert.ok(result.prd.id.startsWith("prd."));
    assert.equal(result.prd.title, "Build auth with email and password");
    assert.ok(Array.isArray(result.prd.goals));
    assert.ok(Array.isArray(result.prd.acceptanceCriteria));
    assert.ok(Array.isArray(result.prd.nonGoals));
    assert.equal(typeof result.prd.request, "string");
  });

  it("produces canonical design-pack.json shape", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    const dp = result.designPack;
    assert.equal(dp.schemaVersion, "1.0");
    assert.ok(dp.architecture);
    assert.ok(Array.isArray(dp.architecture.nodes));
    assert.ok(Array.isArray(dp.architecture.edges));
    assert.ok(dp.stateFlow);
    assert.ok(Array.isArray(dp.stateFlow.lanes));
    assert.ok(dp.stateFlow.lanes.includes("Ready"));
    assert.ok(dp.stateFlow.lanes.includes("Done"));
    assert.ok(Array.isArray(dp.apiSpecs));
    assert.ok(Array.isArray(dp.responsibilityBoundaries));
    assert.ok(Array.isArray(dp.moduleInterfaces));
    assert.ok(Array.isArray(dp.callStacks));
    assert.ok(Array.isArray(dp.sequences));
  });

  it("produces canonical responsibility-units.json shape", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    const ru = result.responsibilityUnits;
    assert.equal(ru.schemaVersion, "1.0");
    assert.ok(Array.isArray(ru.units));
    assert.ok(ru.units.length > 0);
    assert.ok(ru.units[0].id);
    assert.ok(Array.isArray(ru.units[0].owns));
    assert.ok(Array.isArray(ru.units[0].mustProvideContracts));
  });

  it("produces canonical work-item shape", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    assert.ok(result.workItems.length > 0);
    const wi = result.workItems[0];
    assert.equal(wi.schemaVersion, "1.0");
    assert.ok(wi.id);
    assert.ok(wi.title);
    assert.ok(wi.prdId);
    assert.equal(wi.lane, "Contract Frozen");
    assert.ok(wi.responsibilityUnitId);
    assert.ok(Array.isArray(wi.allowedPaths));
    assert.ok(Array.isArray(wi.doneEvidence));
    assert.ok(wi.prdTrace);
    assert.ok(Array.isArray(wi.prdTrace.acceptanceCriteriaIds));
  });

  it("produces canonical work-item-dag.json shape", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    const dag = result.workItemDag;
    assert.equal(dag.schemaVersion, "1.0");
    assert.ok(Array.isArray(dag.nodes));
    assert.ok(Array.isArray(dag.edges));
    assert.ok(dag.nodes[0].id);
    assert.ok(dag.nodes[0].kind);
  });

  it("normalizes openapi contracts", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    const openApiContracts = result.contracts.filter(c => c.contract.kind === "openapi");
    assert.ok(openApiContracts.length > 0);
    assert.ok(openApiContracts[0].document.openapi);
    assert.ok(openApiContracts[0].document.paths);
  });

  it("normalizes sequences into design pack", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    assert.ok(result.designPack.sequences.length > 0);
    assert.equal(result.designPack.sequences[0].title, "Login Flow");
    assert.ok(result.designPack.sequences[0].messages.length > 0);
  });

  it("writes artifacts to disk", async () => {
    const proposal = validProposal();
    const normalized = normalizeBlueprintProposal(proposal);
    const tmpDir = await mkdtemp(path.join(tmpdir(), "blueprint-test-"));
    try {
      const writeResult = await writeBlueprintArtifacts(normalized, tmpDir, "test-run");
      assert.equal(writeResult.ok, true);

      // Verify files exist and parse
      const prd = JSON.parse(await readFile(path.join(tmpDir, "prd.json"), "utf8"));
      assert.equal(prd.title, "Build auth with email and password");

      const dp = JSON.parse(await readFile(path.join(tmpDir, "design-pack.json"), "utf8"));
      assert.equal(dp.runId, "test-run");

      const ru = JSON.parse(await readFile(path.join(tmpDir, "responsibility-units.json"), "utf8"));
      assert.ok(ru.units.length > 0);

      const dag = JSON.parse(await readFile(path.join(tmpDir, "work-item-dag.json"), "utf8"));
      assert.ok(dag.nodes.length > 0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("claude-blueprint", () => {
  it("getSystemPrompt returns a non-empty string", () => {
    const prompt = getSystemPrompt();
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.length > 100);
    assert.ok(prompt.includes("BlueprintProposal"));
    assert.ok(prompt.includes("acyclic"));
  });

  it("getBlueprintSchema returns a valid schema object", () => {
    const schema = getBlueprintSchema();
    assert.equal(schema.type, "object");
    assert.ok(schema.required.includes("intent"));
    assert.ok(schema.required.includes("architecture"));
    assert.ok(schema.required.includes("responsibilityUnits"));
    assert.ok(schema.required.includes("contracts"));
    assert.ok(schema.required.includes("workItems"));
    assert.ok(schema.properties.intent);
    assert.ok(schema.properties.architecture);
    assert.ok(schema.properties.workItems);
    assert.ok(schema.properties.sequences);
  });

  it("buildUserPrompt assembles prompt from request and context", () => {
    const prompt = buildUserPrompt("build auth", { packageJson: { name: "test" } }, { maxWorkItems: 5 });
    const parsed = JSON.parse(prompt);
    assert.equal(parsed.userRequest, "build auth");
    assert.deepEqual(parsed.projectContext.packageJson, { name: "test" });
    assert.equal(parsed.constraints.maxWorkItems, 5);
  });

  it("buildUserPrompt uses defaults when context/constraints omitted", () => {
    const prompt = buildUserPrompt("build feature");
    const parsed = JSON.parse(prompt);
    assert.equal(parsed.userRequest, "build feature");
    assert.equal(parsed.constraints.maxWorkItems, 8);
    assert.equal(parsed.constraints.maxDepth, 2);
  });

  it("re-exports validator and normalizer", async () => {
    // The claude-blueprint module re-exports these for convenience
    const mod = await import("../src/plan/claude-blueprint.mjs");
    assert.equal(typeof mod.validateBlueprintProposal, "function");
    assert.equal(typeof mod.normalizeBlueprintProposal, "function");
    assert.equal(typeof mod.writeBlueprintArtifacts, "function");
    assert.ok(Array.isArray(mod.VALIDATION_RULES));
  });

  it("end-to-end: validate → normalize produces valid artifacts", () => {
    const proposal = validProposal();
    const validation = validateBlueprintProposal(proposal);
    assert.equal(validation.ok, true);

    const normalized = normalizeBlueprintProposal(proposal);
    assert.ok(normalized.prd);
    assert.ok(normalized.designPack);
    assert.ok(normalized.responsibilityUnits);
    assert.ok(normalized.workItems.length > 0);
    assert.ok(normalized.workItemDag);
    assert.ok(normalized.contracts.length > 0);

    // All work items have prdId set
    for (const wi of normalized.workItems) {
      assert.ok(wi.prdId, `Work item ${wi.id} should have prdId`);
    }
  });
});
