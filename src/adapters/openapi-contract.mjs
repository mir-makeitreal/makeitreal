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

function contractError({ code, reason, contractId, evidencePath }) {
  return createHarnessError({
    code,
    reason,
    contractId,
    evidence: [evidencePath],
    recoverable: true
  });
}

function jsonSchemaObject(container) {
  return container?.content?.["application/json"]?.schema;
}

function resolveSchemaRef({ schema, document }) {
  if (!schema || typeof schema !== "object" || typeof schema.$ref !== "string") {
    return schema;
  }
  const prefix = "#/components/schemas/";
  if (!schema.$ref.startsWith(prefix)) {
    return schema;
  }
  return document.components?.schemas?.[schema.$ref.slice(prefix.length)] ?? schema;
}

function schemaExampleErrors({ schema, value, pointer, document, contractId, evidencePath }) {
  schema = resolveSchemaRef({ schema, document });
  if (!schema || typeof schema !== "object") {
    return [];
  }
  const errors = [];
  if (schema.type === "object") {
    if (!hasObject(value)) {
      return [contractError({
        code: "HARNESS_OPENAPI_EXAMPLE_INVALID",
        reason: `OpenAPI example ${pointer} must be an object.`,
        contractId,
        evidencePath
      })];
    }
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        errors.push(contractError({
          code: "HARNESS_OPENAPI_EXAMPLE_INVALID",
          reason: `OpenAPI example ${pointer}.${key} is required by its schema.`,
          contractId,
          evidencePath
        }));
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        errors.push(...schemaExampleErrors({
          schema: propertySchema,
          value: value[key],
          pointer: `${pointer}.${key}`,
          document,
          contractId,
          evidencePath
        }));
      }
    }
    return errors;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return [contractError({
        code: "HARNESS_OPENAPI_EXAMPLE_INVALID",
        reason: `OpenAPI example ${pointer} must be an array.`,
        contractId,
        evidencePath
      })];
    }
    for (const [index, item] of value.entries()) {
      errors.push(...schemaExampleErrors({
        schema: schema.items,
        value: item,
        pointer: `${pointer}[${index}]`,
        document,
        contractId,
        evidencePath
      }));
    }
    return errors;
  }
  const expectedType = schema.type === "integer" ? "number" : schema.type;
  if (expectedType && typeof value !== expectedType) {
    errors.push(contractError({
      code: "HARNESS_OPENAPI_EXAMPLE_INVALID",
      reason: `OpenAPI example ${pointer} must be ${schema.type}.`,
      contractId,
      evidencePath
    }));
  }
  return errors;
}

function exampleValues(container) {
  const json = container?.content?.["application/json"];
  return Object.values(json?.examples ?? {})
    .map((example) => example?.value)
    .filter((value) => value !== undefined);
}

function validateImplementationGradeOperation({ operation, method, routePath, contractId, evidencePath, document }) {
  const errors = [];
  const requestBodyRequired = !["get", "delete", "head"].includes(method);
  if (!operation.operationId || typeof operation.operationId !== "string") {
    errors.push(contractError({
      code: "HARNESS_OPENAPI_OPERATION_ID_MISSING",
      reason: `OpenAPI operation must declare operationId: ${method.toUpperCase()} ${routePath}.`,
      contractId,
      evidencePath
    }));
  }

  const requestSchema = jsonSchemaObject(operation.requestBody);
  if (requestBodyRequired && (operation.requestBody?.required !== true || !requestSchema)) {
    errors.push(contractError({
      code: "HARNESS_OPENAPI_REQUEST_SCHEMA_MISSING",
      reason: `OpenAPI operation must declare a required application/json request schema: ${method.toUpperCase()} ${routePath}.`,
      contractId,
      evidencePath
    }));
  }
  for (const value of exampleValues(operation.requestBody)) {
    errors.push(...schemaExampleErrors({
      schema: requestSchema,
      value,
      pointer: `${method.toUpperCase()} ${routePath} request example`,
      document,
      contractId,
      evidencePath
    }));
  }

  const responses = operation.responses ?? {};
  const success = responses["200"] ?? responses["201"] ?? responses["204"];
  if (!success) {
    errors.push(contractError({
      code: "HARNESS_OPENAPI_SUCCESS_RESPONSE_MISSING",
      reason: `OpenAPI operation must declare a success response: ${method.toUpperCase()} ${routePath}.`,
      contractId,
      evidencePath
    }));
  } else if (String(Object.keys(responses).find((status) => responses[status] === success)) !== "204" && !jsonSchemaObject(success)) {
    errors.push(contractError({
      code: "HARNESS_OPENAPI_RESPONSE_SCHEMA_MISSING",
      reason: `OpenAPI success response must declare an application/json schema: ${method.toUpperCase()} ${routePath}.`,
      contractId,
      evidencePath
    }));
  }
  for (const [status, response] of Object.entries(responses)) {
    const responseSchema = jsonSchemaObject(response);
    if (!responseSchema) {
      continue;
    }
    for (const value of exampleValues(response)) {
      errors.push(...schemaExampleErrors({
        schema: responseSchema,
        value,
        pointer: `${method.toUpperCase()} ${routePath} ${status} response example`,
        document,
        contractId,
        evidencePath
      }));
    }
  }

  if (!Object.keys(responses).some((status) => /^[45]\d\d$/.test(status))) {
    errors.push(contractError({
      code: "HARNESS_OPENAPI_ERROR_RESPONSE_MISSING",
      reason: `OpenAPI operation must declare at least one 4xx or 5xx error response: ${method.toUpperCase()} ${routePath}.`,
      contractId,
      evidencePath
    }));
  }
  return errors;
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

    for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
      const methods = methodsFor(pathItem);
      if (methods.length === 0) {
        errors.push(contractError({
          code: "HARNESS_OPENAPI_OPERATION_MISSING",
          reason: `OpenAPI path must declare at least one operation: ${routePath}.`,
          contractId: spec.contractId,
          evidencePath: spec.path
        }));
      }
      for (const method of methods) {
        errors.push(...validateImplementationGradeOperation({
          operation: pathItem[method],
          method,
          routePath,
          contractId: spec.contractId,
          evidencePath: spec.path,
          document
        }));
      }
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
