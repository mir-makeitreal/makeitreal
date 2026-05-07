import { createHarnessError } from "./errors.mjs";

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

export function validateDesignPack(designPack) {
  const errors = [];

  for (const key of ["architecture", "stateFlow", "apiSpecs", "responsibilityBoundaries", "callStacks", "sequences"]) {
    if (!designPack || !designPack[key]) {
      errors.push(createHarnessError({
        code: "HARNESS_DESIGN_PACK_INVALID",
        reason: `DesignPack is missing required section: ${key}`,
        evidence: ["design-pack.json"]
      }));
    }
  }

  if (!designPack?.architecture?.nodes || !hasNonEmptyArray(designPack.architecture.nodes)) {
    errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: "architecture.nodes must be a non-empty array.", evidence: ["design-pack.json"] }));
  }

  if (!designPack?.architecture?.edges || !hasNonEmptyArray(designPack.architecture.edges)) {
    errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: "architecture.edges must be a non-empty array.", evidence: ["design-pack.json"] }));
  }

  if (!designPack?.stateFlow?.lanes || !hasNonEmptyArray(designPack.stateFlow.lanes)) {
    errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: "stateFlow.lanes must be a non-empty array.", evidence: ["design-pack.json"] }));
  }

  if (!designPack?.stateFlow?.transitions || !hasNonEmptyArray(designPack.stateFlow.transitions)) {
    errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: "stateFlow.transitions must be a non-empty array.", evidence: ["design-pack.json"] }));
  }

  for (const key of ["apiSpecs", "responsibilityBoundaries", "callStacks", "sequences"]) {
    if (designPack?.[key] && !hasNonEmptyArray(designPack[key])) {
      errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `${key} must be a non-empty array.`, evidence: ["design-pack.json"] }));
    }
  }

  for (const spec of designPack?.apiSpecs ?? []) {
    if (spec.kind === "none" && (!spec.reason || typeof spec.reason !== "string")) {
      errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: "apiSpecs kind none requires a reason.", evidence: ["design-pack.json"] }));
    }
  }

  const declaredContractIds = new Set((designPack?.apiSpecs ?? []).map((spec) => spec.contractId).filter(Boolean));
  for (const edge of designPack?.architecture?.edges ?? []) {
    if (edge.contractId && !declaredContractIds.has(edge.contractId)) {
      errors.push(createHarnessError({
        code: "HARNESS_CONTRACT_REFERENCE_INVALID",
        reason: `Architecture edge references undeclared contract: ${edge.contractId}`,
        contractId: edge.contractId,
        evidence: ["design-pack.json"]
      }));
    }
  }

  return { ok: errors.length === 0, errors };
}
