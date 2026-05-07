import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";

function plannedEvidencePath(workItem) {
  const planned = (workItem.doneEvidence ?? []).find((evidence) => evidence.kind === "openapi-conformance");
  return typeof planned?.path === "string" && planned.path.trim().length > 0 ? planned.path : null;
}

function resolveRunPath(runDir, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    return null;
  }
  const root = path.resolve(runDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function hasObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateSchema({ schema, value, pointer, errors, contractId, evidencePath }) {
  if (!schema || typeof schema !== "object") {
    return;
  }

  if (schema.type === "object") {
    if (!hasObject(value)) {
      errors.push(error({ contractId, evidencePath, reason: `${pointer} must be an object.` }));
      return;
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        errors.push(error({ contractId, evidencePath, reason: `${pointer}.${key} is required.` }));
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        validateSchema({ schema: propertySchema, value: value[key], pointer: `${pointer}.${key}`, errors, contractId, evidencePath });
      }
    }
    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(error({ contractId, evidencePath, reason: `${pointer} must be an array.` }));
      return;
    }
    for (const [index, item] of value.entries()) {
      validateSchema({ schema: schema.items, value: item, pointer: `${pointer}[${index}]`, errors, contractId, evidencePath });
    }
    return;
  }

  const expectedType = schema.type === "integer" ? "number" : schema.type;
  if (expectedType && typeof value !== expectedType) {
    errors.push(error({ contractId, evidencePath, reason: `${pointer} must be ${schema.type}.` }));
  }
}

function error({ contractId, evidencePath, reason }) {
  return createHarnessError({
    code: "HARNESS_OPENAPI_CONFORMANCE_FAILED",
    reason,
    contractId,
    evidence: [evidencePath],
    recoverable: true
  });
}

export async function validateOpenApiConformanceEvidence({ runDir, workItem }) {
  const relativePath = plannedEvidencePath(workItem);
  if (!relativePath) {
    return { ok: true, evidence: null, errors: [] };
  }

  const evidencePath = resolveRunPath(runDir, relativePath);
  if (!evidencePath) {
    return {
      ok: false,
      evidence: null,
      errors: [createHarnessError({
        code: "HARNESS_OPENAPI_CONFORMANCE_PATH_INVALID",
        reason: `OpenAPI conformance evidence path must stay inside the run directory: ${relativePath}`,
        evidence: ["work-items"],
        recoverable: true
      })]
    };
  }

  if (!await fileExists(evidencePath)) {
    return {
      ok: false,
      evidence: null,
      errors: [createHarnessError({
        code: "HARNESS_OPENAPI_CONFORMANCE_MISSING",
        reason: `OpenAPI conformance evidence is required: ${relativePath}`,
        evidence: [relativePath],
        recoverable: true
      })]
    };
  }

  const artifacts = await loadRunArtifacts(runDir);
  const specs = new Map();
  for (const spec of artifacts.designPack.apiSpecs.filter((candidate) =>
    candidate.kind === "openapi" && (workItem.contractIds ?? []).includes(candidate.contractId)
  )) {
    specs.set(spec.contractId, {
      spec,
      document: await readJsonFile(path.join(runDir, spec.path))
    });
  }

  const evidence = await readJsonFile(evidencePath);
  const errors = [];
  if (evidence.kind !== "openapi-conformance" || evidence.ok !== true || evidence.workItemId !== workItem.id || !Array.isArray(evidence.cases) || evidence.cases.length === 0) {
    errors.push(error({
      contractId: evidence.contractId ?? null,
      evidencePath: relativePath,
      reason: "OpenAPI conformance evidence must be passing evidence for the current work item."
    }));
  }

  for (const testCase of evidence.cases ?? []) {
    const contractId = testCase.contractId ?? evidence.contractId;
    const entry = specs.get(contractId);
    if (!entry) {
      errors.push(error({ contractId, evidencePath: relativePath, reason: `Unknown OpenAPI contract for work item: ${contractId ?? "(missing)"}.` }));
      continue;
    }

    const request = testCase.request ?? {};
    const response = testCase.response ?? {};
    const method = String(request.method ?? "").toLowerCase();
    const route = request.path;
    const operation = entry.document.paths?.[route]?.[method];
    if (!operation) {
      errors.push(error({ contractId, evidencePath: relativePath, reason: `OpenAPI operation is not declared: ${String(request.method ?? "").toUpperCase()} ${route ?? "(missing)"}.` }));
      continue;
    }

    const responseSpec = operation.responses?.[String(response.status)];
    if (!responseSpec) {
      errors.push(error({ contractId, evidencePath: relativePath, reason: `OpenAPI response is not declared: ${method.toUpperCase()} ${route} ${response.status}.` }));
      continue;
    }

    const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
    if (operation.requestBody?.required && requestSchema) {
      validateSchema({ schema: requestSchema, value: request.body, pointer: "request.body", errors, contractId, evidencePath: relativePath });
    }

    const responseSchema = responseSpec.content?.["application/json"]?.schema;
    if (responseSchema) {
      validateSchema({ schema: responseSchema, value: response.body, pointer: "response.body", errors, contractId, evidencePath: relativePath });
    }
  }

  return { ok: errors.length === 0, evidence, errors };
}
