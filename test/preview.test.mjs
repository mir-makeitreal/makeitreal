import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decideBlueprintReview } from "../src/blueprint/review.mjs";
import { importBlueprint, minimalProposal } from "./helpers/blueprint-import.mjs";
import { buildOperatorCockpitModel } from "../src/preview/operator-cockpit-model.mjs";
import { renderDashboardHtml } from "../src/preview/render-dashboard-html.mjs";
import { renderDesignPreview } from "../src/preview/render-preview.mjs";
import { fileExists, readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { withFixture } from "./helpers/fixture.mjs";

async function snapshot(paths) {
  const out = {};
  for (const filePath of paths) {
    try {
      out[filePath] = await readFile(filePath, "utf8");
    } catch {
      out[filePath] = null;
    }
  }
  return out;
}

async function addMultiModuleSystemDossierFixture(runDir) {
  const designPackPath = path.join(runDir, "design-pack.json");
  const responsibilityUnitsPath = path.join(runDir, "responsibility-units.json");

  const designPack = await readJsonFile(designPackPath);
  const responsibilityUnits = await readJsonFile(responsibilityUnitsPath);

  designPack.apiSpecs = [
    ...designPack.apiSpecs,
    {
      kind: "none",
      contractId: "contract.auth.session",
      reason: "Internal session contract declared for the Auth Service boundary."
    }
  ];

  designPack.architecture = {
    nodes: [
      { id: "auth-ui", label: "Auth UI", responsibilityUnitId: "ru.frontend" },
      { id: "auth-service", label: "Auth Service", responsibilityUnitId: "ru.backend" }
    ],
    edges: [
      { from: "auth-ui", to: "auth-service", contractId: "contract.auth.login" },
      { from: "auth-service", to: "auth-ui", contractId: "contract.auth.session" }
    ]
  };

  designPack.responsibilityBoundaries = [
    {
      responsibilityUnitId: "ru.frontend",
      owns: ["web/src/auth/**"],
      mayUseContracts: ["contract.auth.login", "contract.auth.session"]
    },
    {
      responsibilityUnitId: "ru.backend",
      owns: ["api/src/auth/**"],
      mayUseContracts: ["contract.auth.login", "contract.auth.session"]
    }
  ];

  designPack.moduleInterfaces = [
    {
      responsibilityUnitId: "ru.frontend",
      owner: "team.frontend",
      moduleName: "Auth UI",
      purpose: "Owns login form interaction and displays the declared session result.",
      owns: ["web/src/auth/**"],
      publicSurfaces: [
        {
          name: "LoginForm.submit",
          kind: "component-action",
          description: "Submits declared credentials and renders a declared session state.",
          contractIds: ["contract.auth.login", "contract.auth.session"],
          consumers: ["Auth Service", "Playwright auth flow"],
          signature: {
            inputs: [
              { name: "credentials.email", type: "string", required: true, description: "User email." },
              { name: "credentials.password", type: "string", required: true, description: "User password." }
            ],
            outputs: [
              { name: "sessionResult", type: "AuthSessionResult", description: "Declared session outcome." }
            ],
            errors: [
              { code: "AUTH_LOGIN_REJECTED", when: "Credentials are rejected.", handling: "Render declared error state." }
            ]
          }
        }
      ],
      imports: [
        {
          contractId: "contract.auth.login",
          providerResponsibilityUnitId: "ru.backend",
          surface: "POST /auth/login",
          allowedUse: "Submit login credentials only through the declared contract."
        }
      ]
    },
    {
      responsibilityUnitId: "ru.backend",
      owner: "team.backend",
      moduleName: "Auth Service",
      purpose: "Owns credential validation and session response creation.",
      owns: ["api/src/auth/**"],
      publicSurfaces: [
        {
          name: "POST /auth/login",
          kind: "http",
          description: "Validates credentials and returns a declared session result.",
          contractIds: ["contract.auth.login"],
          consumers: ["Auth UI"],
          signature: {
            inputs: [
              { name: "requestBody", type: "AuthLoginRequest", required: true, fields: ["email", "password"], description: "Declared login request." }
            ],
            outputs: [
              { name: "200 response", type: "AuthSessionResult", description: "Successful session result." }
            ],
            errors: [
              { code: "401", when: "Credentials are invalid.", handling: "Return declared auth rejection." }
            ]
          }
        }
      ],
      imports: [
        {
          contractId: "contract.auth.session",
          providerResponsibilityUnitId: "ru.frontend",
          surface: "SessionStore.issue",
          allowedUse: "Issue a session result after credential validation."
        }
      ]
    }
  ];

  designPack.callStacks = [
    {
      entrypoint: "LoginForm.submit",
      calls: [
        "validate component input contract",
        "POST /auth/login via contract.auth.login",
        "render AuthSessionResult or AUTH_LOGIN_REJECTED"
      ]
    },
    {
      entrypoint: "POST /auth/login",
      calls: [
        "validate AuthLoginRequest",
        "validate credentials",
        "SessionStore.issue via contract.auth.session",
        "return AuthSessionResult or 401"
      ]
    }
  ];

  designPack.sequences = [
    {
      title: "Login session creation",
      participants: ["User", "Auth UI", "Auth Service", "Session Store"],
      messages: [
        { from: "User", to: "Auth UI", label: "submit credentials" },
        { from: "Auth UI", to: "Auth Service", label: "contract.auth.login" },
        { from: "Auth Service", to: "Session Store", label: "contract.auth.session" },
        { from: "Auth Service", to: "Auth UI", label: "AuthSessionResult or 401" }
      ]
    }
  ];

  responsibilityUnits.units = [
    {
      id: "ru.frontend",
      owner: "team.frontend",
      owns: ["web/src/auth/**"],
      publicSurfaces: ["LoginForm.submit"],
      mayUseContracts: ["contract.auth.login", "contract.auth.session"],
      mustProvideContracts: ["contract.auth.session"]
    },
    {
      id: "ru.backend",
      owner: "team.backend",
      owns: ["api/src/auth/**"],
      publicSurfaces: ["POST /auth/login"],
      mayUseContracts: ["contract.auth.login", "contract.auth.session"],
      mustProvideContracts: ["contract.auth.login"]
    }
  ];

  const authUiWorkItem = {
    schemaVersion: "1.0",
    id: "work.auth-ui",
    prdId: designPack.prdId,
    title: "Implement Auth UI login boundary",
    lane: "Contract Frozen",
    responsibilityUnitId: "ru.frontend",
    contractIds: ["contract.auth.login", "contract.auth.session"],
    dependencyContracts: [
      {
        contractId: "contract.auth.login",
        providerResponsibilityUnitId: "ru.backend",
        surface: "POST /auth/login",
        allowedUse: "Submit login credentials only through the declared contract."
      }
    ],
    dependsOn: ["work.auth-service"],
    allowedPaths: ["web/src/auth/**"],
    doneEvidence: [
      { kind: "verification", path: "evidence/work.auth-ui.verification.json" },
      { kind: "wiki-sync", path: "evidence/work.auth-ui.wiki-sync.json" }
    ]
  };
  const authServiceWorkItem = {
    schemaVersion: "1.0",
    id: "work.auth-service",
    prdId: designPack.prdId,
    title: "Implement Auth Service login contract",
    lane: "Contract Frozen",
    responsibilityUnitId: "ru.backend",
    contractIds: ["contract.auth.login"],
    dependencyContracts: [],
    dependsOn: [],
    allowedPaths: ["api/src/auth/**"],
    doneEvidence: [
      { kind: "verification", path: "evidence/work.auth-service.verification.json" },
      { kind: "wiki-sync", path: "evidence/work.auth-service.wiki-sync.json" }
    ]
  };
  const workItemDag = {
    schemaVersion: "1.0",
    runId: designPack.runId,
    nodes: [
      { id: "work.auth-service", kind: "implementation", responsibilityUnitId: "ru.backend", requiredForDone: true },
      { id: "work.auth-ui", kind: "implementation", responsibilityUnitId: "ru.frontend", requiredForDone: true }
    ],
    edges: [
      { from: "work.auth-service", to: "work.auth-ui", kind: "contract-dependency", contractId: "contract.auth.login" }
    ]
  };

  await writeJsonFile(designPackPath, designPack);
  await writeJsonFile(responsibilityUnitsPath, responsibilityUnits);
  await writeJsonFile(path.join(runDir, "work-items", "work.auth-ui.json"), authUiWorkItem);
  await writeJsonFile(path.join(runDir, "work-items", "work.auth-service.json"), authServiceWorkItem);
  await writeJsonFile(path.join(runDir, "work-item-dag.json"), workItemDag);
}

test("operator cockpit maps phases to a read-only first-run guide", () => {
  const cockpit = buildOperatorCockpitModel({
    status: {
      phase: "approval-required",
      blueprintStatus: "pending",
      nextActionCode: "approve",
      nextCommand: "/makeitreal:plan approve",
      evidenceSummary: [
        {
          kind: "verification",
          summary: "Verification passed",
          path: "evidence/verification.json"
        }
      ]
    }
  });

  assert.equal(cockpit.readOnly, true);
  assert.equal(cockpit.controlSurface, "claude-code");
  assert.equal(cockpit.phase, "approval-required");
  assert.equal(cockpit.blueprintStatus, "pending");
  assert.equal(cockpit.nextCommand, "/makeitreal:plan approve");
  assert.deepEqual(
    cockpit.firstRunChecklist.map((step) => [step.id, step.status]),
    [
      ["plugin", "complete"],
      ["plan", "complete"],
      ["blueprint-review", "current"],
      ["launch", "pending"],
      ["verification", "pending"],
      ["done", "pending"]
    ]
  );
  assert.deepEqual(cockpit.evidenceLinks, [
    {
      kind: "verification",
      summary: "Verification passed",
      path: "evidence/verification.json",
      href: "../evidence/verification.json"
    }
  ]);
});

test("dashboard renderer requires the contract-first system dossier", () => {
  assert.throws(
    () => renderDashboardHtml({
      blueprint: {},
      run: { workItemId: "work.missing-dossier" },
      status: {},
      operatorCockpit: null,
      board: null
    }),
    /HARNESS_PREVIEW_MODEL_INVALID: blueprint\.systemDossier is required/
  );
});

test("renders canonical architecture preview", async () => {
  await withFixture(async ({ runDir }) => {
    const watched = [
      path.join(runDir, "prd.json"),
      path.join(runDir, "design-pack.json"),
      path.join(runDir, "responsibility-units.json"),
      path.join(runDir, "blueprint-review.json"),
      path.join(runDir, "contracts", "auth-login.openapi.json"),
      path.join(runDir, "work-items", "work.feature-auth.json"),
      path.join(runDir, "evidence", "verification.json"),
      path.join(runDir, "runtime-state.json")
    ];
    const before = await snapshot(watched);
    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);
    assert.match(result.dashboardRefresh.dashboardUrl, /^file:\/\//);
    assert.equal(result.dashboardRefresh.indexPath, path.join(runDir, "preview", "index.html"));
    assert.deepEqual(await snapshot(watched), before);

    const previewDir = path.join(runDir, "preview");
    assert.equal(await fileExists(path.join(previewDir, "index.html")), true);
    assert.equal(await fileExists(path.join(previewDir, "preview.css")), true);
    assert.equal(await fileExists(path.join(previewDir, "preview.js")), true);
    assert.equal((await readJsonFile(path.join(previewDir, "design-pack.json"))).workItemId, "work.feature-auth");
    assert.equal((await readJsonFile(path.join(previewDir, "preview-meta.json"))).statusSource, "readRunStatus/readBoardStatus");
    assert.equal((await readJsonFile(path.join(previewDir, "operator-status.json"))).runStatus.blueprintStatus, "approved");

    const previewModel = await readJsonFile(path.join(previewDir, "preview-model.json"));
    assert.equal(previewModel.blueprint.title, "Authentication vertical slice");
    assert.deepEqual(previewModel.blueprint.summary, [
      "A user can submit credentials through the auth UI and receive a session result from the declared auth login contract."
    ]);
    assert.equal(previewModel.blueprint.primaryContract.contractId, "contract.auth.login");
    assert.equal(previewModel.blueprint.contracts[0].path, "contracts/auth-login.openapi.json");
    assert.equal(previewModel.blueprint.boundaries[0].responsibilityUnitId, "ru.frontend");
    assert.equal(previewModel.blueprint.moduleInterfaces[0].responsibilityUnitId, "ru.frontend");
    assert.equal(previewModel.blueprint.moduleInterfaces[0].moduleName, "Auth UI");
    assert.equal(previewModel.blueprint.moduleInterfaces[0].publicSurfaces[0].name, "LoginForm.submit");
    assert.equal(previewModel.blueprint.moduleInterfaces[0].publicSurfaces[0].signature.inputs[0].name, "credentials.email");
    assert.equal(previewModel.blueprint.moduleInterfaces[0].publicSurfaces[0].signature.outputs[0].name, "sessionResult");
    assert.equal(previewModel.blueprint.moduleInterfaces[0].publicSurfaces[0].signature.errors[0].code, "AUTH_LOGIN_REJECTED");
    assert.deepEqual(previewModel.blueprint.systemDossier.contractMatrix[0].providers, ["Auth Service"]);
    assert.deepEqual(previewModel.blueprint.systemDossier.contractMatrix[0].consumers, ["Auth UI"]);
    assert.deepEqual(previewModel.blueprint.systemDossier.approvalScope.requiredWorkItems, ["work.feature-auth"]);
    assert.equal(previewModel.blueprint.systemDossier.approvalScope.authorizedPaths.includes("apps/web/auth/**"), true);
    assert.equal(previewModel.blueprint.systemDossier.approvalScope.requiredContracts.includes("contract.auth.login"), true);
    assert.equal(previewModel.blueprint.systemDossier.taskDag.nodes.some((node) => node.id === "work.feature-auth"), true);
    assert.equal(previewModel.blueprint.systemDossier.workerTopology.assignments.some((assignment) => assignment.evidenceRole === "implementation-worker"), true);
    assert.equal(previewModel.blueprint.acceptanceCriteria[0].id, "AC-001");
    const importEdge = previewModel.blueprint.systemDossier.dependencyEdges.find((edge) => edge.from === "ru.frontend");
    assert.equal(importEdge.toLabel, "Auth Service");
    assert.equal(importEdge.surface, "POST /auth/login");

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    for (const label of [
      "Architecture Dossier",
      "Blueprint Fingerprint",
      "Architecture Topology",
      "Execution Plan",
      "Worker Topology",
      "Scenarios",
      "Modules",
      "Review Decisions",
      "Verification Evidence",
      "Sources",
      "Diagnostics",
      "Inputs",
      "Outputs",
      "Usage Example",
      "Board State"
    ]) {
      assert.match(html, new RegExp(label));
    }
    assert.doesNotMatch(html, /<a href="#artifacts">Raw Artifacts<\/a>/);
    assert.doesNotMatch(html, /<a href="#runtime">Runtime Snapshot<\/a>/);
    assert.doesNotMatch(html, /<h2>Kanban Board<\/h2>/);
    assert.doesNotMatch(html, /<div class="reference-grid"/);
    assert.doesNotMatch(html, /<aside class="runtime-rail/);
    assert.match(html, /email: &quot;user@example\.com&quot;/);
    assert.match(html, /password: &quot;correct horse battery staple&quot;/);
    assert.match(html, /body: JSON\.stringify\(requestBody\)/);
    assert.match(html, /const session = await httpResponse\.json\(\);/);
    assert.doesNotMatch(html, /const 200\.session/);
    assert.doesNotMatch(html, /body: JSON\.stringify\(\{\}\)/);
    assert.doesNotMatch(html, /POST \/auth\/login\(&quot;user@example\.com&quot;/);
    assert.doesNotMatch(html, /Surface the declared auth error state; do not infer fallback session behavior\.<\/span><p>Surface the declared auth error state/);
    assert.match(html, /data-live-kanban/);
    assert.match(html, /data-operator-kanban="true"/);
    assert.match(html, /data-nav-filter/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /sequenceDiagram/);
    assert.match(html, /flowchart LR/);
    assert.match(html, /schema-display/);
    assert.match(html, /file-tree/);
    assert.match(html, /sources-list/);
    assert.match(html, /test-results/);
    assert.match(html, /workflow-graph/);
    assert.match(html, /task-dag-table/);
    assert.match(html, /worker-topology-list/);
    assert.match(html, /apps\/web\/auth\/\*\*/);
    assert.match(html, /work\.feature-auth/);
    assert.match(html, /implementation-worker/);
    assert.match(html, /code-block/);
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/mermaid/);
    assert.doesNotMatch(html, /data-harness-action=/);
    assert.doesNotMatch(html, /makeitreal-engine blueprint approve/);
    assert.doesNotMatch(html, /makeitreal-engine orchestrator tick/);

    const js = await readFile(path.join(previewDir, "preview.js"), "utf8");
    assert.match(js, /makeitreal:auto-reload/);
    assert.match(js, /preview-model\.json/);
    assert.match(js, /updateRuntime/);
    assert.match(js, /data-live-kanban/);
    assert.match(js, /bindNavFilter/);
    assert.match(js, /data-nav-filter/);
    assert.doesNotMatch(js, /data-live-module-count/);
    assert.doesNotMatch(js, /data-live-contract-count/);
    assert.doesNotMatch(js, /data-live-edge-count/);
    assert.doesNotMatch(js, /location\.reload/);
    assert.doesNotMatch(js, /setInterval\(reloadDashboard/);
    assert.match(js, /window\.location\.protocol/);
    assert.match(js, /"file:"/);
    assert.match(js, /navigator\.clipboard\.writeText/);
    assert.match(js, /copy-command/);
    assert.doesNotMatch(js, /makeitreal-engine/);
    assert.doesNotMatch(js, /fetch\([^)]*blueprint/);
    assert.doesNotMatch(js, /fetch\([^)]*orchestrator/);

    const css = await readFile(path.join(previewDir, "preview.css"), "utf8");
    assert.match(css, /\.architecture-shell/);
    assert.match(css, /\.architecture-nav/);
    assert.match(css, /\.architecture-main/);
    assert.match(css, /\.responsibility-map/);
    assert.match(css, /\.schema-display/);
    assert.match(css, /\.file-tree/);
    assert.match(css, /\.sources-list/);
    assert.match(css, /\.test-results/);
    assert.match(css, /\.workflow-graph/);
    assert.match(css, /\.sdk-example/);
    assert.match(css, /\.diagram-card/);
    assert.match(css, /\.task-dag-table/);
    assert.match(css, /\.worker-topology-list/);
    assert.match(css, /\.mermaid/);
    assert.match(css, /\.compact-kanban/);
  });
});

test("preview renders a multi-module system Blueprint dossier", async () => {
  await withFixture(async ({ runDir }) => {
    await addMultiModuleSystemDossierFixture(runDir);
    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);

    const previewDir = path.join(runDir, "preview");
    const previewModel = await readJsonFile(path.join(previewDir, "preview-model.json"));
    const dossier = previewModel.blueprint.systemDossier;

    assert.equal(dossier.title, "Authentication vertical slice");
    assert.equal(dossier.modules.length, 2);
    assert.deepEqual(dossier.modules.map((module) => module.moduleName), ["Auth UI", "Auth Service"]);
    assert.equal(dossier.modules[0].publicSurfaces[0].name, "LoginForm.submit");
    assert.equal(dossier.modules[1].publicSurfaces[0].name, "POST /auth/login");
    assert.deepEqual(dossier.dependencyEdges.map((edge) => edge.contractId), [
      "contract.auth.login",
      "contract.auth.session"
    ]);
    const loginImportEdge = dossier.dependencyEdges.find((edge) => edge.from === "ru.frontend");
    assert.equal(loginImportEdge.to, "ru.backend");
    assert.equal(loginImportEdge.toLabel, "Auth Service");
    assert.equal(loginImportEdge.surface, "POST /auth/login");
    assert.equal(dossier.contractMatrix.length, 2);
    assert.deepEqual(dossier.contractMatrix.find((contract) => contract.contractId === "contract.auth.login").providers, ["Auth Service"]);
    assert.deepEqual(dossier.contractMatrix.find((contract) => contract.contractId === "contract.auth.login").consumers, ["Auth UI"]);
    assert.equal(dossier.signalFlows[0].title, "Login session creation");
    assert.equal(dossier.callStacks.length, 2);
    assert.deepEqual(dossier.approvalScope.requiredWorkItems, ["work.auth-service", "work.auth-ui"]);
    assert.equal(dossier.approvalScope.authorizedPaths.includes("web/src/auth/**"), true);
    assert.equal(dossier.approvalScope.authorizedPaths.includes("api/src/auth/**"), true);
    assert.equal(dossier.approvalScope.requiredContracts.includes("contract.auth.login"), true);
    assert.equal(dossier.taskDag.nodes.some((node) => node.id === "work.auth-ui" && node.moduleName === "Auth UI"), true);
    assert.equal(dossier.taskDag.nodes.some((node) => node.id === "work.auth-service" && node.moduleName === "Auth Service"), true);
    assert.equal(dossier.taskDag.edges.some((edge) => edge.from === "work.auth-service" && edge.to === "work.auth-ui" && edge.contractId === "contract.auth.login"), true);
    assert.equal(dossier.workerTopology.assignments.some((assignment) => assignment.workItemId === "work.auth-ui" && assignment.evidenceRole === "implementation-worker"), true);
    assert.equal(dossier.deliveryScope.ownedPaths.includes("web/src/auth/**"), true);
    assert.equal(dossier.deliveryScope.ownedPaths.includes("api/src/auth/**"), true);
    assert.equal(dossier.systemPlacement.title, "Authentication vertical slice");
    assert.equal(dossier.systemPlacement.summary, "2 responsibility units (Auth UI, Auth Service) communicate only through 2 declared contract edges.");
    assert.deepEqual(dossier.systemPlacement.modules.map((module) => module.moduleName), ["Auth UI", "Auth Service"]);
    assert.equal(dossier.scenarioIndex[0].title, "Login session creation");
    assert.equal(dossier.scenarioIndex[0].visualizationKind, "mermaid");
    assert.equal(dossier.scenarioDetails[0].participants.includes("Auth UI"), true);
    assert.equal(dossier.surfaceTraceReference.some((trace) =>
      trace.surfaceName === "POST /auth/login"
      && trace.consumers.includes("Auth UI")
      && trace.callStacks.includes("POST /auth/login")
      && trace.scenarios.includes("Login session creation")
    ), true);
    assert.equal(dossier.reviewDecisions.some((decision) => decision.includes("Blueprint review is approved")), true);
    // Doctrine: engine no longer fabricates per-module review prose; only the declared review summary remains.
    assert.equal(dossier.reviewDecisions.length, 1);
    assert.equal(dossier.reviewDecisions.some((decision) => decision.includes("owns")), false);
    assert.equal(dossier.sources.some((source) => source.path === "design-pack.json"), true);
    assert.equal(dossier.modules[0].ownedFileTree.name, "web");
    assert.equal(dossier.contractSurfaces.some((surface) => surface.name === "POST /auth/login"), true);

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    for (const label of [
      "Architecture Dossier",
      "Blueprint Fingerprint",
      "Architecture Topology",
      "Execution Plan",
      "Worker Topology",
      "Scenarios",
      "Modules",
      "Review Decisions",
      "Verification Evidence",
      "Sources",
      "Diagnostics"
    ]) {
      assert.match(html, new RegExp(label));
    }
    assert.match(html, /Auth UI/);
    assert.match(html, /Auth Service/);
    assert.match(html, /href="#module-0-auth-ui"/);
    assert.match(html, /href="#module-1-auth-service"/);
    assert.match(html, /id="module-0-auth-ui"/);
    assert.match(html, /id="module-1-auth-service"/);
    assert.match(html, /id="module-0-auth-ui-surface-0-loginform-submit"/);
    assert.match(html, /id="module-1-auth-service-surface-0-post-auth-login"/);
    assert.match(html, /LoginForm\.submit/);
    assert.match(html, /POST \/auth\/login/);
    assert.match(html, /const response = await httpResponse\.json\(\);/);
    assert.match(html, /body: JSON\.stringify\(requestBody\)/);
    assert.match(html, /contract\.auth\.login/);
    assert.match(html, /contract\.auth\.session/);
    assert.match(html, /work\.auth-ui/);
    assert.match(html, /work\.auth-service/);
    assert.match(html, /api\/src\/auth\/\*\*/);
    assert.match(html, /Native Claude Code Task/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /Auth UI/);
    assert.match(html, /Auth Service/);
    assert.doesNotMatch(html, /const 200 response/);
    assert.doesNotMatch(html, /body: JSON\.stringify\(\{\}\)/);
    assert.doesNotMatch(html, /POST \/auth\/login\(\{\}\)/);
    assert.match(html, /schema-display/);
    assert.match(html, /file-tree/);
    assert.match(html, /sources-list/);
    assert.match(html, /test-results/);
    assert.match(html, /workflow-graph/);
    assert.doesNotMatch(html, /data-harness-action=/);
    assert.doesNotMatch(html, /makeitreal-engine blueprint approve/);
    assert.doesNotMatch(html, /makeitreal-engine orchestrator tick/);

    const css = await readFile(path.join(previewDir, "preview.css"), "utf8");
    for (const selector of [
      ".architecture-shell",
      ".architecture-nav",
      ".architecture-main",
      ".diagram-card",
      ".mermaid",
      ".nav-group",
      ".nav-module",
      ".nav-surface",
      ".nav-filter",
      ".responsibility-map",
      ".contract-surface-list",
      ".schema-display",
      ".file-tree",
      ".sources-list",
      ".test-results",
      ".workflow-graph",
      ".sdk-example",
      ".task-dag-table",
      ".worker-topology-list",
      ".scenario-index"
    ]) {
      assert.match(css, new RegExp(selector.replace(".", "\\.")));
    }
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /grid-template-columns:\s*minmax\(220px,\s*260px\)\s+minmax\(0,\s*980px\)/);
  });
});

test("preview cockpit copies replan command for rejected Blueprint", async () => {
  await withFixture(async ({ root, runDir }) => {
    const rejection = await decideBlueprintReview({
      runDir,
      status: "rejected",
      reviewedBy: "operator:test",
      note: "Revise the responsibility boundary.",
      now: new Date("2026-05-06T00:00:01.000Z")
    });
    assert.equal(rejection.ok, true);

    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);

    const previewDir = path.join(runDir, "preview");
    const model = await readJsonFile(path.join(previewDir, "preview-model.json"));
    assert.equal(model.status.nextActionCode, "plan");
    assert.equal(model.status.nextCommand, "/makeitreal:plan <request>");
    assert.equal(model.operatorCockpit.nextCommand, "/makeitreal:plan <request>");

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    assert.match(html, /Next Claude Code action/);
    assert.match(html, /\/makeitreal:plan &lt;request&gt;/);
    assert.doesNotMatch(html, /\/makeitreal:plan approve/);
  });
});

test("preview projects approved launch board state without mutating control-plane artifacts", async () => {
  await withFixture(async ({ root }) => {
    const plan = await importBlueprint({
      projectRoot: root,
      proposal: minimalProposal({
        title: "Previewed Report Module",
        workItemId: "wi.previewed-report",
        ruId: "ru.previewed-report",
        allowedPaths: ["modules/previewed-report/**"],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('previewed report ok')"] }]
      }),
      runId: "previewed-report",
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    // The status surface only treats Ready-lane items as launchable, so move the
    // work item to Ready to project a genuine launch-ready board before preview.
    const boardPath = path.join(plan.runDir, "board.json");
    const launchBoard = await readJsonFile(boardPath);
    for (const item of launchBoard.workItems) {
      item.lane = "Ready";
    }
    await writeJsonFile(boardPath, launchBoard);

    const approval = await decideBlueprintReview({
      runDir: plan.runDir,
      status: "approved",
      reviewedBy: "operator:test",
      now: new Date("2026-05-06T00:00:01.000Z")
    });
    assert.equal(approval.ok, true);

    const watched = [
      path.join(plan.runDir, "board.json"),
      path.join(plan.runDir, "work-items", `${plan.workItemId}.json`),
      path.join(plan.runDir, "evidence", "verification.json"),
      path.join(plan.runDir, "claims", `${plan.workItemId}.json`),
      path.join(plan.runDir, "runtime-state.json"),
      path.join(plan.runDir, "trust-policy.json"),
      path.join(plan.runDir, "prd.json"),
      path.join(plan.runDir, "design-pack.json"),
      path.join(plan.runDir, "responsibility-units.json"),
      path.join(plan.runDir, "blueprint-review.json")
    ];
    const before = await snapshot(watched);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);
    assert.deepEqual(await snapshot(watched), before);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /class="kanban-lane"/);
    assert.match(html, /data-lane="Planned"/);
    assert.doesNotMatch(html, /data-lane="Contract Frozen"/);
    assert.match(html, /class="work-card"/);
    assert.match(html, /\/makeitreal:launch/);
    assert.doesNotMatch(html, /board claim/);
    assert.doesNotMatch(html, /orchestrator tick/);
    assert.doesNotMatch(html, />gate</);

    const model = await readJsonFile(path.join(plan.runDir, "preview", "preview-model.json"));
    assert.equal(model.board.lanes.find((lane) => lane.name === "Ready").workItems[0].id, plan.workItemId);
  });
});

test("preview renders long implementation requests as compact reference docs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-preview-"));
  try {
    const plan = await importBlueprint({
      projectRoot: root,
      proposal: {
        title: "Normalize Display Name",
        summary: "Implement a pure JavaScript display-name normalization responsibility unit. Create src/normalize-name.mjs exporting normalizeDisplayName(input) and test/normalize-name.test.mjs. Contract: input must be a string, trim leading/trailing whitespace, collapse internal whitespace to one space, throw TypeError with code DISPLAY_NAME_INVALID for non-string or empty normalized value. Verification command is npm test.",
        goals: [
          "Implement normalizeDisplayName(input) inside src/normalize-name.mjs, test/normalize-name.test.mjs.",
          "Expose normalizeDisplayName with the declared input, output, and error contract.",
          "Verify the responsibility unit with npm test."
        ],
        nonGoals: [],
        acceptanceCriteria: [
          "normalizeDisplayName is the only public surface for the normalize-name responsibility unit.",
          "Inputs are explicitly validated: input must be a non-empty string after trimming.",
          "Successful execution returns the normalized display name string.",
          "Invalid or out-of-contract calls fail fast through DISPLAY_NAME_INVALID.",
          "Ready gate passes before implementation starts."
        ],
        assumptions: [],
        modules: [{
          name: "Normalize Display Name",
          purpose: "Display name normalization with whitespace handling.",
          ownedPaths: ["src/normalize-name.mjs", "test/normalize-name.test.mjs"],
          dependsOn: [],
          contracts: [{
            name: "normalizeDisplayName",
            type: "function",
            inputs: [{ name: "input", type: "string", required: true }],
            outputs: [{ name: "normalizedName", type: "string" }],
            errors: [{ code: "DISPLAY_NAME_INVALID", when: "Input is not a string or empty after trimming." }]
          }]
        }],
        workItems: [{
          module: "Normalize Display Name",
          title: "Normalize Display Name",
          dependsOn: [],
          verifyCommand: "npm test",
          complexity: "small"
        }],
        scenarios: [{
          title: "normalizeDisplayName contract call",
          steps: [
            { from: "Caller", to: "NormalizeDisplayName", action: "normalizeDisplayName(input)" },
            { from: "NormalizeDisplayName", to: "Caller", action: "returns normalized string" }
          ]
        }]
      },
      runId: "display-name-normalizer",
      now: new Date("2026-05-11T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /<h1>Normalize Display Name<\/h1>/);
    assert.match(html, /normalizeDisplayName/);
    assert.match(html, /Original request/);
    assert.match(html, /display-name normalization responsibility unit/);
    assert.match(html, /Boundary enforcement/);
    assert.match(html, /Architecture Dossier/);
    assert.match(html, /SDK Reference/);
    assert.match(html, /Usage Example/);
    assert.match(html, /Board State/);

    const css = await readFile(path.join(plan.runDir, "preview", "preview.css"), "utf8");
    assert.match(css, /grid-template-columns: minmax\(220px, 260px\) minmax\(0, 980px\)/);
    assert.match(css, /\.architecture-shell/);
    assert.doesNotMatch(css, /grid-template-columns: 220px minmax\(0, 1fr\) 300px/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview renders API dossiers with concise responsibility labels", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-preview-"));
  try {
    const plan = await importBlueprint({
      projectRoot: root,
      proposal: {
        title: "Orders API",
        summary: "Build REST endpoint POST /api/v1/orders with customerId, items, shippingAddress, Idempotency-Key header, Postgres idempotency, Kafka OrderCreated, 201, 400, 409, 422",
        goals: ["Deliver POST /api/v1/orders endpoint."],
        nonGoals: ["No GET endpoints in this scope."],
        acceptanceCriteria: [
          "POST /api/v1/orders returns 201 on success.",
          "Idempotency-Key prevents duplicate orders (409)."
        ],
        assumptions: [],
        modules: [{
          name: "Orders API",
          purpose: "HTTP contract surface for POST /api/v1/orders.",
          ownedPaths: ["src/api/orders/**"],
          dependsOn: [],
          contracts: [{
            name: "POST /api/v1/orders",
            type: "http",
            inputs: [
              { name: "customerId", type: "string", required: true },
              { name: "items", type: "array", required: true },
              { name: "shippingAddress", type: "object", required: true }
            ],
            outputs: [{ name: "order", type: "object" }],
            errors: [
              { code: "400", when: "Invalid request payload." },
              { code: "409", when: "Duplicate Idempotency-Key." },
              { code: "422", when: "Unprocessable entity." }
            ]
          }]
        }],
        workItems: [{
          module: "Orders API",
          title: "Orders API",
          dependsOn: [],
          verifyCommand: "node -e console.log('orders api ok')",
          complexity: "medium"
        }],
        scenarios: [{
          title: "POST /api/v1/orders contract call",
          steps: [
            { from: "Client", to: "Orders API", action: "POST /api/v1/orders(customerId, items, shippingAddress)" },
            { from: "Orders API", to: "Client", action: "returns 201 with order" }
          ]
        }]
      },
      runId: "orders-api-dossier",
      now: new Date("2026-05-12T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /<h1>Orders API<\/h1>/);
    assert.match(html, /<a class="nav-module" href="#module-0-orders-api">Orders API<\/a>/);
    assert.match(html, /<a class="nav-surface" href="#module-0-orders-api-surface-0-post-api-v1-orders">POST \/api\/v1\/orders<\/a>/);
    assert.doesNotMatch(html, /<a class="nav-surface"[^>]*>Postgres persistence<\/a>/);
    assert.doesNotMatch(html, /<a class="nav-surface"[^>]*>Event publisher<\/a>/);
    assert.match(html, /HTTP contract surface for POST \/api\/v1\/orders\./);
    assert.match(html, /POST \/api\/v1\/orders -&gt; object/);
    assert.match(html, /Original request/);
    assert.doesNotMatch(html, /<h1>Build REST endpoint/);
    assert.doesNotMatch(html, /HTTP contract surface for Build REST endpoint/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview Mermaid diagrams show software contracts, not harness traceability", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-preview-"));
  try {
    const plan = await importBlueprint({
      projectRoot: root,
      proposal: {
        title: "Match Route",
        summary: "Implement a pure JavaScript HTTP route matcher responsibility unit. Create src/route-match.mjs exporting matchRoute(request).",
        goals: ["Deliver matchRoute(request) inside src/route-match.mjs."],
        nonGoals: ["No middleware integration."],
        acceptanceCriteria: [
          "matchRoute is the only public surface.",
          "Inputs are validated: request must have method and path strings."
        ],
        assumptions: [],
        modules: [{
          name: "Match Route",
          purpose: "HTTP route matching with parameterized paths.",
          ownedPaths: ["src/route-match.mjs", "test/route-match.test.mjs"],
          dependsOn: [],
          contracts: [{
            name: "matchRoute",
            type: "function",
            inputs: [{ name: "request", type: "object { method: string, path: string }", required: true }],
            outputs: [{ name: "matchResult", type: "object | null" }],
            errors: [{ code: "ROUTE_REQUEST_INVALID", when: "Malformed request object." }]
          }]
        }],
        workItems: [{
          module: "Match Route",
          title: "Match Route",
          dependsOn: [],
          verifyCommand: "npm test",
          complexity: "small"
        }],
        scenarios: [{
          title: "matchRoute contract call",
          steps: [
            { from: "Caller", to: "Match Route", action: "matchRoute(request)" },
            { from: "Match Route", to: "Caller", action: "returns matchResult or null" }
          ]
        }]
      },
      runId: "route-matcher-docs",
      now: new Date("2026-05-12T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);

    const previewModel = await readJsonFile(path.join(plan.runDir, "preview", "preview-model.json"));
    assert.deepEqual(previewModel.blueprint.systemDossier.dependencyEdges, []);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /Architecture Topology/);
    assert.match(html, /Match Route: matchRoute/);
    assert.match(html, /request: object \{ method: string, path: string \}/);
    assert.match(html, /matchResult:/);
    assert.match(html, /ROUTE_REQUEST_INVALID/);
    assert.match(html, /Caller/);
    assert.doesNotMatch(html, /PRD Source/);
    assert.doesNotMatch(html, /Implementation Responsibility Unit/);
    assert.doesNotMatch(html, /request planned work/);
    assert.doesNotMatch(html, /assign work/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview renders request-specific SDK examples and function signatures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-preview-"));
  try {
    const plan = await importBlueprint({
      projectRoot: root,
      proposal: {
        title: "Parse Bounded Int",
        summary: "Implement a pure JavaScript bounded integer parser responsibility unit. Create src/parse-bounded-int.mjs exporting parseBoundedInt(input, min, max).",
        goals: ["Deliver parseBoundedInt(input, min, max) inside src/parse-bounded-int.mjs."],
        nonGoals: ["No floating-point support."],
        acceptanceCriteria: [
          "parseBoundedInt is the only public surface.",
          "Inputs are validated: input must be integer-representable, min <= max."
        ],
        assumptions: [],
        modules: [{
          name: "Parse Bounded Int",
          purpose: "Bounded integer parsing with range validation.",
          ownedPaths: ["src/parse-bounded-int.mjs", "test/parse-bounded-int.test.mjs"],
          dependsOn: [],
          contracts: [{
            name: "parseBoundedInt",
            type: "function",
            inputs: [
              { name: "input", type: "string | number", required: true },
              { name: "min", type: "integer", required: true },
              { name: "max", type: "integer", required: true }
            ],
            outputs: [{ name: "parsedResult", type: "integer" }],
            errors: [
              { code: "INTEGER_OUT_OF_RANGE", when: "Parsed integer is outside [min, max]." },
              { code: "INTEGER_INVALID", when: "Input is not integer-representable or bounds are invalid." }
            ]
          }]
        }],
        workItems: [{
          module: "Parse Bounded Int",
          title: "Parse Bounded Int",
          dependsOn: [],
          verifyCommand: "npm test",
          complexity: "small"
        }],
        scenarios: [{
          title: "parseBoundedInt contract call",
          steps: [
            { from: "Caller", to: "Parse Bounded Int", action: "parseBoundedInt(\"42\", 1, 100)" },
            { from: "Parse Bounded Int", to: "Caller", action: "returns 42" }
          ]
        }]
      },
      runId: "bounded-int-parser",
      now: new Date("2026-05-11T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /<h1>Parse Bounded Int<\/h1>/);
    assert.match(html, /parseBoundedInt\(input, min, max\): integer/);
    assert.match(html, /const parsedResult = parseBoundedInt\(&quot;42&quot;, 1, 100\);/);
    assert.match(html, /INTEGER_OUT_OF_RANGE/);
    assert.match(html, /INTEGER_INVALID/);
    assert.doesNotMatch(html, /Ada\s+Lovelace/);
    assert.doesNotMatch(html, /parseBoundedInt\(input, min, max\): string/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview keeps multi-unit Blueprints centered on the architecture packet instead of the first surface", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-preview-"));
  try {
    const plan = await importBlueprint({
      projectRoot: root,
      proposal: {
        title: "Three Independent Responsibility Units",
        summary: "Implement three independent pure JavaScript responsibility units: safeAdd, slugifyTitle, formatIsoDate.",
        goals: [
          "Deliver safeAdd(a, b) inside src/math/safe-add.mjs.",
          "Deliver slugifyTitle(input) inside src/text/slugify-title.mjs.",
          "Deliver formatIsoDate(input) inside src/date/format-iso-date.mjs."
        ],
        nonGoals: ["Units must not import one another."],
        acceptanceCriteria: [
          "safeAdd is the public surface for safe-add.",
          "slugifyTitle is the public surface for slugify-title.",
          "formatIsoDate is the public surface for format-iso-date."
        ],
        assumptions: [],
        modules: [
          {
            name: "Safe Add",
            purpose: "Safe finite-number addition.",
            ownedPaths: ["src/math/safe-add.mjs", "test/math/safe-add.test.mjs"],
            dependsOn: [],
            contracts: [{
              name: "safeAdd",
              type: "function",
              inputs: [{ name: "a", type: "number", required: true }, { name: "b", type: "number", required: true }],
              outputs: [{ name: "sum", type: "number" }],
              errors: [{ code: "SAFE_ADD_INVALID", when: "Input is not a finite number." }]
            }]
          },
          {
            name: "Slugify Title",
            purpose: "Title slugification with whitespace handling.",
            ownedPaths: ["src/text/slugify-title.mjs", "test/text/slugify-title.test.mjs"],
            dependsOn: [],
            contracts: [{
              name: "slugifyTitle",
              type: "function",
              inputs: [{ name: "input", type: "string", required: true }],
              outputs: [{ name: "slug", type: "string" }],
              errors: [{ code: "SLUGIFY_TITLE_INVALID", when: "Input is not a non-empty string." }]
            }]
          },
          {
            name: "Format ISO Date",
            purpose: "UTC ISO date formatting.",
            ownedPaths: ["src/date/format-iso-date.mjs", "test/date/format-iso-date.test.mjs"],
            dependsOn: [],
            contracts: [{
              name: "formatIsoDate",
              type: "function",
              inputs: [{ name: "input", type: "Date", required: true }],
              outputs: [{ name: "isoDate", type: "string" }],
              errors: [{ code: "FORMAT_ISO_DATE_INVALID", when: "Input is not a valid Date." }]
            }]
          }
        ],
        workItems: [
          { module: "Safe Add", title: "Safe Add", dependsOn: [], verifyCommand: "npm test", complexity: "small" },
          { module: "Slugify Title", title: "Slugify Title", dependsOn: [], verifyCommand: "npm test", complexity: "small" },
          { module: "Format ISO Date", title: "Format ISO Date", dependsOn: [], verifyCommand: "npm test", complexity: "small" }
        ],
        scenarios: [
          {
            title: "safeAdd contract call",
            steps: [
              { from: "Caller", to: "Safe Add", action: "safeAdd(a, b)" },
              { from: "Safe Add", to: "Caller", action: "returns sum" }
            ]
          },
          {
            title: "slugifyTitle contract call",
            steps: [
              { from: "Caller", to: "Slugify Title", action: "slugifyTitle(input)" },
              { from: "Slugify Title", to: "Caller", action: "returns slug" }
            ]
          },
          {
            title: "formatIsoDate contract call",
            steps: [
              { from: "Caller", to: "Format ISO Date", action: "formatIsoDate(input)" },
              { from: "Format ISO Date", to: "Caller", action: "returns isoDate" }
            ]
          }
        ]
      },
      runId: "three-independent-units",
      now: new Date("2026-05-18T00:00:00.000Z")
    });
    assert.equal(plan.ok, true, JSON.stringify(plan.errors));

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);

    const previewModel = await readJsonFile(path.join(plan.runDir, "preview", "preview-model.json"));
    const dossier = previewModel.blueprint.systemDossier;
    assert.deepEqual(dossier.modules.map((module) => module.moduleName), ["Safe Add", "Slugify Title", "Format ISO Date"]);
    assert.equal(dossier.systemPlacement.summary, "3 responsibility units (Safe Add, Slugify Title, Format ISO Date) are declared as separate modules with no cross-module imports.");
    assert.deepEqual(dossier.scenarioIndex.map((scenario) => scenario.title), [
      "safeAdd contract call",
      "slugifyTitle contract call",
      "formatIsoDate contract call"
    ]);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /<h1>Three Independent/);
    assert.match(html, /3 responsibility units: Safe Add, Slugify Title, Format ISO Date/);
    assert.match(html, /safeAdd State Flow/);
    assert.match(html, /slugifyTitle State Flow/);
    assert.match(html, /formatIsoDate State Flow/);
    assert.doesNotMatch(html, /<h1>Safe Add<\/h1>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
