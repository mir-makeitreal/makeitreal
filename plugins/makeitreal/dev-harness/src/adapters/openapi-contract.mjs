import path from "node:path";
import { validateDesignPack } from "../domain/design-pack.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";

function hasObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function methodsFor(pathItem) {
  return Object.keys(pathItem ?? {}).filter((key) =>
    ["get", "put", "post", "delete", "options", "head", "patch", "trace"].includes(key)
  );
}

function compareOpenApiBaseline({ baseline, current, contractId, evidencePath }) {
  const errors = [];
  for (const [routePath, baselinePathItem] of Object.entries(baseline.paths ?? {})) {
    if (!current.paths?.[routePath]) {
      errors.push(createHarnessError({
        code: "HARNESS_OPENAPI_PATH_REMOVED",
        reason: `OpenAPI path was removed: ${routePath}.`,
        contractId,
        evidence: [evidencePath]
      }));
      continue;
    }

    for (const method of methodsFor(baselinePathItem)) {
      if (!current.paths[routePath][method]) {
        errors.push(createHarnessError({
          code: "HARNESS_OPENAPI_OPERATION_REMOVED",
          reason: `OpenAPI operation was removed: ${method.toUpperCase()} ${routePath}.`,
          contractId,
          evidence: [evidencePath]
        }));
        continue;
      }

      const baselineResponses = baselinePathItem[method].responses ?? {};
      const currentResponses = current.paths[routePath][method].responses ?? {};
      for (const statusCode of Object.keys(baselineResponses)) {
        if (!Object.prototype.hasOwnProperty.call(currentResponses, statusCode)) {
          errors.push(createHarnessError({
            code: "HARNESS_OPENAPI_RESPONSE_REMOVED",
            reason: `OpenAPI response was removed: ${method.toUpperCase()} ${routePath} ${statusCode}.`,
            contractId,
            evidence: [evidencePath]
          }));
        }
      }
    }
  }
  return errors;
}

export async function validateOpenApiContracts({ runDir, baselineDir }) {
  const artifacts = await loadRunArtifacts(runDir);
  const errors = [];
  const design = validateDesignPack(artifacts.designPack);
  errors.push(...design.errors);

  for (const spec of artifacts.designPack.apiSpecs.filter((candidate) => candidate.kind === "openapi")) {
    const specPath = path.join(runDir, spec.path);
    if (!await fileExists(specPath)) {
      errors.push(createHarnessError({
        code: "HARNESS_OPENAPI_SPEC_MISSING",
        reason: `OpenAPI contract file is missing: ${spec.path}.`,
        contractId: spec.contractId,
        evidence: [spec.path]
      }));
      continue;
    }

    const document = await readJsonFile(specPath);
    if (typeof document.openapi !== "string" || !document.openapi.startsWith("3.")) {
      errors.push(createHarnessError({
        code: "HARNESS_OPENAPI_VERSION_INVALID",
        reason: `OpenAPI contract must declare a 3.x openapi version: ${spec.path}.`,
        contractId: spec.contractId,
        evidence: [spec.path]
      }));
    }
    if (!hasObject(document.info) || !hasObject(document.paths)) {
      errors.push(createHarnessError({
        code: "HARNESS_OPENAPI_SHAPE_INVALID",
        reason: `OpenAPI contract must contain info and paths objects: ${spec.path}.`,
        contractId: spec.contractId,
        evidence: [spec.path]
      }));
    }

    if (baselineDir) {
      const baselinePath = path.join(baselineDir, spec.path);
      if (!await fileExists(baselinePath)) {
        errors.push(createHarnessError({
          code: "HARNESS_OPENAPI_BASELINE_MISSING",
          reason: `OpenAPI baseline is missing: ${spec.path}.`,
          contractId: spec.contractId,
          evidence: [baselinePath]
        }));
      } else {
        const baseline = await readJsonFile(baselinePath);
        errors.push(...compareOpenApiBaseline({
          baseline,
          current: document,
          contractId: spec.contractId,
          evidencePath: spec.path
        }));
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
