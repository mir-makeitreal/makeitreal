import path from "node:path";
import { mkdir } from "node:fs/promises";
import { loadBoard, saveBoard, appendBoardEvent } from "./board-store.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern, reservedControlPlanePath } from "../domain/path-policy.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { readJsonFile, writeJsonFile, fileExists } from "../io/json.mjs";
import { canTransition } from "../kanban/state-engine.mjs";

const DEFAULT_MAX_DECOMPOSITION_DEPTH = 2;
const DEFAULT_MAX_CHILDREN_PER_PROPOSAL = 8;

/**
 * Validate a childWorkProposal against existing board state.
 *
 * @param {{
 *   proposal: object,
 *   parentWorkItem: object,
 *   board: object,
 *   artifacts: object,
 *   depth: number
 * }} options
 * @returns {{ ok: boolean, errors: object[] }}
 */
export function validateChildWorkProposal({ proposal, parentWorkItem, board, artifacts, depth }) {
  const errors = [];

  // 1. Schema version check
  if (!proposal || typeof proposal !== "object") {
    return { ok: false, errors: [createError("HARNESS_DECOMPOSE_SCHEMA_INVALID",
      "childWorkProposal must be a non-null object.")] };
  }

  // Limits are LLM-declared via board config; engine only validates against them.
  let maxDepth = board?.config?.maxDecompositionDepth;
  if (maxDepth === undefined || maxDepth === null) {
    console.warn("[make-it-real] maxDecompositionDepth not declared — using default 2.");
    maxDepth = DEFAULT_MAX_DECOMPOSITION_DEPTH;
  }
  let maxChildren = board?.config?.maxChildrenPerProposal;
  if (maxChildren === undefined || maxChildren === null) {
    console.warn("[make-it-real] maxChildrenPerProposal not declared — using default 8.");
    maxChildren = DEFAULT_MAX_CHILDREN_PER_PROPOSAL;
  }

  // 2. Depth limit
  const effectiveDepth = (depth ?? parentWorkItem.decompositionDepth ?? 0) + 1;
  if (effectiveDepth > maxDepth) {
    errors.push(createError("HARNESS_DECOMPOSE_DEPTH_EXCEEDED",
      `Decomposition depth ${effectiveDepth} exceeds maximum ${maxDepth}.`));
  }

  // 3. Children array
  const children = proposal.children ?? [];
  if (!Array.isArray(children) || children.length === 0) {
    errors.push(createError("HARNESS_DECOMPOSE_CHILDREN_EMPTY",
      "childWorkProposal.children must be a non-empty array."));
    return { ok: false, errors };
  }
  if (children.length > maxChildren) {
    errors.push(createError("HARNESS_DECOMPOSE_CHILDREN_EXCEEDED",
      `childWorkProposal has ${children.length} children, max is ${maxChildren}.`));
  }

  // 4. Unique child IDs
  const childIds = new Set();
  const existingIds = new Set(board.workItems.map(w => w.id));
  for (const child of children) {
    if (!child.id || typeof child.id !== "string") {
      errors.push(createError("HARNESS_DECOMPOSE_CHILD_ID_MISSING",
        "Each child must have a non-empty string id."));
      continue;
    }
    if (childIds.has(child.id)) {
      errors.push(createError("HARNESS_DECOMPOSE_CHILD_ID_DUPLICATE",
        `Duplicate child work item id: ${child.id}.`));
    }
    if (existingIds.has(child.id)) {
      errors.push(createError("HARNESS_DECOMPOSE_CHILD_ID_CONFLICT",
        `Child id ${child.id} conflicts with existing board work item.`));
    }
    childIds.add(child.id);
  }

  // 5. Child allowedPaths ⊆ parent allowedPaths
  for (const child of children) {
    for (const childPath of child.allowedPaths ?? []) {
      if (reservedControlPlanePath(childPath)) {
        errors.push(createError("HARNESS_DECOMPOSE_PATH_RESERVED",
          `Child ${child.id} uses reserved path: ${childPath}.`));
      } else if (invalidAllowedPathPattern(childPath)) {
        errors.push(createError("HARNESS_DECOMPOSE_PATH_INVALID",
          `Child ${child.id} has invalid path pattern: ${childPath}.`));
      }
      // Path subsumption check: child path must be under a parent path
      if (!isSubsumedByAny(childPath, parentWorkItem.allowedPaths ?? [])) {
        errors.push(createError("HARNESS_DECOMPOSE_PATH_OUTSIDE_PARENT",
          `Child ${child.id} path ${childPath} is not within parent's allowed paths.`));
      }
    }
  }

  // 6. No overlapping allowedPaths between children
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      for (const leftPath of children[i].allowedPaths ?? []) {
        for (const rightPath of children[j].allowedPaths ?? []) {
          if (patternsOverlap(leftPath, rightPath)) {
            errors.push(createError("HARNESS_DECOMPOSE_PATH_OVERLAP",
              `Children ${children[i].id} and ${children[j].id} overlap on ${leftPath} / ${rightPath}.`));
          }
        }
      }
    }
  }

  // 7. DAG is acyclic among children
  const childIdSet = new Set(children.map(c => c.id));
  for (const child of children) {
    for (const dep of child.dependsOn ?? []) {
      if (!childIdSet.has(dep) && dep !== parentWorkItem.id) {
        errors.push(createError("HARNESS_DECOMPOSE_DEPENDENCY_INVALID",
          `Child ${child.id} depends on ${dep} which is not a sibling child or parent.`));
      }
    }
  }
  if (hasCycle(children)) {
    errors.push(createError("HARNESS_DECOMPOSE_CYCLE",
      "childWorkProposal.children contain a dependency cycle."));
  }

  // 8. Verification commands parse
  for (const child of children) {
    if (!Array.isArray(child.verificationCommands) || child.verificationCommands.length === 0) {
      errors.push(createError("HARNESS_DECOMPOSE_VERIFICATION_MISSING",
        `Child ${child.id} must have at least one verificationCommand.`));
    }
  }

  // 9. Done evidence plan — the LLM decides which evidence kinds are required.
  // The engine only enforces that some done-evidence plan exists.
  for (const child of children) {
    const doneEvidence = child.doneEvidence ?? [];
    if (!Array.isArray(doneEvidence) || doneEvidence.length === 0) {
      errors.push(createError("HARNESS_DECOMPOSE_EVIDENCE_MISSING",
        `Child ${child.id} must plan at least one done evidence item.`));
    }
  }

  // 10. Reason is provided
  if (!proposal.reason || typeof proposal.reason !== "string" || proposal.reason.trim().length < 10) {
    errors.push(createError("HARNESS_DECOMPOSE_REASON_MISSING",
      "childWorkProposal.reason must be a non-empty explanation (min 10 chars)."));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Atomically materialize child work items on the board.
 *
 * @param {{
 *   boardDir: string,
 *   parentWorkItemId: string,
 *   proposal: object,
 *   now: Date
 * }} options
 * @returns {Promise<{ ok: boolean, childWorkItemIds: string[], errors: object[] }>}
 */
export async function materializeChildWorkItems({ boardDir, parentWorkItemId, proposal, now }) {
  const board = await loadBoard(boardDir);
  const parentWorkItem = board.workItems.find(w => w.id === parentWorkItemId);
  if (!parentWorkItem) {
    return { ok: false, childWorkItemIds: [], errors: [
      createError("HARNESS_WORK_ITEM_UNKNOWN", `Parent work item not found: ${parentWorkItemId}`)
    ]};
  }

  const artifacts = await loadRunArtifacts(boardDir);
  const parentDepth = parentWorkItem.decompositionDepth ?? 0;

  // Validate proposal
  const validation = validateChildWorkProposal({
    proposal,
    parentWorkItem,
    board,
    artifacts,
    depth: parentDepth
  });
  if (!validation.ok) {
    return { ok: false, childWorkItemIds: [], errors: validation.errors };
  }

  // Materialize children on board
  const childWorkItemIds = [];
  for (const child of proposal.children) {
    const childWorkItem = {
      ...child,
      schemaVersion: "1.0",
      lane: "Ready",
      parentWorkItemId,
      decompositionDepth: parentDepth + 1,
      childWorkItemIds: [],
      prdId: parentWorkItem.prdId,
      prdTrace: parentWorkItem.prdTrace
    };
    board.workItems.push(childWorkItem);
    childWorkItemIds.push(child.id);
  }

  // Update parent through state machine
  const decomposing = canTransition({
    from: parentWorkItem.lane,
    to: "Decomposing",
    context: { gates: {} }
  });
  if (!decomposing.ok) {
    return { ok: false, childWorkItemIds: [], errors: decomposing.errors };
  }
  parentWorkItem.lane = "Decomposing";
  parentWorkItem.childWorkItemIds = childWorkItemIds;

  // Update DAG
  const dag = artifacts.workItemDag;
  for (const child of proposal.children) {
    dag.nodes.push({
      id: child.id,
      kind: "implementation",
      requiredForDone: true,
      responsibilityUnitId: child.responsibilityUnitId
    });
    // Add edges from child to its dependencies
    for (const depId of child.dependsOn ?? []) {
      const contractId = findSharedContract(child, proposal.children.find(c => c.id === depId));
      dag.edges.push({
        from: depId,
        to: child.id,
        kind: contractId ? "contract-dependency" : "coordination",
        ...(contractId ? { contractId } : {})
      });
    }
  }

  // Write new contract files if any
  for (const contract of proposal.newContracts ?? []) {
    const contractPath = path.join(boardDir, "contracts",
      `${contract.contractId.replace(/\./g, "-")}.json`);
    await mkdir(path.dirname(contractPath), { recursive: true });
    await writeJsonFile(contractPath, contract);
  }

  // Write new responsibility units
  if (proposal.newResponsibilityUnits?.length > 0) {
    const ruPath = path.join(boardDir, "responsibility-units.json");
    let ru;
    try {
      ru = await readJsonFile(ruPath);
    } catch {
      ru = { schemaVersion: "1.0", units: [] };
    }
    if (!ru.units) {
      ru.units = [];
    }
    for (const unit of proposal.newResponsibilityUnits) {
      if (!ru.units.some(u => u.id === unit.id)) {
        ru.units.push(unit);
      }
    }
    await writeJsonFile(ruPath, ru);
  }

  // Write child work item files
  for (const child of proposal.children) {
    const workItemPath = path.join(boardDir, "work-items", `${child.id}.json`);
    await mkdir(path.dirname(workItemPath), { recursive: true });
    const childWorkItem = board.workItems.find(w => w.id === child.id);
    await writeJsonFile(workItemPath, childWorkItem);
  }

  // Save updated DAG
  await writeJsonFile(path.join(boardDir, "work-item-dag.json"), dag);

  // Save board
  await saveBoard(boardDir, board);

  // Emit events
  await appendBoardEvent(boardDir, {
    event: "work_decomposed",
    timestamp: now.toISOString(),
    workItemId: parentWorkItemId,
    payload: { childWorkItemIds, reason: proposal.reason }
  });
  for (const childId of childWorkItemIds) {
    await appendBoardEvent(boardDir, {
      event: "work_ready",
      timestamp: now.toISOString(),
      workItemId: childId,
      payload: { source: "decomposition", parentWorkItemId }
    });
  }

  return { ok: true, childWorkItemIds, errors: [] };
}

/**
 * Observe whether all children of a parent are Done.
 *
 * Doctrine: the engine does NOT autonomously transition the parent. It only
 * detects the condition and emits a "children_complete" board event so the LLM
 * can observe it and explicitly decide whether to move the parent (e.g. to
 * "Verifying"). The parent stays in its current lane until the LLM acts.
 *
 * @param {{ boardDir: string, parentWorkItemId: string, now: Date }} options
 * @returns {Promise<{ ok: boolean, transitioned: boolean, childrenComplete: boolean, parentWorkItemId: string, errors: object[] }>}
 */
export async function completeParentWhenChildrenDone({ boardDir, parentWorkItemId, now }) {
  const board = await loadBoard(boardDir);
  const parent = board.workItems.find(w => w.id === parentWorkItemId);
  if (!parent || parent.lane !== "Decomposing") {
    return { ok: true, transitioned: false, childrenComplete: false, parentWorkItemId, errors: [] };
  }

  const childIds = parent.childWorkItemIds ?? [];
  if (childIds.length === 0) {
    return { ok: true, transitioned: false, childrenComplete: false, parentWorkItemId, errors: [] };
  }

  const allDone = childIds.every(id => {
    const child = board.workItems.find(w => w.id === id);
    return child && child.lane === "Done";
  });

  if (!allDone) {
    return { ok: true, transitioned: false, childrenComplete: false, parentWorkItemId, errors: [] };
  }

  // Children are complete. Emit an event for the LLM to observe — do NOT move
  // the parent. The LLM must explicitly trigger any lane transition.
  await appendBoardEvent(boardDir, {
    event: "children_complete",
    timestamp: now.toISOString(),
    workItemId: parentWorkItemId,
    payload: { source: "children_complete" }
  });

  return { ok: true, transitioned: false, childrenComplete: true, parentWorkItemId, errors: [] };
}

// ── Helpers ───────────────────────────────────────────────────────

function createError(code, reason) {
  return createHarnessError({ code, reason, evidence: ["board.json"], recoverable: true });
}

function normalizePattern(p) {
  return String(p ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

function patternBase(p) {
  const n = normalizePattern(p);
  return n.endsWith("/**") ? n.slice(0, -3) : n;
}

function patternsOverlap(a, b) {
  const ba = patternBase(a);
  const bb = patternBase(b);
  return ba === bb || ba.startsWith(`${bb}/`) || bb.startsWith(`${ba}/`);
}

function isSubsumedByAny(childPath, parentPaths) {
  const childBase = patternBase(childPath);
  return parentPaths.some(parentPath => {
    const parentBase = patternBase(parentPath);
    return childBase === parentBase || childBase.startsWith(`${parentBase}/`);
  });
}

function hasCycle(children) {
  const visited = new Set();
  const stack = new Set();
  const adj = new Map(children.map(c => [c.id, c.dependsOn ?? []]));

  function dfs(id) {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const dep of adj.get(id) ?? []) {
      if (adj.has(dep) && dfs(dep)) return true;
    }
    stack.delete(id);
    return false;
  }

  return children.some(c => dfs(c.id));
}

function findSharedContract(child, dep) {
  if (!dep) return null;
  const depContracts = new Set(dep.contractIds ?? []);
  return (child.dependencyContracts ?? [])
    .find(dc => depContracts.has(dc.contractId))?.contractId ?? null;
}
