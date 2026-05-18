import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateModuleSurfaceConformance } from "../src/adapters/module-surface-conformance.mjs";
import { writeJsonFile } from "../src/io/json.mjs";

async function withRun(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-module-surface-"));
  const projectRoot = path.join(root, "project");
  const runDir = path.join(projectRoot, ".makeitreal", "runs", "feature-orders");
  await mkdir(path.join(projectRoot, "src", "data", "orders"), { recursive: true });
  await mkdir(path.join(projectRoot, "test", "data", "orders"), { recursive: true });
  await mkdir(path.join(runDir, "work-items"), { recursive: true });
  try {
    await callback({ root, projectRoot, runDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeMinimalArtifacts({ runDir, workItem }) {
  await writeJsonFile(path.join(runDir, "prd.json"), {
    schemaVersion: "1.0",
    id: "prd.orders",
    title: "Orders",
    goals: [],
    acceptanceCriteria: []
  });
  await writeJsonFile(path.join(runDir, "api-specs.json"), []);
  await writeJsonFile(path.join(runDir, "responsibility-units.json"), {
    schemaVersion: "1.0",
    units: [{
      id: "ru.orders-repository",
      owner: "team.data",
      owns: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"],
      publicSurfaces: ["createOrder", "getOrder", "listOrders"],
      mayUseContracts: ["contract.orders.persistence"]
    }]
  });
  await writeJsonFile(path.join(runDir, "design-pack.json"), {
    schemaVersion: "1.0",
    prdId: "prd.orders",
    apiSpecs: [{ kind: "none", contractId: "contract.orders.persistence", reason: "Module contract." }],
    architecture: { nodes: [], edges: [] },
    stateFlow: { states: [], transitions: [] },
    callStack: [],
    sequences: [],
    responsibilityBoundaries: [],
    moduleInterfaces: [{
      responsibilityUnitId: "ru.orders-repository",
      moduleName: "Orders Repository",
      owner: "team.data",
      owns: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"],
      publicSurfaces: [
        { name: "createOrder", inputs: [{ name: "input", type: "declared", required: false }] },
        { name: "getOrder", inputs: [{ name: "id", type: "declared", required: true }] },
        { name: "listOrders", inputs: [] }
      ].map(({ name, inputs }) => ({
        name,
        kind: "module",
        contractIds: ["contract.orders.persistence"],
        signature: {
          inputs,
          outputs: [{ name: "result", type: "declared" }],
          errors: [{ code: "BOUNDARY_CONTRACT_VIOLATION", when: "Invalid input.", handling: "Fail fast." }]
        }
      }))
    }]
  });
  await writeJsonFile(path.join(runDir, "work-item-dag.json"), {
    schemaVersion: "1.0",
    runId: "feature-orders",
    nodes: [{ id: workItem.id, kind: "implementation", responsibilityUnitId: workItem.responsibilityUnitId }],
    edges: []
  });
  await writeJsonFile(path.join(runDir, "board.json"), {
    schemaVersion: "1.0",
    boardId: "board.orders",
    workItems: [workItem],
    workItemDAG: { nodes: [{ workItemId: workItem.id, kind: "implementation" }], edges: [] }
  });
  await writeJsonFile(path.join(runDir, "work-items", `${workItem.id}.json`), {
    schemaVersion: "1.0",
    prdId: "prd.orders",
    ...workItem
  });
}

test("module surface conformance rejects undeclared public exports", async () => {
  await withRun(async ({ projectRoot, runDir }) => {
    const workItem = {
      id: "work.orders-repository",
      responsibilityUnitId: "ru.orders-repository",
      contractIds: ["contract.orders.persistence"],
      allowedPaths: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"]
    };
    await writeMinimalArtifacts({ runDir, workItem });
    await writeFile(path.join(projectRoot, "src", "data", "orders", "repository.mjs"), `
export function createOrder(input) { return input; }
export function getOrder(id) { return null; }
export function listOrders() { return []; }
export function __resetForTests() {}
`);

    const result = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_MODULE_SURFACE_EXTRA");
    assert.match(result.errors[0].reason, /__resetForTests/);
  });
});

test("module surface conformance accepts exactly declared module exports", async () => {
  await withRun(async ({ projectRoot, runDir }) => {
    const workItem = {
      id: "work.orders-repository",
      responsibilityUnitId: "ru.orders-repository",
      contractIds: ["contract.orders.persistence"],
      allowedPaths: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"]
    };
    await writeMinimalArtifacts({ runDir, workItem });
    await writeFile(path.join(projectRoot, "src", "data", "orders", "repository.mjs"), `
function createOrder(input) { return input; }
function getOrder(id) { return null; }
function listOrders() { return []; }
export { createOrder, getOrder, listOrders };
`);

    const result = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });

    assert.equal(result.ok, true);
  });
});

test("module surface conformance rejects function parameter signature drift", async () => {
  await withRun(async ({ projectRoot, runDir }) => {
    const workItem = {
      id: "work.orders-repository",
      responsibilityUnitId: "ru.orders-repository",
      contractIds: ["contract.orders.persistence"],
      allowedPaths: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"]
    };
    await writeMinimalArtifacts({ runDir, workItem });
    await writeFile(path.join(projectRoot, "src", "data", "orders", "repository.mjs"), `
export function createOrder(order) { return order; }
export function getOrder(id) { return null; }
export function listOrders() { return []; }
`);

    const result = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_MODULE_SIGNATURE_MISMATCH");
    assert.match(result.errors[0].reason, /createOrder/);
    assert.match(result.errors[0].reason, /expected input/);
    assert.match(result.errors[0].reason, /actual order/);
  });
});

test("module surface conformance rejects unverifiable declared signatures", async () => {
  await withRun(async ({ projectRoot, runDir }) => {
    const workItem = {
      id: "work.orders-repository",
      responsibilityUnitId: "ru.orders-repository",
      contractIds: ["contract.orders.persistence"],
      allowedPaths: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"]
    };
    await writeMinimalArtifacts({ runDir, workItem });
    await writeFile(path.join(projectRoot, "src", "data", "orders", "repository.mjs"), `
function makeCreateOrder() { return () => null; }
export const createOrder = makeCreateOrder();
export function getOrder(id) { return null; }
export function listOrders() { return []; }
`);

    const result = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_MODULE_SIGNATURE_UNVERIFIABLE");
    assert.match(result.errors[0].reason, /createOrder/);
  });
});

test("module surface conformance rejects private functions that match public names", async () => {
  await withRun(async ({ projectRoot, runDir }) => {
    const workItem = {
      id: "work.orders-repository",
      responsibilityUnitId: "ru.orders-repository",
      contractIds: ["contract.orders.persistence"],
      allowedPaths: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"]
    };
    await writeMinimalArtifacts({ runDir, workItem });
    await writeFile(path.join(projectRoot, "src", "data", "orders", "repository.mjs"), `
function createOrder(input) { return input; }
export function getOrder(id) { return null; }
export function listOrders() { return []; }
`);

    const result = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_MODULE_SURFACE_MISSING");
    assert.match(result.errors[0].reason, /createOrder/);
  });
});

test("module surface conformance rejects missing class method surfaces", async () => {
  await withRun(async ({ projectRoot, runDir }) => {
    const workItem = {
      id: "work.orders-repository",
      responsibilityUnitId: "ru.orders-repository",
      contractIds: ["contract.orders.persistence"],
      allowedPaths: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"]
    };
    await writeMinimalArtifacts({ runDir, workItem });
    const designPackPath = path.join(runDir, "design-pack.json");
    const designPack = JSON.parse(await readFile(designPackPath, "utf8"));
    designPack.moduleInterfaces[0].publicSurfaces = [{
      name: "OrderRepository.createOrder",
      kind: "module",
      contractIds: ["contract.orders.persistence"],
      signature: {
        inputs: [{ name: "input", type: "declared", required: true }],
        outputs: [{ name: "result", type: "declared" }],
        errors: [{ code: "BOUNDARY_CONTRACT_VIOLATION", when: "Invalid input.", handling: "Fail fast." }]
      }
    }];
    await writeJsonFile(designPackPath, designPack);
    await writeFile(path.join(projectRoot, "src", "data", "orders", "repository.mjs"), `
export class OrderRepository {
  listOrders() { return []; }
}
`);

    const result = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_MODULE_SURFACE_MISSING");
    assert.match(result.errors[0].reason, /OrderRepository.createOrder/);
  });
});

test("module surface conformance rejects private classes that match public method surfaces", async () => {
  await withRun(async ({ projectRoot, runDir }) => {
    const workItem = {
      id: "work.orders-repository",
      responsibilityUnitId: "ru.orders-repository",
      contractIds: ["contract.orders.persistence"],
      allowedPaths: ["src/data/orders/repository.mjs", "test/data/orders/repository.test.mjs"]
    };
    await writeMinimalArtifacts({ runDir, workItem });
    const designPackPath = path.join(runDir, "design-pack.json");
    const designPack = JSON.parse(await readFile(designPackPath, "utf8"));
    designPack.moduleInterfaces[0].publicSurfaces = [{
      name: "OrderRepository.createOrder",
      kind: "module",
      contractIds: ["contract.orders.persistence"],
      signature: {
        inputs: [{ name: "input", type: "declared", required: true }],
        outputs: [{ name: "result", type: "declared" }],
        errors: [{ code: "BOUNDARY_CONTRACT_VIOLATION", when: "Invalid input.", handling: "Fail fast." }]
      }
    }];
    await writeJsonFile(designPackPath, designPack);
    await writeFile(path.join(projectRoot, "src", "data", "orders", "repository.mjs"), `
class OrderRepository {
  createOrder(input) { return input; }
}
`);

    const result = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });

    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_MODULE_SURFACE_MISSING");
    assert.match(result.errors[0].reason, /OrderRepository.createOrder/);
  });
});
