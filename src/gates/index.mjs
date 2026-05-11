import path from "node:path";
import { validateOpenApiConformanceEvidence } from "../adapters/openapi-conformance.mjs";
import { validateOpenApiContracts } from "../adapters/openapi-contract.mjs";
import { validateDesignPack } from "../domain/design-pack.mjs";
import { readVerificationEvidence, readWikiSyncEvidence } from "../domain/evidence.mjs";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern, reservedControlPlanePath } from "../domain/path-policy.mjs";
import { validatePrd, validateWorkItemPrdTrace } from "../domain/prd.mjs";
import { normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { fileExists } from "../io/json.mjs";
import { validateBlueprintApproval } from "../blueprint/review.mjs";

function hasSingleOwner(artifacts, responsibilityUnitId) {
  return artifacts.responsibilityUnits.units.filter((unit) => unit.id === responsibilityUnitId && unit.owner).length === 1;
}

function hasAllContracts(artifacts, workItem) {
  const designContractIds = new Set(artifacts.designPack.apiSpecs.map((spec) => spec.contractId).filter(Boolean));
  return workItem.contractIds.every((contractId) => designContractIds.has(contractId));
}

function hasVerificationPlan(workItem) {
  return Array.isArray(workItem.verificationCommands) && workItem.verificationCommands.length > 0;
}

function hasDoneEvidencePlan(workItem) {
  const kinds = new Set((workItem.doneEvidence ?? []).map((evidence) => evidence.kind));
  return kinds.has("verification") && kinds.has("wiki-sync");
}

export async function runGates({ runDir, target }) {
  const artifacts = await loadRunArtifacts(runDir);
  const workItem = findPrimaryWorkItem(artifacts);
  const errors = [];

  if (target === "Ready" || target === "Done") {
    const prdResult = validatePrd(artifacts.prd);
    errors.push(...prdResult.errors);

    const traceResult = validateWorkItemPrdTrace({ prd: artifacts.prd, workItem });
    errors.push(...traceResult.errors);

    const designResult = validateDesignPack(artifacts.designPack);
    errors.push(...designResult.errors);

    const openApiContracts = await validateOpenApiContracts({ runDir });
    errors.push(...openApiContracts.errors);

    if (artifacts.designPack.prdId !== artifacts.prd.id) {
      errors.push(createHarnessError({
        code: "HARNESS_PRD_DESIGN_DRIFT",
        reason: `Design pack PRD binding ${artifacts.designPack.prdId ?? "(missing)"} does not match ${artifacts.prd.id}.`,
        evidence: ["prd.json", "design-pack.json"]
      }));
    }

    if (artifacts.designPack.workItemId !== workItem.id) {
      errors.push(createHarnessError({
        code: "HARNESS_WORK_ITEM_DESIGN_DRIFT",
        reason: `Design pack work item binding ${artifacts.designPack.workItemId ?? "(missing)"} does not match ${workItem.id}.`,
        ownerModule: workItem.responsibilityUnitId,
        evidence: ["design-pack.json", "work-items"]
      }));
    }

    if (!await fileExists(path.join(runDir, "preview", "index.html"))) {
      errors.push(createHarnessError({ code: "HARNESS_PREVIEW_MISSING", reason: "Ready requires preview/index.html.", evidence: ["preview/index.html"] }));
    }

    if (!hasSingleOwner(artifacts, workItem.responsibilityUnitId)) {
      errors.push(createHarnessError({ code: "HARNESS_RESPONSIBILITY_OWNER_INVALID", reason: `Work item requires exactly one owner: ${workItem.responsibilityUnitId}`, ownerModule: workItem.responsibilityUnitId, evidence: ["responsibility-units.json"] }));
    }

    if (!hasAllContracts(artifacts, workItem)) {
      errors.push(createHarnessError({ code: "HARNESS_CONTRACT_MISSING", reason: "Work item references a contract not declared in the design pack.", ownerModule: workItem.responsibilityUnitId, evidence: ["work-items", "design-pack.json"] }));
    }

    if (!Array.isArray(workItem.dependsOn)) {
      errors.push(createHarnessError({ code: "HARNESS_WORK_ITEM_DEPENDENCIES_INVALID", reason: `Work item must declare dependsOn array: ${workItem.id}`, ownerModule: workItem.responsibilityUnitId, evidence: ["work-items"] }));
    }

    if (!hasVerificationPlan(workItem)) {
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
      errors.push(createHarnessError({ code: "HARNESS_DONE_EVIDENCE_PLAN_MISSING", reason: `Ready requires planned verification and wiki-sync Done evidence: ${workItem.id}`, ownerModule: workItem.responsibilityUnitId, evidence: ["work-items"] }));
    }

    if (!Array.isArray(workItem.allowedPaths) || workItem.allowedPaths.length === 0) {
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

    const blueprintApproval = await validateBlueprintApproval({ runDir });
    errors.push(...blueprintApproval.errors);
  }

  if (target === "Done") {
    const verification = await readVerificationEvidence(runDir, { workItem });
    errors.push(...verification.errors);

    const wikiSync = await readWikiSyncEvidence(runDir, { workItem });
    errors.push(...wikiSync.errors);

    const openApiConformance = await validateOpenApiConformanceEvidence({ runDir, workItem });
    errors.push(...openApiConformance.errors);
  }

  return { ok: errors.length === 0, command: "gate", target, errors };
}
