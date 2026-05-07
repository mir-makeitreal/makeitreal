import { createHarnessError } from "../domain/errors.mjs";

function byId(board) {
  return new Map(board.workItems.map((item) => [item.id, item]));
}

function isDone(item) {
  return item?.lane === "Done";
}

export function getBlockedWorkItems(board) {
  const itemsById = byId(board);
  return board.workItems.filter((item) =>
    item.lane === "Ready" && (item.dependsOn ?? []).some((id) => !isDone(itemsById.get(id)))
  );
}

export function getReadyWorkItems(board) {
  const blockedIds = new Set(getBlockedWorkItems(board).map((item) => item.id));
  return board.workItems.filter((item) => item.lane === "Ready" && !blockedIds.has(item.id));
}

export function validateDependencyGraph(board) {
  const itemsById = byId(board);
  const errors = [];

  for (const item of board.workItems) {
    for (const dependencyId of item.dependsOn ?? []) {
      if (!itemsById.has(dependencyId)) {
        errors.push(createHarnessError({
          code: "HARNESS_DEPENDENCY_MISSING",
          reason: `${item.id} depends on missing work item ${dependencyId}.`,
          evidence: ["board.json"]
        }));
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id)) {
      return false;
    }
    if (visited.has(id)) {
      return true;
    }

    visiting.add(id);
    for (const dependencyId of itemsById.get(id)?.dependsOn ?? []) {
      if (!visit(dependencyId)) {
        return false;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  }

  for (const item of board.workItems) {
    if (!visit(item.id)) {
      errors.push(createHarnessError({
        code: "HARNESS_DEPENDENCY_CYCLE",
        reason: `Dependency cycle includes ${item.id}.`,
        evidence: ["board.json"]
      }));
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}
