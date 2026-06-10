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

  return { ok: errors.length === 0, errors };
}

// Run-level invariant replacing the old per-item "trace exactly all criteria"
// rule, which the normalizer satisfied trivially by injecting every criterion
// into every work item. The real guarantee is coverage: every PRD acceptance
// criterion must be delivered by at least one work item.
export function validatePrdTraceCoverage({ prd, workItems }) {
  const covered = new Set((workItems ?? [])
    .flatMap((workItem) => workItem?.prdTrace?.acceptanceCriteriaIds ?? []));
  const uncovered = [...criterionIds(prd)].filter((id) => !covered.has(id));
  const errors = uncovered.length === 0 ? [] : [createHarnessError({
    code: "HARNESS_PRD_TRACE_INCOMPLETE",
    reason: `PRD acceptance criteria are not covered by any work item: ${uncovered.join(", ")}.`,
    evidence: ["prd.json", "work-items"]
  })];
  return { ok: errors.length === 0, errors };
}
