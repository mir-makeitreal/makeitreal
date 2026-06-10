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
        purpose: "JWT authentication module",
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
        requiredReviewRoles: ["code-quality"],
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

describe("blueprint-validator", () => {
  it("accepts a valid proposal", () => {
    const result = validateBlueprintProposal(validProposal());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.errors.length, 0);
  });

  it("rejects null proposal", () => {
    const result = validateBlueprintProposal(null);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "INVALID_PROPOSAL");
  });

  it("rejects missing required fields", () => {
    const result = validateBlueprintProposal({ title: "test" });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "MISSING_FIELDS");
  });

  it("MODULE_NAMES_UNIQUE — detects duplicate module names", () => {
    const proposal = validProposal();
    proposal.modules.push({ ...proposal.modules[0], ownedPaths: ["src/other/**"] });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "MODULE_NAMES_UNIQUE"));
  });

  it("MODULE_FIELDS_REQUIRED — detects missing module purpose", () => {
    const proposal = validProposal();
    proposal.modules[0].purpose = "";
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "MODULE_FIELDS_REQUIRED"));
  });

  it("MODULE_FIELDS_REQUIRED — detects empty ownedPaths", () => {
    const proposal = validProposal();
    proposal.modules[0].ownedPaths = [];
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "MODULE_FIELDS_REQUIRED"));
  });

  it("REQUIRED_REVIEW_ROLES_REQUIRED — rejects a work item without requiredReviewRoles", () => {
    const proposal = validProposal();
    delete proposal.workItems[0].requiredReviewRoles;
    const result = validateBlueprintProposal(proposal);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.code === "REQUIRED_REVIEW_ROLES_REQUIRED"));
  });

  it("REQUIRED_REVIEW_ROLES_REQUIRED — rejects a non-array requiredReviewRoles", () => {
    const proposal = validProposal();
    proposal.workItems[0].requiredReviewRoles = "code-quality";
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "REQUIRED_REVIEW_ROLES_REQUIRED"));
  });

  it("REQUIRED_REVIEW_ROLES_REQUIRED — accepts an explicit empty array", () => {
    const proposal = validProposal();
    proposal.workItems[0].requiredReviewRoles = [];
    const result = validateBlueprintProposal(proposal);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(!result.errors.some(e => e.code === "REQUIRED_REVIEW_ROLES_REQUIRED"));
  });

  it("CONTRACT_FIELDS_REQUIRED — detects invalid contract type", () => {
    const proposal = validProposal();
    proposal.modules[0].contracts[0].type = "invalid-type";
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "CONTRACT_FIELDS_REQUIRED"));
  });

  it("CONTRACT_FIELDS_REQUIRED — detects missing inputs array", () => {
    const proposal = validProposal();
    delete proposal.modules[0].contracts[0].inputs;
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "CONTRACT_FIELDS_REQUIRED"));
  });

  it("WORK_ITEM_MODULE_REFERENCE_VALID — detects work item referencing unknown module", () => {
    const proposal = validProposal();
    proposal.workItems[0].module = "ghost";
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "WORK_ITEM_MODULE_REFERENCE_VALID"));
  });

  it("WORK_ITEM_MODULE_UNIQUE — detects duplicate work items targeting the same module", () => {
    const proposal = validProposal();
    proposal.workItems.push({ ...proposal.workItems[0] });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "WORK_ITEM_MODULE_UNIQUE"));
  });

  it("WORK_ITEM_DEPENDSON_REFERENCE_VALID — detects work item dependency on unknown module", () => {
    const proposal = validProposal();
    proposal.workItems[0].dependsOn = ["ghost"];
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "WORK_ITEM_DEPENDSON_REFERENCE_VALID"));
  });

  it("MODULE_DEPENDSON_REFERENCE_VALID — detects module dependency on unknown module", () => {
    const proposal = validProposal();
    proposal.modules[0].dependsOn = ["ghost"];
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "MODULE_DEPENDSON_REFERENCE_VALID"));
  });

  it("PATHS_NO_OVERLAP — detects overlapping ownedPaths across modules", () => {
    const proposal = validProposal();
    proposal.modules.push({
      name: "other",
      purpose: "Other module",
      ownedPaths: ["src/auth/**"],
      dependsOn: [],
      contracts: []
    });
    proposal.workItems.push({ module: "other", title: "Build other", dependsOn: [], verifyCommand: "node --test" });
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "PATHS_NO_OVERLAP"));
  });

  it("ALLOWED_PATHS_ARE_VALID — rejects absolute paths", () => {
    const proposal = validProposal();
    proposal.modules[0].ownedPaths.push("/absolute/path");
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "ALLOWED_PATHS_ARE_VALID"));
  });

  it("DAG_IS_ACYCLIC — detects cycles in module dependencies", () => {
    const proposal = validProposal();
    proposal.modules = [
      { name: "a", purpose: "A", ownedPaths: ["src/a/**"], dependsOn: ["b"], contracts: [] },
      { name: "b", purpose: "B", ownedPaths: ["src/b/**"], dependsOn: ["a"], contracts: [] }
    ];
    proposal.workItems = [
      { module: "a", title: "A", dependsOn: [], verifyCommand: "node --test" },
      { module: "b", title: "B", dependsOn: [], verifyCommand: "node --test" }
    ];
    const result = validateBlueprintProposal(proposal);
    assert.ok(result.errors.some(e => e.code === "DAG_IS_ACYCLIC"));
  });

  it("exposes a stable VALIDATION_RULES array", () => {
    assert.ok(Array.isArray(VALIDATION_RULES));
    assert.ok(VALIDATION_RULES.length > 0);
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
    assert.equal(result.prd.acceptanceCriteria[0].id, "AC-001");
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

  it("auto-generates ru.${slug} responsibility unit IDs", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    assert.equal(result.responsibilityUnits.units[0].id, "ru.auth");
    assert.equal(result.workItems[0].responsibilityUnitId, "ru.auth");
  });

  it("auto-generates contract.${moduleSlug}.${contractSlug} contract IDs", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    const contractIds = result.contracts.map(c => c.contract.contractId);
    assert.ok(contractIds.includes("contract.auth.post-auth-login"));
  });

  it("auto-generates work.${slug} work item IDs", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    assert.equal(result.workItems[0].id, "work.auth");
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

  it("preserves a declared acceptanceCriteriaIds trace on the work item", () => {
    const proposal = validProposal();
    proposal.workItems[0].acceptanceCriteriaIds = ["AC-002"];
    const result = normalizeBlueprintProposal(proposal);
    assert.deepEqual(result.workItems[0].prdTrace.acceptanceCriteriaIds, ["AC-002"]);
  });

  it("traces all PRD criteria when acceptanceCriteriaIds is not declared (backward compatibility)", () => {
    const result = normalizeBlueprintProposal(validProposal());
    assert.deepEqual(result.workItems[0].prdTrace.acceptanceCriteriaIds, ["AC-001", "AC-002"]);
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

  it("normalizes http contracts as openapi specs", () => {
    const proposal = validProposal();
    const result = normalizeBlueprintProposal(proposal);
    const httpContracts = result.contracts.filter(c => c.contract.kind === "openapi");
    assert.ok(httpContracts.length > 0);
    assert.ok(httpContracts[0].document.openapi);
    assert.ok(httpContracts[0].document.paths);
  });

  it("normalizes scenarios into design pack sequences", () => {
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

  it("getBlueprintSchema returns the new flat schema", () => {
    const schema = getBlueprintSchema();
    assert.equal(schema.type, "object");
    assert.ok(schema.required.includes("title"));
    assert.ok(schema.required.includes("summary"));
    assert.ok(schema.required.includes("modules"));
    assert.ok(schema.required.includes("workItems"));
    assert.ok(schema.properties.modules);
    assert.ok(schema.properties.workItems);
    assert.ok(schema.properties.scenarios);
  });

  it("buildUserPrompt assembles prompt from request and context", () => {
    const prompt = buildUserPrompt("build auth", { packageJson: { name: "test" } }, { maxWorkItems: 5 });
    const parsed = JSON.parse(prompt);
    assert.equal(parsed.userRequest, "build auth");
    assert.deepEqual(parsed.projectContext.packageJson, { name: "test" });
    assert.equal(parsed.constraints.maxWorkItems, 5);
  });

  it("buildUserPrompt uses no engine-imposed limits when context/constraints omitted", () => {
    const prompt = buildUserPrompt("build feature");
    const parsed = JSON.parse(prompt);
    assert.equal(parsed.userRequest, "build feature");
    assert.equal(parsed.constraints.maxWorkItems, undefined);
    assert.equal(parsed.constraints.maxDepth, undefined);
  });

  it("re-exports validator and normalizer", async () => {
    const mod = await import("../src/plan/claude-blueprint.mjs");
    assert.equal(typeof mod.validateBlueprintProposal, "function");
    assert.equal(typeof mod.normalizeBlueprintProposal, "function");
    assert.equal(typeof mod.writeBlueprintArtifacts, "function");
    assert.ok(Array.isArray(mod.VALIDATION_RULES));
  });

  it("end-to-end: validate → normalize produces valid artifacts", () => {
    const proposal = validProposal();
    const validation = validateBlueprintProposal(proposal);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors));

    const normalized = normalizeBlueprintProposal(proposal);
    assert.ok(normalized.prd);
    assert.ok(normalized.designPack);
    assert.ok(normalized.responsibilityUnits);
    assert.ok(normalized.workItems.length > 0);
    assert.ok(normalized.workItemDag);
    assert.ok(normalized.contracts.length > 0);

    for (const wi of normalized.workItems) {
      assert.ok(wi.prdId, `Work item ${wi.id} should have prdId`);
    }
  });
});
