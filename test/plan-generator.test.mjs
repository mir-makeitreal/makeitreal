import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generatePlanRun } from "../src/plan/plan-generator.mjs";
import { readCurrentRunState, writeCurrentRunState } from "../src/project/run-state.mjs";
import { readJsonFile } from "../src/io/json.mjs";

test("plan generator creates a reviewable run packet with pending Blueprint approval", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dashboard widget with summary metrics",
      runId: "summary-widget",
      allowedPaths: ["modules/summary-widget/**"],
      owner: "team.frontend",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('summary widget ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.planOk, true);
    assert.equal(result.implementationReady, false);
    assert.equal(result.currentRunUpdated, true);
    assert.equal(result.readyGate.ok, false);
    assert.equal(result.readyGate.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_PENDING"), true);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.equal(prd.goals.length > 0, true);
    assert.doesNotMatch(prd.goals.join("\n"), /Deliver the requested capability/);
    assert.equal(prd.userVisibleBehavior.length > 0, true);
    assert.equal(prd.acceptanceCriteria.every((criterion) => criterion.id && criterion.statement), true);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.apiSpecs[0].kind, "none");
    assert.equal(designPack.apiSpecs[0].contractId, result.contractId);
    assert.equal(designPack.architecture.edges[0].contractId, result.contractId);
    assert.equal(designPack.moduleInterfaces[0].responsibilityUnitId, "ru.summary-widget");
    assert.equal(designPack.moduleInterfaces[0].moduleName, "Summary Widget");
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].name, "summary-widget.execute");
    assert.deepEqual(designPack.moduleInterfaces[0].publicSurfaces[0].contractIds, [result.contractId]);
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].signature.inputs[0].name, "request");
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].signature.outputs[0].name, "result");
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].signature.errors[0].code, "BOUNDARY_CONTRACT_VIOLATION");

    const responsibilityUnits = await readJsonFile(path.join(result.runDir, "responsibility-units.json"));
    assert.equal(responsibilityUnits.units.length, 1);
    assert.equal(responsibilityUnits.units[0].owner, "team.frontend");
    assert.deepEqual(responsibilityUnits.units[0].publicSurfaces, ["summary-widget.execute"]);

    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.summary-widget.json"));
    assert.equal(workItem.title, "Build a dashboard widget with summary metrics");
    assert.deepEqual(workItem.dependsOn, []);
    assert.deepEqual(workItem.prdTrace.acceptanceCriteriaIds, ["AC-001", "AC-002", "AC-003", "AC-004", "AC-005"]);
    assert.deepEqual(workItem.doneEvidence, [
      { kind: "verification", path: "evidence/work.summary-widget.verification.json" },
      { kind: "wiki-sync", path: "evidence/work.summary-widget.wiki-sync.json" }
    ]);

    const board = await readJsonFile(path.join(result.runDir, "board.json"));
    assert.equal(board.boardId, "board.summary-widget");
    assert.equal(board.blueprintRunDir, ".");
    assert.equal(board.workItems.length, 1);
    assert.equal(board.workItems[0].id, "work.summary-widget");
    assert.equal(board.workItems[0].lane, "Contract Frozen");
    assert.deepEqual(board.workItemDAG, {
      schemaVersion: "1.0",
      nodes: [{
        workItemId: "work.summary-widget",
        kind: "implementation",
        requiredForDone: true
      }],
      edges: []
    });
    const dag = await readJsonFile(path.join(result.runDir, "work-item-dag.json"));
    assert.equal(dag.nodes[0].id, "work.summary-widget");
    assert.equal(dag.nodes[0].kind, "implementation");
    assert.deepEqual(dag.edges, []);

    const trustPolicy = await readJsonFile(path.join(result.runDir, "trust-policy.json"));
    assert.equal(trustPolicy.runnerMode, "scripted-simulator");
    assert.equal(trustPolicy.realAgentLaunch, "disabled");

    const runtimeState = await readJsonFile(path.join(result.runDir, "runtime-state.json"));
    assert.equal(runtimeState.boardId, "board.summary-widget");
    assert.deepEqual(runtimeState.running, {});

    const review = await readJsonFile(path.join(result.runDir, "blueprint-review.json"));
    assert.equal(review.status, "pending");
    assert.equal(review.reviewSource, "makeitreal:plan");

    const current = await readCurrentRunState(projectRoot);
    assert.equal(current.ok, true);
    assert.equal(current.runDir, result.runDir);

    const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /^\/\.makeitreal\/$/m);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator writes a canonical one-node work item DAG", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-dag-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Create src/math.mjs exporting add(a, b) and test/math.test.mjs.",
      verificationCommands: [{ file: "node", args: ["--test", "test/math.test.mjs"] }]
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const dag = await readJsonFile(path.join(result.runDir, "work-item-dag.json"));
    assert.equal(dag.nodes.length, 1);
    assert.equal(dag.nodes[0].id, result.workItemId);
    assert.equal(dag.nodes[0].kind, "implementation");
    assert.deepEqual(dag.edges, []);
    const board = await readJsonFile(path.join(result.runDir, "board.json"));
    assert.deepEqual(board.workItemDAG.nodes[0], {
      workItemId: result.workItemId,
      kind: "implementation",
      requiredForDone: true
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator creates API plus persistence responsibility DAG from explicit boundaries", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-api-data-dag-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: [
        "Implement POST /orders in src/api/orders/**.",
        "Persist orders through repository contract in src/data/orders/**.",
        "Use tests in test/api/orders/** and test/data/orders/**."
      ].join(" "),
      allowedPaths: [
        "src/api/orders/**",
        "test/api/orders/**",
        "src/data/orders/**",
        "test/data/orders/**"
      ],
      apiKind: "openapi",
      verificationCommands: [{ file: "node", args: ["--test"] }]
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const dag = await readJsonFile(path.join(result.runDir, "work-item-dag.json"));
    assert.equal(dag.nodes.some((node) => node.id === "work.orders-api"), true);
    assert.equal(dag.nodes.some((node) => node.id === "work.orders-repository"), true);
    assert.equal(dag.edges.some((edge) =>
      edge.from === "work.orders-repository"
      && edge.to === "work.orders-api"
      && edge.contractId === "contract.orders.persistence"
    ), true);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.moduleInterfaces.some((item) => item.responsibilityUnitId === "ru.orders-api"), true);
    assert.equal(designPack.moduleInterfaces.some((item) => item.responsibilityUnitId === "ru.orders-repository"), true);
    assert.equal(designPack.apiSpecs.some((spec) => spec.contractId === "contract.orders.persistence"), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator preserves explicit API handler surface when splitting API and repository units", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-api-handler-dag-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: [
        "Implement POST /orders as two explicit responsibility units.",
        "Repository: src/data/orders/repository.mjs owns persistence, exports createOrderRepository(), createOrder({ sku, quantity }), listOrders().",
        "API: src/api/orders/handler.mjs owns request handling, exports handlePostOrders(request, repository), depends only on repository contract.",
        "Tests live in test/data/orders/repository.test.mjs and test/api/orders/handler.test.mjs.",
        "Verification command is npm test."
      ].join(" "),
      allowedPaths: [
        "src/data/orders/repository.mjs",
        "test/data/orders/repository.test.mjs",
        "src/api/orders/handler.mjs",
        "test/api/orders/handler.test.mjs"
      ],
      verificationCommands: [{ file: "npm", args: ["test"] }]
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    const apiModule = designPack.moduleInterfaces.find((item) => item.responsibilityUnitId === "ru.orders-api");
    const repositoryModule = designPack.moduleInterfaces.find((item) => item.responsibilityUnitId === "ru.orders-repository");
    assert.equal(apiModule.publicSurfaces[0].name, "handlePostOrders");
    assert.deepEqual(apiModule.publicSurfaces[0].signature.inputs.map((input) => input.name), ["request", "repository"]);
    assert.deepEqual(repositoryModule.publicSurfaces.map((surface) => surface.name), [
      "createOrderRepository",
      "createOrder",
      "listOrders"
    ]);

    const responsibilityUnits = await readJsonFile(path.join(result.runDir, "responsibility-units.json"));
    const apiUnit = responsibilityUnits.units.find((unit) => unit.id === "ru.orders-api");
    const repositoryUnit = responsibilityUnits.units.find((unit) => unit.id === "ru.orders-repository");
    assert.deepEqual(apiUnit.publicSurfaces, ["handlePostOrders"]);
    assert.deepEqual(repositoryUnit.publicSurfaces, ["createOrderRepository", "createOrder", "listOrders"]);

    const validUnitIds = new Set(responsibilityUnits.units.map((unit) => unit.id));
    assert.equal(designPack.architecture.nodes.every((node) =>
      !node.responsibilityUnitId || validUnitIds.has(node.responsibilityUnitId)
    ), true);
    assert.equal(designPack.architecture.nodes.some((node) => node.responsibilityUnitId === "ru.implement-post-orders-as-two-explicit"), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator blocks plan and current-run updates without a real verification plan", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dashboard widget with summary metrics",
      runId: "summary-widget",
      allowedPaths: ["modules/summary-widget/**"],
      owner: "team.frontend",
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    await writeCurrentRunState({
      projectRoot,
      runDir: "/previous/run",
      source: "test",
      now: new Date("2026-05-05T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.currentRunUpdated, false);
    assert.equal(result.currentRun, null);
    assert.equal(result.readyGate.ok, false);
    assert.equal(result.readyGate.errors.some((error) => error.code === "HARNESS_VERIFICATION_PLAN_MISSING"), true);
    const current = await readCurrentRunState(projectRoot);
    assert.equal(current.runDir, "/previous/run");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator writes OpenAPI contract for API-shaped requests", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a REST API endpoint for invoice search",
      runId: "invoice-search-api",
      apiKind: "openapi",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('invoice api ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.planOk, true);
    assert.equal(result.implementationReady, false);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.apiSpecs[0].kind, "openapi");
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].name, "POST /invoices/search");
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].kind, "http");
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].signature.inputs[0].name, "requestBody");
    assert.deepEqual(designPack.moduleInterfaces[0].publicSurfaces[0].signature.inputs[0].fields, ["query"]);
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].signature.outputs[0].name, "200 response");

    const openapi = await readJsonFile(path.join(result.runDir, "contracts", "invoice-search-api.openapi.json"));
    assert.equal(openapi.openapi, "3.1.0");
    const operation = openapi.paths["/invoices/search"].post;
    assert.equal(operation.requestBody.required, true);
    assert.equal(operation.requestBody.content["application/json"].schema.$ref, "#/components/schemas/InvoicesSearchRequest");
    assert.equal(operation.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/InvoicesSearchResponse");
    assert.equal(operation.responses["400"].content["application/json"].schema.$ref, "#/components/schemas/InvoicesSearchError");
    assert.equal(openapi.components.schemas.InvoicesSearchRequest.required.includes("query"), true);

    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.invoice-search-api.json"));
    assert.deepEqual(workItem.doneEvidence.map((evidence) => evidence.kind), [
      "verification",
      "openapi-conformance",
      "wiki-sync"
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator keeps pure JavaScript route matcher work on module IO contracts", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Implement a pure JavaScript HTTP route matcher responsibility unit. Create src/route-match.mjs exporting matchRoute(request). Contract: request must be an object with method string and path string. Support GET /health -> { handler: \"health\", params: {} } and GET /users/:id where id is one non-empty path segment -> { handler: \"user.show\", params: { id } }. Return null for unmatched routes. Throw TypeError with code ROUTE_REQUEST_INVALID for malformed request. Create test/route-match.test.mjs. Verification command is npm test.",
      runId: "http-route-matcher-module",
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.apiSpecs[0].kind, "none");
    const surface = designPack.moduleInterfaces[0].publicSurfaces[0];
    assert.equal(surface.kind, "module");
    assert.equal(surface.name, "matchRoute");
    assert.equal(surface.signature.inputs[0].type, "object { method: string, path: string }");
    assert.equal(surface.signature.outputs[0].name, "matchResult");
    assert.equal(surface.signature.outputs[0].type, "{ handler: \"health\" | \"user.show\", params: object } | null");
    assert.deepEqual(surface.signature.outputs[0].cases, [
      {
        name: "GET /health",
        input: "GET /health",
        output: "{ handler: \"health\", params: {} }"
      },
      {
        name: "GET /users/:id",
        input: "GET /users/:id",
        output: "{ handler: \"user.show\", params: { id } }"
      },
      {
        name: "unmatched route",
        input: "request outside declared route cases",
        output: "null"
      }
    ]);
    assert.match(surface.signature.errors[0].when, /Input object/);
    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.match(JSON.stringify(prd.acceptanceCriteria), /GET \/users\/:id/);
    assert.match(JSON.stringify(prd.acceptanceCriteria), /user\.show/);
    const previewModel = await readJsonFile(path.join(result.runDir, "preview", "preview-model.json"));
    assert.equal(previewModel.generatedAt, "2026-05-06T00:00:00.000Z");

    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.http-route-matcher-module.json"));
    assert.deepEqual(workItem.doneEvidence.map((evidence) => evidence.kind), [
      "verification",
      "wiki-sync"
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator treats local HTTP matcher module phrasing as module IO", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Implement matchRoute(request), a local HTTP route matcher module. Contract: request must be an object with method string and path string. Support GET /health -> { handler: \"health\", params: {} }. Return null for unmatched routes. Create src/route-match.mjs and test/route-match.test.mjs. Verification command is npm test.",
      runId: "local-http-route-matcher",
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.apiSpecs[0].kind, "none");
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].kind, "module");
    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.local-http-route-matcher.json"));
    assert.deepEqual(workItem.doneEvidence.map((evidence) => evidence.kind), [
      "verification",
      "wiki-sync"
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator derives API route, statuses, headers, and dependency imports from the request", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build REST endpoint POST /api/v1/orders with customerId, items, shippingAddress, Idempotency-Key header, Postgres idempotency, Kafka OrderCreated, 201, 400, 409, 422",
      runId: "orders-api",
      apiKind: "openapi",
      allowedPaths: ["src/api/orders/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('orders api ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const openapi = await readJsonFile(path.join(result.runDir, "contracts", "orders-api.openapi.json"));
    const operation = openapi.paths["/api/v1/orders"].post;
    assert.deepEqual(Object.keys(operation.responses), ["201", "400", "409", "422"]);
    assert.deepEqual(operation.parameters.map((parameter) => parameter.name), ["Idempotency-Key"]);
    assert.deepEqual(Object.keys(openapi.components.schemas.ApiV1OrdersRequest.properties), ["customerId", "items", "shippingAddress"]);
    assert.deepEqual(operation.requestBody.content["application/json"].examples.sample.value.shippingAddress, {
      line1: "1 Example St",
      city: "Example City"
    });
    assert.equal(operation.responses["201"].content["application/json"].examples.success.value.data.shippingAddress.line1, "1 Example St");
    assert.equal(openapi.components.schemas.ApiV1OrdersResponse.required.includes("data"), true);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.match(prd.acceptanceCriteria[0].statement, /POST \/api\/v1\/orders/);
    assert.match(prd.acceptanceCriteria[2].statement, /201.*400.*409.*422/);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.moduleInterfaces[0].moduleName, "Orders API");
    assert.match(designPack.moduleInterfaces[0].purpose, /POST \/api\/v1\/orders/);
    assert.doesNotMatch(designPack.moduleInterfaces[0].moduleName, /customerId/);
    assert.deepEqual(designPack.moduleInterfaces[0].imports.map((dependency) => dependency.contractId), [
      "contract.data.persistence",
      "contract.events.publish"
    ]);
    assert.equal(designPack.apiSpecs.some((spec) => spec.contractId === "contract.data.persistence"), true);

    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.orders-api.json"));
    assert.deepEqual(workItem.contractIds, [
      result.contractId,
      "contract.data.persistence",
      "contract.events.publish"
    ]);
    assert.deepEqual(workItem.dependencyContracts.map((dependency) => dependency.contractId), [
      "contract.data.persistence",
      "contract.events.publish"
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator derives REST resource paths and fields without explicit path", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a REST catalog API for creating books with title, author, 201, 400, 409",
      runId: "be-catalog-api",
      apiKind: "rest",
      allowedPaths: ["src/catalog-api.cjs"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('catalog api ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const openapi = await readJsonFile(path.join(result.runDir, "contracts", "be-catalog-api.openapi.json"));
    const operation = openapi.paths["/catalog/books"].post;
    assert.deepEqual(Object.keys(operation.responses), ["201", "400", "409"]);
    assert.deepEqual(Object.keys(openapi.components.schemas.CatalogBooksRequest.properties), ["author", "title"]);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.moduleInterfaces[0].publicSurfaces[0].name, "POST /catalog/books");
    assert.match(designPack.moduleInterfaces[0].publicSurfaces[0].signature.inputs[0].description, /POST \/catalog\/books/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator derives frontend component contracts and evidence lanes", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a reusable React DataTable component with sorting, pagination, selection, sticky header, empty loading error states, ARIA grid keyboard navigation and Storybook stories",
      runId: null,
      owner: "team.frontend",
      allowedPaths: ["src/components/DataTable/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('datatable ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.runId.endsWith("-with"), false);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    const surface = designPack.moduleInterfaces[0].publicSurfaces[0];
    assert.equal(surface.name, "DataTable.props");
    assert.equal(surface.kind, "component");
    assert.match(surface.signature.outputs[0].description, /sorting, pagination, selection/);
    assert.equal(surface.signature.inputs.some((input) => input.name === "columns"), true);
    assert.equal(surface.signature.inputs.some((input) => input.name === "onSortChange"), true);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.equal(prd.acceptanceCriteria.some((criterion) => /ARIA semantics/.test(criterion.statement)), true);
    assert.equal(designPack.componentContracts[0].path.endsWith(".component-contract.json"), true);
    const componentContract = await readJsonFile(path.join(result.runDir, designPack.componentContracts[0].path));
    assert.equal(componentContract.storybookStories.includes("sticky-header"), true);
    assert.equal(componentContract.keyboardMap.some((binding) => /ArrowUp/.test(binding.key)), true);

    const workItem = await readJsonFile(path.join(result.runDir, "work-items", `${result.workItemId}.json`));
    assert.deepEqual(workItem.doneEvidence.map((evidence) => evidence.kind), [
      "verification",
      "wiki-sync"
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator preserves explicit slash-separated component props", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a React StatusPill component with label/status/tone props and tests",
      runId: "status-pill",
      owner: "team.frontend",
      allowedPaths: ["src/components/StatusPill.jsx"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('status pill ok')"] }],
      now: new Date("2026-05-11T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    const names = designPack.moduleInterfaces[0].publicSurfaces[0].signature.inputs.map((input) => input.name);
    assert.equal(names.includes("label"), true);
    assert.equal(names.includes("status"), true);
    assert.equal(names.includes("tone"), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator derives request-specific props for card components", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a React welcome card component with title, subtitle, ctaLabel, tone variants, loading state, error state, and retry button",
      runId: "fe-welcome-card",
      owner: "team.frontend",
      allowedPaths: ["src/welcome-card.cjs"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('welcome card ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    const surface = designPack.moduleInterfaces[0].publicSurfaces[0];
    assert.equal(surface.name, "WelcomeCard.props");
    assert.equal(surface.signature.inputs.some((input) => input.name === "title"), true);
    assert.equal(surface.signature.inputs.some((input) => input.name === "subtitle"), true);
    assert.equal(surface.signature.inputs.some((input) => input.name === "ctaLabel"), true);
    assert.equal(surface.signature.inputs.some((input) => input.name === "tone"), true);
    assert.equal(surface.signature.inputs.some((input) => input.name === "onRetry"), true);

    const componentContract = await readJsonFile(path.join(result.runDir, designPack.componentContracts[0].path));
    assert.equal(componentContract.componentName, "WelcomeCard");
    assert.equal(componentContract.storybookStories.includes("variants"), true);
    assert.equal(componentContract.storybookStories.includes("loading"), true);
    assert.equal(componentContract.storybookStories.includes("error"), true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator can prepare a Claude Code launch trust policy", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dependency-free slug stats module",
      runId: "slug-stats",
      allowedPaths: ["modules/slug-stats/**"],
      runnerMode: "claude-code",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('slug stats ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.planOk, true);
    assert.equal(result.implementationReady, false);
    const trustPolicy = await readJsonFile(path.join(result.runDir, "trust-policy.json"));
    assert.equal(trustPolicy.runnerMode, "claude-code");
    assert.equal(trustPolicy.realAgentLaunch, "enabled");
    assert.equal(trustPolicy.commandExecution, "structured-command-only");
    assert.equal(trustPolicy.userInputRequired, "fail-fast");
    assert.equal(trustPolicy.unsupportedToolCall, "fail-fast");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator honors explicit project paths in the request", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a math module exposing double(n) that returns n * 2. Use src/math.mjs and test/math.test.mjs with npm test.",
      runId: "math-module",
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-11T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.math-module.json"));
    assert.deepEqual(workItem.allowedPaths, ["src/math.mjs", "test/math.test.mjs"]);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.deepEqual(designPack.moduleInterfaces[0].owns, ["src/math.mjs", "test/math.test.mjs"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator prefers request paths over generated default ownership", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Implement a pure JavaScript slugify-title responsibility unit at src/slugify-title.mjs exporting slugifyTitle(input). Contract: input must be a string. Tests live at test/slugify-title.test.mjs. Verification: npm test.",
      runId: "implement-a-pure-javascript-slugify-title",
      allowedPaths: ["modules/implement-a-pure-javascript-slugify-title/**"],
      runnerMode: "claude-code",
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-11T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.implement-a-pure-javascript-slugify-title.json"));
    assert.deepEqual(workItem.allowedPaths, ["src/slugify-title.mjs", "test/slugify-title.test.mjs"]);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.deepEqual(designPack.responsibilityBoundaries[0].owns, ["src/slugify-title.mjs", "test/slugify-title.test.mjs"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator derives function-shaped module contracts without path false positives", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Implement a pure JavaScript display-name normalization responsibility unit. Create src/normalize-name.mjs exporting normalizeDisplayName(input) and test/normalize-name.test.mjs. Contract: input must be a string, trim leading/trailing whitespace, collapse internal whitespace to one space, throw TypeError with code DISPLAY_NAME_INVALID for non-string or empty normalized value. Verification command is npm test.",
      runId: "display-name-normalizer",
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-11T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.display-name-normalizer.json"));
    assert.deepEqual(workItem.allowedPaths, ["src/normalize-name.mjs", "test/normalize-name.test.mjs"]);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    const moduleInterface = designPack.moduleInterfaces[0];
    assert.equal(moduleInterface.moduleName, "Normalize Display Name");
    assert.equal(moduleInterface.publicSurfaces[0].name, "normalizeDisplayName");
    assert.equal(moduleInterface.publicSurfaces[0].signature.inputs[0].name, "input");
    assert.equal(moduleInterface.publicSurfaces[0].signature.inputs[0].type, "string");
    assert.equal(moduleInterface.publicSurfaces[0].signature.outputs[0].name, "normalizedValue");
    assert.equal(moduleInterface.publicSurfaces[0].signature.errors[0].code, "DISPLAY_NAME_INVALID");
    assert.equal(moduleInterface.publicSurfaces[0].signature.inputs.some((input) => input.name === "prdRequest"), false);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.deepEqual(prd.goals, [
      "Implement the Normalize Display Name responsibility unit inside src/normalize-name.mjs, test/normalize-name.test.mjs.",
      "Expose normalizeDisplayName with the declared input, output, and error contract.",
      "Verify the responsibility unit with npm test."
    ]);
    assert.deepEqual(prd.userVisibleBehavior, [
      "normalizeDisplayName accepts input, returns normalizedValue, and fails through DISPLAY_NAME_INVALID, BOUNDARY_CONTRACT_VIOLATION."
    ]);
    assert.equal(prd.goals.some((goal) => goal.includes("leading/trailing whitespace")), false);
    assert.match(prd.acceptanceCriteria[0].statement, /normalizeDisplayName is the only public surface/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator derives bounded integer parser signatures and declared errors", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Implement a pure JavaScript bounded integer parser responsibility unit. Create src/parse-bounded-int.mjs exporting parseBoundedInt(input, min, max) and test/parse-bounded-int.test.mjs. Contract: input may be a string or number representing an integer, min and max must be finite integers with min <= max, return the integer when it is inside the inclusive range, throw RangeError with code INTEGER_OUT_OF_RANGE when outside the range, throw TypeError with code INTEGER_INVALID for non-integer input or invalid bounds. Verification command is npm test.",
      runId: "bounded-int-parser",
      verificationCommands: [{ file: "npm", args: ["test"] }],
      now: new Date("2026-05-11T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    const surface = designPack.moduleInterfaces[0].publicSurfaces[0];
    assert.equal(surface.name, "parseBoundedInt");
    assert.deepEqual(
      surface.signature.inputs.map((input) => [input.name, input.type]),
      [
        ["input", "string | number"],
        ["min", "integer"],
        ["max", "integer"]
      ]
    );
    assert.equal(surface.signature.outputs[0].name, "parsedResult");
    assert.equal(surface.signature.outputs[0].type, "integer");
    assert.deepEqual(surface.signature.errors.map((error) => error.code), [
      "INTEGER_OUT_OF_RANGE",
      "INTEGER_INVALID",
      "BOUNDARY_CONTRACT_VIOLATION"
    ]);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.deepEqual(prd.userVisibleBehavior, [
      "parseBoundedInt accepts input, min, max, returns parsedResult, and fails through INTEGER_OUT_OF_RANGE, INTEGER_INVALID, BOUNDARY_CONTRACT_VIOLATION."
    ]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator rejects unsupported runner modes before writing a run", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dependency-free slug stats module",
      runId: "slug-stats",
      runnerMode: "browser-button",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('slug stats ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.errors[0].code, "HARNESS_RUNNER_MODE_UNSUPPORTED");
    assert.equal(result.runDir, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator fails fast on obvious multi-domain requests without explicit boundaries", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a frontend UI and backend API with a database migration",
      runId: "full-stack-work",
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.errors[0].code, "HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS");
    assert.equal(result.runDir, null);
    assert.equal(result.nextAction, "/makeitreal:plan <request> --owner <team> --allowed-path <path> --verify <json>");
    assert.deepEqual(result.suggestedBoundaries.map((boundary) => boundary.domain), ["frontend", "backend", "data"]);
    assert.equal(result.suggestedBoundaries.every((boundary) => boundary.owner && boundary.contractId), true);
    assert.equal(result.suggestedBoundaries.every((boundary) => boundary.allowedPaths.length > 0), true);
    assert.equal(result.suggestedBoundaries.every((boundary) => boundary.verificationCommand.file === "npm"), true);
    assert.match(result.guidance, /vertical slices/i);
    assert.deepEqual(result.errors[0].suggestedBoundaries, result.suggestedBoundaries);
    assert.equal(result.errors[0].nextAction, result.nextAction);
    assert.equal(result.errors[0].guidance, result.guidance);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator accepts multi-domain vertical slices with explicit ownership and paths", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a frontend UI and backend API with a database migration for signup",
      runId: "signup-vertical-slice",
      owner: "team.signup",
      allowedPaths: ["features/signup/**", "db/migrations/signup/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('signup slice ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.planOk, true);
    assert.equal(result.workItemId, "work.signup-vertical-slice");
    assert.equal(result.suggestedBoundaries, undefined);

    const responsibilityUnits = await readJsonFile(path.join(result.runDir, "responsibility-units.json"));
    assert.equal(responsibilityUnits.units[0].owner, "team.signup");
    assert.deepEqual(responsibilityUnits.units[0].owns, ["features/signup/**", "db/migrations/signup/**"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator rejects unsafe allowed path patterns", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dashboard widget with summary metrics",
      runId: "unsafe-path",
      allowedPaths: ["../outside/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.errors[0].code, "HARNESS_ALLOWED_PATH_INVALID");
    assert.equal(result.runDir, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan command creates artifacts through the internal CLI", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-cli-"));
  try {
    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "plan",
      projectRoot,
      "--request",
      "Build a billing export module",
      "--run",
      "billing-export",
      "--allowed-path",
      "modules/billing-export/**",
      "--runner",
      "claude-code",
      "--verify",
      JSON.stringify({ file: "node", args: ["-e", "console.log('billing export ok')"] })
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "plan");
    assert.equal(output.ok, true);
    assert.equal(output.planOk, true);
    assert.equal(output.implementationReady, false);
    assert.equal(output.readyGate.ok, false);
    assert.equal(output.readyGate.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_PENDING"), true);
    assert.equal(output.runId, "billing-export");
    const trustPolicy = await readJsonFile(path.join(output.runDir, "trust-policy.json"));
    assert.equal(trustPolicy.runnerMode, "claude-code");
    assert.equal(trustPolicy.realAgentLaunch, "enabled");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan command treats an empty slash-command project root as the current project", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-cli-empty-root-"));
  const harnessPath = path.join(fileURLToPath(new URL("../", import.meta.url)), "bin", "harness.mjs");
  try {
    const result = spawnSync(process.execPath, [
      harnessPath,
      "plan",
      "",
      "--request",
      "Build a success message contrast fix",
      "--run",
      "success-message-contrast",
      "--allowed-path",
      "web/src/components/common/auth/SuccessMessage.tsx",
      "--runner",
      "claude-code",
      "--verify",
      JSON.stringify({ file: "node", args: ["-e", "console.log('contrast ok')"] })
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: ""
      }
    });

    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(await realpath(output.projectRoot), await realpath(projectRoot));
    assert.equal((await realpath(output.runDir)).startsWith(path.join(await realpath(projectRoot), ".makeitreal", "runs")), true);
    const current = await readCurrentRunState(projectRoot);
    assert.equal(current.ok, true);
    assert.equal(await realpath(current.runDir), await realpath(output.runDir));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
