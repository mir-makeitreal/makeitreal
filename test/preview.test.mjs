import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decideBlueprintReview } from "../src/blueprint/review.mjs";
import { generatePlanRun } from "../src/plan/plan-generator.mjs";
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
      mayUseContracts: ["contract.auth.login", "contract.auth.session"]
    },
    {
      id: "ru.backend",
      owner: "team.backend",
      owns: ["api/src/auth/**"],
      publicSurfaces: ["POST /auth/login"],
      mayUseContracts: ["contract.auth.login", "contract.auth.session"]
    }
  ];

  await writeJsonFile(designPackPath, designPack);
  await writeJsonFile(responsibilityUnitsPath, responsibilityUnits);
}

test("operator cockpit maps phases to a read-only first-run guide", () => {
  const cockpit = buildOperatorCockpitModel({
    status: {
      phase: "approval-required",
      blueprintStatus: "pending",
      headline: "Blueprint review is pending.",
      nextAction: "Answer the Blueprint review question, or reply in chat with approval, requested changes, or rejection.",
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
    assert.equal(previewModel.blueprint.acceptanceCriteria[0].id, "AC-001");
    const importEdge = previewModel.blueprint.systemDossier.dependencyEdges.find((edge) => edge.from === "ru.frontend");
    assert.equal(importEdge.toLabel, "Auth Service");
    assert.equal(importEdge.surface, "POST /auth/login");

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    for (const label of [
      "System Blueprint",
      "Mermaid Blueprint",
      "System Map",
      "Dependency Graph",
      "Contract Matrix",
      "Module Reference",
      "Parameters",
      "Returns",
      "Errors",
      "Signal Flow",
      "Call Stack",
      "Verification & Evidence",
      "Developer Diagnostics",
      "Current Run"
    ]) {
      assert.match(html, new RegExp(label));
    }
    assert.doesNotMatch(html, /<a href="#artifacts">Raw Artifacts<\/a>/);
    assert.doesNotMatch(html, /<a href="#runtime">Runtime Snapshot<\/a>/);
    assert.doesNotMatch(html, /<h2>Kanban Board<\/h2>/);
    assert.match(html, /Read-only dashboard/);
    assert.match(html, /email: &quot;user@example\.com&quot;/);
    assert.match(html, /password: &quot;correct horse battery staple&quot;/);
    assert.match(html, /body: JSON\.stringify\(requestBody\)/);
    assert.match(html, /const session = await httpResponse\.json\(\);/);
    assert.doesNotMatch(html, /const 200\.session/);
    assert.doesNotMatch(html, /body: JSON\.stringify\(\{\}\)/);
    assert.doesNotMatch(html, /POST \/auth\/login\(&quot;user@example\.com&quot;/);
    assert.doesNotMatch(html, /Surface the declared auth error state; do not infer fallback session behavior\.<\/span><p>Surface the declared auth error state/);
    assert.match(html, /data-read-only-cockpit="true"/);
    assert.match(html, /data-live-status-rail/);
    assert.match(html, /data-live-kanban/);
    assert.match(html, /data-operator-kanban="true"/);
    assert.match(html, /\/makeitreal:status/);
    assert.match(html, /copy-command/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /sequenceDiagram/);
    assert.match(html, /stateDiagram-v2/);
    assert.match(html, /flowchart LR/);
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/mermaid/);
    assert.doesNotMatch(html, /data-harness-action=/);
    assert.doesNotMatch(html, /makeitreal-engine blueprint approve/);
    assert.doesNotMatch(html, /makeitreal-engine orchestrator tick/);

    const js = await readFile(path.join(previewDir, "preview.js"), "utf8");
    assert.match(js, /makeitreal:auto-reload/);
    assert.match(js, /preview-model\.json/);
    assert.match(js, /updateRuntime/);
    assert.match(js, /data-live-kanban/);
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
    assert.match(css, /\.dossier-shell/);
    assert.match(css, /\.dossier-nav/);
    assert.match(css, /\.runtime-rail/);
    assert.match(css, /\.status-rail/);
    assert.match(css, /\.module-reference/);
    assert.match(css, /\.signature-table/);
    assert.match(css, /\.diagram-card/);
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
      "contract.auth.session",
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
    assert.equal(dossier.deliveryScope.ownedPaths.includes("web/src/auth/**"), true);
    assert.equal(dossier.deliveryScope.ownedPaths.includes("api/src/auth/**"), true);

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    for (const label of [
      "System Blueprint",
      "Mermaid Blueprint",
      "System Map",
      "Dependency Graph",
      "Contract Matrix",
      "Module Reference",
      "Signal Flow",
      "Call Stack",
      "Runtime Snapshot"
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
    assert.match(html, /class="mermaid"/);
    assert.match(html, /Auth UI/);
    assert.match(html, /Auth Service/);
    assert.doesNotMatch(html, /const 200 response/);
    assert.doesNotMatch(html, /body: JSON\.stringify\(\{\}\)/);
    assert.doesNotMatch(html, /POST \/auth\/login\(\{\}\)/);
    assert.match(html, /data-read-only-cockpit="true"/);
    assert.match(html, /copy-command/);
    assert.doesNotMatch(html, /data-harness-action=/);
    assert.doesNotMatch(html, /makeitreal-engine blueprint approve/);
    assert.doesNotMatch(html, /makeitreal-engine orchestrator tick/);

    const css = await readFile(path.join(previewDir, "preview.css"), "utf8");
    for (const selector of [
      ".dossier-shell",
      ".dossier-nav",
      ".dossier-main",
      ".runtime-rail",
      ".diagram-card",
      ".mermaid",
      ".nav-group",
      ".nav-module",
      ".nav-surface",
      ".system-map",
      ".dependency-matrix",
      ".module-reference",
      ".flow-timeline"
    ]) {
      assert.match(css, new RegExp(selector.replace(".", "\\.")));
    }
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /grid-template-columns:\s*minmax\(180px,\s*220px\)\s+minmax\(0,\s*1fr\)\s+minmax\(260px,\s*320px\)/);
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
    assert.equal(model.status.nextAction, "/makeitreal:plan <request>");
    assert.equal(model.status.nextCommand, "/makeitreal:plan <request>");
    assert.equal(model.operatorCockpit.nextCommand, "/makeitreal:plan <request>");

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    assert.match(html, /data-copy="\/makeitreal:plan &lt;request&gt;"/);
    assert.doesNotMatch(html, /data-copy="\/makeitreal:plan approve"/);
  });
});

test("preview projects approved launch board state without mutating control-plane artifacts", async () => {
  await withFixture(async ({ root }) => {
    const plan = await generatePlanRun({
      projectRoot: root,
      request: "Build a previewed report module",
      runId: "previewed-report",
      allowedPaths: ["modules/previewed-report/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('previewed report ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);
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
    assert.match(html, /Board has work ready for launch/);
    assert.match(html, /class="kanban-lane"/);
    assert.match(html, /data-lane="Planned"/);
    assert.doesNotMatch(html, /data-lane="Contract Frozen"/);
    assert.match(html, /class="work-card"/);
    assert.match(html, /\/makeitreal:launch/);
    assert.doesNotMatch(html, /board claim/);
    assert.doesNotMatch(html, /orchestrator tick/);
    assert.doesNotMatch(html, />gate</);

    const model = await readJsonFile(path.join(plan.runDir, "preview", "preview-model.json"));
    assert.equal(model.board.lanes.find((lane) => lane.name === "Contract Frozen").workItems[0].id, plan.workItemId);
  });
});

test("preview renders long implementation requests as compact reference docs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-preview-"));
  try {
    const request = "Implement a pure JavaScript display-name normalization responsibility unit. Create src/normalize-name.mjs exporting normalizeDisplayName(input) and test/normalize-name.test.mjs. Contract: input must be a string, trim leading/trailing whitespace, collapse internal whitespace to one space, throw TypeError with code DISPLAY_NAME_INVALID for non-string or empty normalized value. Verification command is npm test.";
    const plan = await generatePlanRun({
      projectRoot: root,
      request,
      runId: "display-name-normalizer",
      allowedPaths: ["src/normalize-name.mjs", "test/normalize-name.test.mjs"],
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-11T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /<h1>Normalize Display Name<\/h1>/);
    assert.match(html, /normalizeDisplayName\(input\)/);
    assert.match(html, /Original request/);
    assert.match(html, /display-name normalization responsibility unit/);
    assert.match(html, /Public surfaces/);
    assert.match(html, /Run Status & Kanban/);
    assert.match(html, /<article class="work-card"[^>]*>\s*<strong>Normalize Display Name<\/strong>/);
    assert.doesNotMatch(html, /<h1>Implement a pure JavaScript display-name/);
    assert.doesNotMatch(html, /<strong>Implement a pure JavaScript display-name/);
    assert.doesNotMatch(html, /<a href="#artifacts">Raw Artifacts<\/a>/);
    assert.doesNotMatch(html, /<a href="#runtime">Runtime Snapshot<\/a>/);

    const css = await readFile(path.join(plan.runDir, "preview", "preview.css"), "utf8");
    assert.match(css, /grid-template-columns: minmax\(180px, 220px\) minmax\(0, 1fr\) minmax\(260px, 320px\)/);
    assert.match(css, /\.reference-grid/);
    assert.doesNotMatch(css, /grid-template-columns: 220px minmax\(0, 1fr\) 300px/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preview Mermaid diagrams show software contracts, not harness traceability", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-preview-"));
  try {
    const plan = await generatePlanRun({
      projectRoot: root,
      request: "Implement a pure JavaScript HTTP route matcher responsibility unit. Create src/route-match.mjs exporting matchRoute(request). Contract: request must be an object with method string and path string. Support GET /health -> { handler: \"health\", params: {} } and GET /users/:id where id is one non-empty path segment -> { handler: \"user.show\", params: { id } }. Return null for unmatched routes. Throw TypeError with code ROUTE_REQUEST_INVALID for malformed request. Create test/route-match.test.mjs. Verification command is npm test.",
      runId: "route-matcher-docs",
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-12T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);

    const previewModel = await readJsonFile(path.join(plan.runDir, "preview", "preview-model.json"));
    assert.deepEqual(previewModel.blueprint.systemDossier.dependencyEdges, []);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /Software Contract Topology/);
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
    const plan = await generatePlanRun({
      projectRoot: root,
      request: "Implement a pure JavaScript bounded integer parser responsibility unit. Create src/parse-bounded-int.mjs exporting parseBoundedInt(input, min, max) and test/parse-bounded-int.test.mjs. Contract: input may be a string or number representing an integer, min and max must be finite integers with min <= max, return the integer when it is inside the inclusive range, throw RangeError with code INTEGER_OUT_OF_RANGE when outside the range, throw TypeError with code INTEGER_INVALID for non-integer input or invalid bounds. Verification command is npm test.",
      runId: "bounded-int-parser",
      verificationCommands: [{ file: "npm", args: ["test"] }],
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
