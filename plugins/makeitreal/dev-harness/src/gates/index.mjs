import path from "node:path";
import { validateOpenApiConformanceEvidence } from "../adapters/openapi-conformance.mjs";
import { validateOpenApiContracts } from "../adapters/openapi-contract.mjs";
import { validateModuleSurfaceConformance } from "../adapters/module-surface-conformance.mjs";
import { validateDesignPack } from "../domain/design-pack.mjs";
import { readVerificationEvidence, readWikiSyncEvidence } from "../domain/evidence.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern, reservedControlPlanePath } from "../domain/path-policy.mjs";
import { validatePrd, validateWorkItemPrdTrace } from "../domain/prd.mjs";
import { normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { requiredDagNodeIds, validateWorkItemDag } from "../domain/work-item-dag.mjs";
import { fileExists } from "../io/json.mjs";
import { validateBlueprintApproval } from "../blueprint/review.mjs";
import { resolveProjectRootForRun } from "../orchestrator/workspace-manager.mjs";

function hasSingleOwner(artifacts, responsibilityUnitId) {
  return artifacts.responsibilityUnits.units.filter((unit) => unit.id === responsibilityUnitId && unit.owner).length === 1;
}

function hasAllContracts(artifacts, workItem) {
  const designContractIds = new Set(artifacts.designPack.apiSpecs.map((spec) => spec.contractId).filter(Boolean));
  return (workItem.contractIds ?? []).every((contractId) => designContractIds.has(contractId));
}

function hasVerificationPlan(workItem) {
  return Array.isArray(workItem.verificationCommands) && workItem.verificationCommands.length > 0;
}

function verificationExemptionReason(workItem) {
  const reason = workItem?.verificationExempt?.reason;
  return typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
}

function nodeKindForWorkItem(artifacts, workItem) {
  return artifacts.workItemDag.nodes?.find((node) => node.id === workItem.id)?.kind ?? null;
}

function moduleInterfacesForWorkItem(artifacts, workItem) {
  return artifacts.designPack.moduleInterfaces.filter((moduleInterface) => moduleInterface.responsibilityUnitId === workItem.responsibilityUnitId);
}

function isApiResponsibilityUnit(workItem) {
  return workItem.isApiUnit === true;
}

function openApiContractIds(artifacts) {
  return new Set(artifacts.designPack.apiSpecs
    .filter((spec) => spec.kind === "openapi")
    .map((spec) => spec.contractId)
    .filter(Boolean));
}

function publicSurfaceContractIds(moduleInterfaces) {
  return new Set(moduleInterfaces
    .flatMap((moduleInterface) => moduleInterface.publicSurfaces ?? [])
    .flatMap((surface) => surface.contractIds ?? [])
    .filter(Boolean));
}

function hasDoneEvidencePlan(workItem) {
  return (workItem.doneEvidence ?? []).length > 0;
}

function hasDoneEvidenceKind(workItem, kind) {
  return (workItem.doneEvidence ?? []).some((evidence) => evidence.kind === kind);
}

function workItemsForRequiredNodes({ dag, workItems }) {
  const workItemsById = new Map((workItems ?? []).map((workItem) => [workItem.id, workItem]));
  return requiredDagNodeIds(dag)
    .map((id) => workItemsById.get(id))
    .filter(Boolean);
}

function validateOneReadyWorkItem({ artifacts, workItem, errors }) {
  const nodeKind = nodeKindForWorkItem(artifacts, workItem);
  if (nodeKind === null) {
    errors.push(createHarnessError({
      code: "HARNESS_NODE_KIND_MISSING",
      reason: `Work item has no node kind declared in the work item DAG: ${workItem.id}.`,
      ownerModule: workItem.responsibilityUnitId,
      evidence: ["work-item-dag.json", "work-items"]
    }));
  }
  const workItemModuleInterfaces = moduleInterfacesForWorkItem(artifacts, workItem);
  const workItemSurfaceContractIds = publicSurfaceContractIds(workItemModuleInterfaces);
  const apiContractIds = openApiContractIds(artifacts);
  const traceResult = validateWorkItemPrdTrace({ prd: artifacts.prd, workItem });
  errors.push(...traceResult.errors);

  if (!hasSingleOwner(artifacts, workItem.responsibilityUnitId)) {
    errors.push(createHarnessError({ code: "HARNESS_RESPONSIBILITY_OWNER_INVALID", reason: `Work item requires exactly one owner: ${workItem.responsibilityUnitId}`, ownerModule: workItem.responsibilityUnitId, evidence: ["responsibility-units.json"] }));
  }

  if (!hasAllContracts(artifacts, workItem)) {
    errors.push(createHarnessError({ code: "HARNESS_CONTRACT_MISSING", reason: "Work item references a contract not declared in the design pack.", ownerModule: workItem.responsibilityUnitId, evidence: ["work-items", "design-pack.json"] }));
  }

  if (!Array.isArray(workItem.dependsOn)) {
    errors.push(createHarnessError({ code: "HARNESS_WORK_ITEM_DEPENDENCIES_INVALID", reason: `Work item must declare dependsOn array: ${workItem.id}`, ownerModule: workItem.responsibilityUnitId, evidence: ["work-items"] }));
  }

  const verificationExempt = nodeKind === "domain-pm" && Boolean(verificationExemptionReason(workItem));
  if (!hasVerificationPlan(workItem) && !verificationExempt) {
    errors.push(createHarnessError({
      code: "HARNESS_VERIFICATION_PLAN_MISSING",
      reason: `Ready requires at least one declared verification command: ${workItem.id}. Add a command such as {"file":"npm","args":["test"]} with plan --verify or revise the work item before launch.`,
      ownerModule: workItem.responsibilityUnitId,
      evidence: ["work-items"],
      recoverable: true,
      nextAction: "/makeitreal:plan <request> --verify '{\"file\":\"npm\",\"args\":[\"test\"]}'"
    }));
  }

  for (const command of workItem.verificationCommands ?? []) {
    const normalized = normalizeVerificationCommand(command);
    if (!normalized.ok) {
      errors.push(createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_INVALID",
        reason: normalized.reason,
        ownerModule: workItem.responsibilityUnitId,
        evidence: ["work-items"],
        recoverable: true,
        nextAction: "/makeitreal:plan <request> --verify '{\"file\":\"npm\",\"args\":[\"test\"]}'"
      }));
    }
  }

  if (!hasDoneEvidencePlan(workItem)) {
    errors.push(createHarnessError({ code: "HARNESS_DONE_EVIDENCE_PLAN_MISSING", reason: `Ready requires at least one declared Done evidence entry: ${workItem.id}`, ownerModule: workItem.responsibilityUnitId, evidence: ["work-items"] }));
  }

  if (nodeKind === "implementation" && workItemModuleInterfaces.length === 0) {
    errors.push(createHarnessError({
      code: "HARNESS_MODULE_INTERFACE_MISSING",
      reason: `Implementation work item must freeze a public module interface before launch: ${workItem.id}.`,
      ownerModule: workItem.responsibilityUnitId,
      evidence: ["design-pack.json", "work-items"],
      recoverable: true
    }));
  }

  const workItemContractIds = workItem.contractIds ?? [];
  if (nodeKind === "implementation" && workItemSurfaceContractIds.size > 0 && !workItemContractIds.some((contractId) => workItemSurfaceContractIds.has(contractId))) {
    errors.push(createHarnessError({
      code: "HARNESS_MODULE_CONTRACT_MISSING",
      reason: `Implementation work item must bind one of its declared public surface contracts before launch: ${workItem.id}.`,
      ownerModule: workItem.responsibilityUnitId,
      evidence: ["design-pack.json", "work-items"],
      recoverable: true
    }));
  }

  const requiresOpenApiContract = nodeKind === "implementation" && isApiResponsibilityUnit(workItem);
  const workItemOpenApiContracts = (workItem.contractIds ?? []).filter((contractId) => apiContractIds.has(contractId));
  if (requiresOpenApiContract && workItemOpenApiContracts.length === 0) {
    errors.push(createHarnessError({
      code: "HARNESS_API_CONTRACT_MISSING",
      reason: `API work item must bind an OpenAPI contract before launch: ${workItem.id}.`,
      ownerModule: workItem.responsibilityUnitId,
      evidence: ["design-pack.json", "work-items"],
      recoverable: true
    }));
  }
  if (requiresOpenApiContract && !hasDoneEvidenceKind(workItem, "openapi-conformance")) {
    errors.push(createHarnessError({
      code: "HARNESS_API_CONFORMANCE_EVIDENCE_MISSING",
      reason: `API work item must plan OpenAPI conformance evidence before launch: ${workItem.id}.`,
      ownerModule: workItem.responsibilityUnitId,
      evidence: ["work-items"],
      recoverable: true
    }));
  }

  const requiresAllowedPaths = nodeKind === "implementation";
  if (requiresAllowedPaths && (!Array.isArray(workItem.allowedPaths) || workItem.allowedPaths.length === 0)) {
    errors.push(createHarnessError({
      code: "HARNESS_ALLOWED_PATH_INVALID",
      reason: `Work item must declare at least one safe allowed path: ${workItem.id}`,
      ownerModule: workItem.responsibilityUnitId,
      evidence: ["work-items"]
    }));
  }

  for (const pattern of workItem.allowedPaths ?? []) {
    if (reservedControlPlanePath(pattern)) {
      errors.push(createHarnessError({ code: "HARNESS_ALLOWED_PATH_RESERVED", reason: `Allowed paths cannot target harness control-plane paths: ${pattern}`, ownerModule: workItem.responsibilityUnitId, evidence: ["work-items"] }));
    } else if (invalidAllowedPathPattern(pattern)) {
      errors.push(createHarnessError({ code: "HARNESS_ALLOWED_PATH_INVALID", reason: `Allowed path must be a safe project-relative pattern: ${pattern}`, ownerModule: workItem.responsibilityUnitId, evidence: ["work-items"] }));
    }
  }
}

export async function runGates({ runDir, target }) {
  const artifacts = await loadRunArtifacts(runDir);
  const errors = [];
  const workItems = artifacts.workItems;
  const requiredWorkItems = workItemsForRequiredNodes({ dag: artifacts.workItemDag, workItems });

  if (target === "Ready" || target === "Done") {
    const prdResult = validatePrd(artifacts.prd);
    errors.push(...prdResult.errors);

    const designResult = validateDesignPack(artifacts.designPack);
    errors.push(...designResult.errors);

    const dagResult = validateWorkItemDag({
      dag: artifacts.workItemDag,
      workItems,
      responsibilityUnits: artifacts.responsibilityUnits
    });
    errors.push(...dagResult.errors);

    const openApiContracts = await validateOpenApiContracts({ runDir });
    errors.push(...openApiContracts.errors);

    if (artifacts.designPack.prdId !== artifacts.prd.id) {
      errors.push(createHarnessError({
        code: "HARNESS_PRD_DESIGN_DRIFT",
        reason: `Design pack PRD binding ${artifacts.designPack.prdId ?? "(missing)"} does not match ${artifacts.prd.id}.`,
        evidence: ["prd.json", "design-pack.json"]
      }));
    }

    if (artifacts.designPack.workItemId && !workItems.some((workItem) => workItem.id === artifacts.designPack.workItemId)) {
      errors.push(createHarnessError({
        code: "HARNESS_WORK_ITEM_DESIGN_DRIFT",
        reason: `Design pack display work item binding ${artifacts.designPack.workItemId} has no matching work item.`,
        evidence: ["design-pack.json", "work-items"]
      }));
    }

    if (!await fileExists(path.join(runDir, "preview", "index.html"))) {
      errors.push(createHarnessError({ code: "HARNESS_PREVIEW_MISSING", reason: "Ready requires preview/index.html.", evidence: ["preview/index.html"] }));
    }

    for (const workItem of requiredWorkItems) {
      validateOneReadyWorkItem({ artifacts, workItem, errors });
    }

    const blueprintApproval = await validateBlueprintApproval({ runDir });
    errors.push(...blueprintApproval.errors);
  }

  if (target === "Done") {
    const projectRoot = resolveProjectRootForRun({ runDir });
    for (const workItem of requiredWorkItems) {
      const verification = await readVerificationEvidence(runDir, { workItem });
      errors.push(...verification.errors);

      const wikiSync = await readWikiSyncEvidence(runDir, { workItem });
      errors.push(...wikiSync.errors);

      const openApiConformance = await validateOpenApiConformanceEvidence({ runDir, workItem });
      errors.push(...openApiConformance.errors);

      const moduleSurfaceConformance = await validateModuleSurfaceConformance({ runDir, projectRoot, workItem });
      errors.push(...moduleSurfaceConformance.errors);
    }
  }

  return { ok: errors.length === 0, command: "gate", target, errors };
}
