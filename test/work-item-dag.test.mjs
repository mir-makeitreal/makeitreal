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
    kind: "contract-dependency",
    contractId: "contract.orders.persistence"
  }]
};

const responsibilityUnits = {
  schemaVersion: "1.0",
  units: [
    {
      id: "ru.orders-repository",
      owner: "team.data",
      owns: ["src/data/orders/**"],
      publicSurfaces: ["OrdersRepository.create"],
      mayUseContracts: ["contract.orders.persistence"],
      mustProvideContracts: ["contract.orders.persistence"]
    },
    {
      id: "ru.orders-api",
      owner: "team.api",
      owns: ["src/api/orders/**"],
      publicSurfaces: ["POST /orders"],
      mayUseContracts: ["contract.orders.create", "contract.orders.persistence"],
      mustProvideContracts: ["contract.orders.create"]
    }
  ]
};

test("validates DAG and board parity", () => {
  const result = validateWorkItemDag({ dag, workItems, responsibilityUnits });
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
  const result = validateWorkItemDag({ dag, workItems: drifted, responsibilityUnits });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_DEPENDENCY_DRIFT");
});

test("rejects dependency edges without explicit kind", () => {
  const broken = {
    ...dag,
    edges: [{ from: "work.orders-repository", to: "work.orders-api", contractId: "contract.orders.persistence" }]
  };
  const result = validateWorkItemDag({ dag: broken, workItems, responsibilityUnits });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_EDGE_KIND_INVALID");
});

test("rejects contract dependency edges without explicit contracts", () => {
  const broken = {
    ...dag,
    edges: [{ from: "work.orders-repository", to: "work.orders-api", kind: "contract-dependency" }]
  };
  const result = validateWorkItemDag({ dag: broken, workItems, responsibilityUnits });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === "HARNESS_DAG_EDGE_CONTRACT_MISSING"), true);
});

test("rejects dependency edges for contracts not declared by both endpoints", () => {
  const broken = {
    ...dag,
    edges: [{ from: "work.orders-repository", to: "work.orders-api", kind: "contract-dependency", contractId: "contract.orders.shipping" }]
  };
  const result = validateWorkItemDag({ dag: broken, workItems, responsibilityUnits });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DAG_EDGE_CONTRACT_INVALID");
});

test("rejects dependency edges whose provider unit does not provide the contract", () => {
  const brokenUnits = {
    ...responsibilityUnits,
    units: responsibilityUnits.units.map((unit) => unit.id === "ru.orders-repository"
      ? { ...unit, mustProvideContracts: [] }
      : unit)
  };
  const result = validateWorkItemDag({ dag, workItems, responsibilityUnits: brokenUnits });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === "HARNESS_DAG_EDGE_PROVIDER_INVALID"), true);
});

test("rejects dependency edges whose consumer lacks provider surface contract", () => {
  const brokenItems = workItems.map((item) => item.id === "work.orders-api"
    ? { ...item, dependencyContracts: [] }
    : item);
  const result = validateWorkItemDag({ dag, workItems: brokenItems, responsibilityUnits });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === "HARNESS_DAG_EDGE_CONSUMER_INVALID"), true);
});

test("accepts coordination edges without software contract semantics", () => {
  const coordination = {
    schemaVersion: "1.0",
    runId: "feature-orders",
    nodes: [
      { id: "work.orders-pm", kind: "domain-pm", responsibilityUnitId: "ru.orders-pm", requiredForDone: true },
      dag.nodes[0]
    ],
    edges: [{ from: "work.orders-pm", to: "work.orders-repository", kind: "coordination" }]
  };
  const items = [
    { id: "work.orders-pm", responsibilityUnitId: "ru.orders-pm", allowedPaths: [], contractIds: [], dependsOn: [] },
    { ...workItems[0], dependsOn: ["work.orders-pm"] }
  ];
  const result = validateWorkItemDag({ dag: coordination, workItems: items, responsibilityUnits: {
    schemaVersion: "1.0",
    units: [{ id: "ru.orders-pm", mustProvideContracts: [] }, responsibilityUnits.units[0]]
  } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects dependency cycles", () => {
  const broken = {
    ...dag,
    edges: [
      ...dag.edges,
      { from: "work.orders-api", to: "work.orders-repository", kind: "contract-dependency", contractId: "contract.orders.persistence" }
    ]
  };
  const result = validateWorkItemDag({ dag: broken, workItems, responsibilityUnits });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === "HARNESS_DAG_CYCLE"), true);
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
    edges: [{ from: "work.orders-repository", to: "work.orders-api", kind: "contract-dependency", contractId: "contract.orders.persistence" }]
  });
});
