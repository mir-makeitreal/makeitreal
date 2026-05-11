import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { readJsonFile } from "../io/json.mjs";

function matchesPattern(pattern, candidate) {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedCandidate = candidate.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalizedPattern.endsWith("/**")) {
    const base = normalizedPattern.slice(0, -3);
    return normalizedCandidate === base || normalizedCandidate.startsWith(`${base}/`);
  }
  return normalizedPattern === normalizedCandidate;
}

function ownsContractPath(unit, paths) {
  return paths
    .filter((candidate) => candidate.startsWith("contracts/"))
    .some((candidate) => (unit.owns ?? []).some((pattern) => matchesPattern(pattern, candidate)));
}

export async function validateBoardWorkItemOwner({ boardDir, workItem }) {
  const responsibilityUnits = await readJsonFile(path.join(boardDir, "responsibility-units.json"));
  const owners = responsibilityUnits.units.filter((unit) => unit.id === workItem.responsibilityUnitId && unit.owner);
  if (owners.length !== 1) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_RESPONSIBILITY_OWNER_INVALID",
        reason: `Work item requires exactly one owner: ${workItem.responsibilityUnitId ?? "(missing)"}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["responsibility-units.json", "board.json"]
      })]
    };
  }

  return { ok: true, errors: [] };
}

export async function validateBoardWorkItemBoundary({ boardDir, workItem }) {
  const responsibilityUnits = await readJsonFile(path.join(boardDir, "responsibility-units.json"));
  const unit = responsibilityUnits.units.find((candidate) => candidate.id === workItem.responsibilityUnitId);
  if (!unit) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_RESPONSIBILITY_OWNER_INVALID",
        reason: `Unknown responsibility unit: ${workItem.responsibilityUnitId ?? "(missing)"}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["responsibility-units.json", "board.json"]
      })]
    };
  }

  const unauthorizedContracts = (workItem.contractIds ?? []).filter((contractId) => {
    if ((unit.mayUseContracts ?? []).includes(contractId)) {
      return false;
    }
    return !ownsContractPath(unit, workItem.allowedPaths ?? []);
  });

  if (unauthorizedContracts.length > 0) {
    return {
      ok: false,
      errors: unauthorizedContracts.map((contractId) => createHarnessError({
        code: "HARNESS_CONTRACT_USAGE_UNAUTHORIZED",
        reason: `${workItem.responsibilityUnitId} may not use ${contractId}.`,
        contractId,
        ownerModule: workItem.responsibilityUnitId,
        evidence: ["responsibility-units.json", "board.json"]
      }))
    };
  }

  return { ok: true, errors: [] };
}

export function validateChangedPaths({ workItem, changedPaths }) {
  const outside = changedPaths.filter((candidate) =>
    !(workItem.allowedPaths ?? []).some((pattern) => matchesPattern(pattern, candidate))
  );

  if (outside.length > 0) {
    return {
      ok: false,
      errors: outside.map((candidate) => createHarnessError({
        code: "HARNESS_PATH_BOUNDARY_VIOLATION",
        reason: `${candidate} is outside allowed paths for ${workItem.id}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [candidate]
      }))
    };
  }

  return { ok: true, errors: [] };
}
