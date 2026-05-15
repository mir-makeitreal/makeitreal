import { createHarnessError } from "./errors.mjs";

const VALID_NODE_KINDS = new Set(["implementation", "domain-pm", "integration-evidence"]);

function workById(workItems = []) {
  return new Map(workItems.map((item) => [item.id, item]));
}

function nodeById(dag) {
  return new Map((dag.nodes ?? []).map((node) => [node.id, node]));
}

function normalizePattern(pattern) {
  return String(pattern ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

function patternBase(pattern) {
  const normalized = normalizePattern(pattern);
  return normalized.endsWith("/**") ? normalized.slice(0, -3) : normalized;
}

function patternsOverlap(left, right) {
  const a = patternBase(left);
  const b = patternBase(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function createDagError(code, reason, evidence = ["work-item-dag.json"]) {
  return createHarnessError({ code, reason, evidence, recoverable: true });
}

export function requiredDagNodeIds(dag) {
  return (dag.nodes ?? [])
    .filter((node) => node.requiredForDone !== false)
    .map((node) => node.id);
}

export function topologicalDagNodeIds(dag) {
  const nodes = nodeById(dag);
  const outgoing = new Map();
  const indegree = new Map();
  for (const node of dag.nodes ?? []) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }
  for (const edge of dag.edges ?? []) {
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const ready = [...nodes.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered = [];
  while (ready.length > 0) {
    const id = ready.shift();
    ordered.push(id);
    for (const next of outgoing.get(id) ?? []) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
      }
    }
  }
  return ordered;
}

export function projectBoardDag(dag) {
  return {
    schemaVersion: "1.0",
    nodes: (dag.nodes ?? []).map((node) => ({
      workItemId: node.id,
      kind: node.kind,
      requiredForDone: node.requiredForDone !== false
    })),
    edges: (dag.edges ?? []).map((edge) => ({
      from: edge.from,
      to: edge.to,
      contractId: edge.contractId
    }))
  };
}

export function validateWorkItemDag({ dag, workItems = [] }) {
  const errors = [];
  if (!dag || typeof dag !== "object") {
    return {
      ok: false,
      errors: [createDagError("HARNESS_DAG_INVALID", "work-item-dag.json must contain an object.")]
    };
  }
  if (!Array.isArray(dag.nodes) || dag.nodes.length === 0) {
    errors.push(createDagError("HARNESS_DAG_INVALID", "work-item-dag.json requires non-empty nodes."));
  }
  if (!Array.isArray(dag.edges)) {
    errors.push(createDagError("HARNESS_DAG_INVALID", "work-item-dag.json requires edges array."));
  }

  const workItemsById = workById(workItems);
  const seenNodes = new Set();
  for (const node of dag.nodes ?? []) {
    if (!node.id || seenNodes.has(node.id)) {
      errors.push(createDagError("HARNESS_DAG_NODE_INVALID", `DAG node id is missing or duplicated: ${node.id ?? "(missing)"}.`));
      continue;
    }
    seenNodes.add(node.id);
    if (!VALID_NODE_KINDS.has(node.kind)) {
      errors.push(createDagError("HARNESS_DAG_NODE_KIND_INVALID", `${node.id} has unsupported kind ${node.kind ?? "(missing)"}.`));
    }
    if (!workItemsById.has(node.id)) {
      errors.push(createDagError("HARNESS_DAG_NODE_WORK_ITEM_MISSING", `${node.id} has no matching board work item.`));
    }
  }

  const nodes = nodeById(dag);
  const driftErrors = [];
  for (const edge of dag.edges ?? []) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      errors.push(createDagError("HARNESS_DAG_EDGE_INVALID", `DAG edge references missing node: ${edge.from} -> ${edge.to}.`));
    }
    const target = workItemsById.get(edge.to);
    if (target && !(target.dependsOn ?? []).includes(edge.from)) {
      driftErrors.push(createDagError("HARNESS_DAG_DEPENDENCY_DRIFT", `${edge.to} must dependOn ${edge.from}.`));
    }
  }

  if (topologicalDagNodeIds(dag).length !== (dag.nodes ?? []).length) {
    errors.push(createDagError("HARNESS_DAG_CYCLE", "work-item-dag.json contains a dependency cycle."));
  }
  errors.push(...driftErrors);

  for (let leftIndex = 0; leftIndex < workItems.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < workItems.length; rightIndex += 1) {
      const left = workItems[leftIndex];
      const right = workItems[rightIndex];
      const parentChild = left.parentWorkItemId === right.id || right.parentWorkItemId === left.id;
      if (parentChild) {
        continue;
      }
      for (const leftPath of left.allowedPaths ?? []) {
        for (const rightPath of right.allowedPaths ?? []) {
          if (patternsOverlap(leftPath, rightPath)) {
            errors.push(createDagError("HARNESS_DAG_PATH_OVERLAP", `${left.id} and ${right.id} overlap on ${leftPath} / ${rightPath}.`));
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
