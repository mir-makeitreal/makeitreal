import { createHarnessError } from "./errors.mjs";

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateDesignPack(designPack) {
  const errors = [];

  for (const key of ["architecture", "stateFlow", "apiSpecs", "responsibilityBoundaries", "moduleInterfaces", "callStacks", "sequences"]) {
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

  for (const key of ["apiSpecs", "responsibilityBoundaries", "moduleInterfaces", "callStacks", "sequences"]) {
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

  const declaredResponsibilityUnitIds = new Set((designPack?.responsibilityBoundaries ?? []).map((boundary) => boundary.responsibilityUnitId).filter(Boolean));
  for (const moduleInterface of designPack?.moduleInterfaces ?? []) {
    if (!hasText(moduleInterface.responsibilityUnitId)) {
      errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: "moduleInterfaces entries require responsibilityUnitId.", evidence: ["design-pack.json"] }));
      continue;
    }
    if (!declaredResponsibilityUnitIds.has(moduleInterface.responsibilityUnitId)) {
      errors.push(createHarnessError({
        code: "HARNESS_RESPONSIBILITY_REFERENCE_INVALID",
        reason: `moduleInterfaces references undeclared responsibility unit: ${moduleInterface.responsibilityUnitId}`,
        ownerModule: moduleInterface.responsibilityUnitId,
        evidence: ["design-pack.json"]
      }));
    }
    if (!hasText(moduleInterface.moduleName)) {
      errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `moduleInterfaces.${moduleInterface.responsibilityUnitId} requires moduleName.`, evidence: ["design-pack.json"] }));
    }
    if (!hasNonEmptyArray(moduleInterface.publicSurfaces)) {
      errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `moduleInterfaces.${moduleInterface.responsibilityUnitId}.publicSurfaces must be a non-empty array.`, evidence: ["design-pack.json"] }));
    }
    for (const surface of moduleInterface.publicSurfaces ?? []) {
      const surfaceLabel = `${moduleInterface.responsibilityUnitId}.${surface?.name ?? "surface"}`;
      if (!hasText(surface?.name)) {
        errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `${surfaceLabel} requires a public surface name.`, evidence: ["design-pack.json"] }));
      }
      if (!hasText(surface?.kind)) {
        errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `${surfaceLabel} requires a public surface kind.`, evidence: ["design-pack.json"] }));
      }
      if (!hasNonEmptyArray(surface?.contractIds)) {
        errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `${surfaceLabel}.contractIds must be a non-empty array.`, evidence: ["design-pack.json"] }));
      }
      for (const contractId of surface?.contractIds ?? []) {
        if (!declaredContractIds.has(contractId)) {
          errors.push(createHarnessError({
            code: "HARNESS_CONTRACT_REFERENCE_INVALID",
            reason: `${surfaceLabel} references undeclared contract: ${contractId}`,
            contractId,
            ownerModule: moduleInterface.responsibilityUnitId,
            evidence: ["design-pack.json"]
          }));
        }
      }
      if (!surface?.signature || typeof surface.signature !== "object") {
        errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `${surfaceLabel} requires a signature object.`, evidence: ["design-pack.json"] }));
        continue;
      }
      for (const key of ["inputs", "outputs", "errors"]) {
        if (!hasNonEmptyArray(surface.signature[key])) {
          errors.push(createHarnessError({ code: "HARNESS_DESIGN_PACK_INVALID", reason: `${surfaceLabel}.signature.${key} must be a non-empty array.`, evidence: ["design-pack.json"] }));
        }
      }
    }
    for (const dependency of moduleInterface.imports ?? []) {
      if (dependency.contractId && !declaredContractIds.has(dependency.contractId)) {
        errors.push(createHarnessError({
          code: "HARNESS_CONTRACT_REFERENCE_INVALID",
          reason: `${moduleInterface.responsibilityUnitId} imports undeclared contract: ${dependency.contractId}`,
          contractId: dependency.contractId,
          ownerModule: moduleInterface.responsibilityUnitId,
          evidence: ["design-pack.json"]
        }));
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
