import { createHarnessError } from "./errors.mjs";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function criterionIds(prd) {
  return new Set((prd?.acceptanceCriteria ?? [])
    .filter((criterion) => criterion && typeof criterion === "object")
    .map((criterion) => criterion.id)
    .filter(nonEmptyString));
}

export function validatePrd(prd) {
  const errors = [];

  for (const key of ["schemaVersion", "id", "title"]) {
    if (!nonEmptyString(prd?.[key])) {
      errors.push(createHarnessError({
        code: "HARNESS_PRD_INVALID",
        reason: `PRD is missing required string field: ${key}`,
        evidence: ["prd.json"]
      }));
    }
  }

  for (const key of ["goals", "userVisibleBehavior", "acceptanceCriteria", "nonGoals"]) {
    if (!nonEmptyArray(prd?.[key])) {
      errors.push(createHarnessError({
        code: "HARNESS_PRD_INVALID",
        reason: `PRD is missing required non-empty array: ${key}`,
        evidence: ["prd.json"]
      }));
    }
  }

  for (const criterion of prd?.acceptanceCriteria ?? []) {
    if (!criterion || typeof criterion !== "object" || !nonEmptyString(criterion.id) || !nonEmptyString(criterion.statement)) {
      errors.push(createHarnessError({
        code: "HARNESS_PRD_INVALID",
        reason: "Each PRD acceptance criterion must have id and statement fields.",
        evidence: ["prd.json"]
      }));
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateWorkItemPrdTrace({ prd, workItem }) {
  const errors = [];
  if (workItem.prdId !== prd.id) {
    errors.push(createHarnessError({
      code: "HARNESS_PRD_TRACE_INVALID",
      reason: `Work item ${workItem.id} does not trace to PRD ${prd.id}.`,
      evidence: ["prd.json", "work-items"]
    }));
  }

  const traceIds = workItem.prdTrace?.acceptanceCriteriaIds ?? [];
  if (!nonEmptyArray(traceIds)) {
    errors.push(createHarnessError({
      code: "HARNESS_PRD_TRACE_INVALID",
      reason: `Work item ${workItem.id} must trace to at least one PRD acceptance criterion.`,
      evidence: ["work-items"]
    }));
  }

  const ids = criterionIds(prd);
  for (const traceId of traceIds) {
    if (!ids.has(traceId)) {
      errors.push(createHarnessError({
        code: "HARNESS_PRD_TRACE_INVALID",
        reason: `Work item ${workItem.id} references unknown PRD acceptance criterion: ${traceId}`,
        evidence: ["prd.json", "work-items"]
      }));
    }
  }

  const traceSet = new Set(traceIds);
  const missingIds = [...ids].filter((id) => !traceSet.has(id));
  const duplicateIds = traceIds.filter((traceId, index) => traceIds.indexOf(traceId) !== index);
  if (missingIds.length > 0 || duplicateIds.length > 0 || traceSet.size !== ids.size) {
    errors.push(createHarnessError({
      code: "HARNESS_PRD_TRACE_INCOMPLETE",
      reason: `Work item ${workItem.id} must trace exactly all PRD acceptance criteria.`,
      evidence: ["prd.json", "work-items"]
    }));
  }

  return { ok: errors.length === 0, errors };
}
