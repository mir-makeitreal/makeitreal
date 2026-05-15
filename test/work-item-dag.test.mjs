import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectBoardDag,
  requiredDagNodeIds,
  topologicalDagNodeIds,
  validateWorkItemDag
} from "../src/domain/work-item-dag.mjs";

const workItems = [
  {
    id: "work.orders-repository",
    responsibilityUnitId: "ru.orders-repository",
    allowedPaths: ["src/data/orders/**"],
    contractIds: ["contract.orders.persistence"],
    dependsOn: [],
    doneEvidence: [{ kind: "verification", path: "evidence/work.orders-repository.verification.json" }],
    verificationCommands: [{ file: "node", args: ["--test"] }]
  },
  {
    id: "work.orders-api",
    responsibilityUnitId: "ru.orders-api",
    allowedPaths: ["src/api/orders/**"],
    contractIds: ["contract.orders.create"],
    dependencyContracts: [{
      contractId: "contract.orders.persistence",
      providerResponsibilityUnitId: "ru.orders-repository",
      surface: "OrdersRepository.create",
      allowedUse: "Use repository contract only."
    }],
    dependsOn: ["work.orders-repository"],
    doneEvidence: [{ kind: "verification", path: "evidence/work.orders-api.verification.json" }],
    verificationCommands: [{ file: "node", args: ["--test"] }]
  }
];

const dag = {
  schemaVersion: "1.0",
  runId: "feature-orders",
  nodes: [
    {
      id: "work.orders-repository",
      kind: "implementation",
      responsibilityUnitId: "ru.orders-repository",
      requiredForDone: true
    },
    {
      id: "work.orders-api",
      kind: "implementation",
      responsibilityUnitId: "ru.orders-api",
      requiredForDone: true
    }
  ],
  edges: [{
    from: "work.orders-repository",
    to: "work.orders-api",
    contractId: "contract.orders.persistence"
  }]
};

test("validates DAG and board parity", () => {
  const result = validateWorkItemDag({ dag, workItems });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects missing work item for DAG node", () => {
  const broken = {
    ...dag,
    nodes: [...dag.nodes, {
      id: "work.missing",
      kind: "implementation",
      responsibilityUnitId: "ru.missing",
      requiredForDone: true
    }]
  };
  const result = validateWorkItemDag({ dag: broken, workItems });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_NODE_WORK_ITEM_MISSING");
});

test("rejects dependency edge drift", () => {
  const drifted = workItems.map((item) => item.id === "work.orders-api"
    ? { ...item, dependsOn: [] }
    : item);
  const result = validateWorkItemDag({ dag, workItems: drifted });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_DEPENDENCY_DRIFT");
});

test("rejects dependency cycles", () => {
  const broken = {
    ...dag,
    edges: [
      ...dag.edges,
      { from: "work.orders-api", to: "work.orders-repository", contractId: "contract.orders.create" }
    ]
  };
  const result = validateWorkItemDag({ dag: broken, workItems });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_CYCLE");
});

test("rejects sibling allowed path overlap", () => {
  const overlapping = [
    workItems[0],
    { ...workItems[1], allowedPaths: ["src/data/orders/create.py"] }
  ];
  const result = validateWorkItemDag({ dag, workItems: overlapping });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_PATH_OVERLAP");
});

test("returns topological and required node ids", () => {
  assert.deepEqual(topologicalDagNodeIds(dag), ["work.orders-repository", "work.orders-api"]);
  assert.deepEqual(requiredDagNodeIds(dag), ["work.orders-repository", "work.orders-api"]);
});

test("projects canonical DAG to board workItemDAG", () => {
  assert.deepEqual(projectBoardDag(dag), {
    schemaVersion: "1.0",
    nodes: [
      { workItemId: "work.orders-repository", kind: "implementation", requiredForDone: true },
      { workItemId: "work.orders-api", kind: "implementation", requiredForDone: true }
    ],
    edges: [{ from: "work.orders-repository", to: "work.orders-api", contractId: "contract.orders.persistence" }]
  });
});
