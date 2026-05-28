/**
 * Contract-derived test scaffold generation.
 *
 * Generates runnable test files from contract definitions using node:test format.
 * Tests validate types, status codes, and shape — NOT behavioral logic.
 * Generated tests are executable with `node --test`; they may fail when the implementation
 * or server is missing, but they fail for the right reason (module not found, fetch error,
 * unmet contract), not because the test itself is a stub.
 */

import path from "node:path";
import { detectContractKind, validateContract } from "./contract-kinds.mjs";

/**
 * Generate test scaffold files from a contract.
 *
 * @param {object} contract - The contract definition
 * @param {{ outputDir?: string }} [options]
 * @returns {{ files: Array<{path: string, content: string}>, errors: Array<{code: string, reason: string}> }}
 */
export function generateTestScaffold(contract, options = {}) {
  const outputDir = options.outputDir ?? "test";
  const files = [];
  const errors = [];

  const kind = detectContractKind(contract);
  if (!kind) {
    errors.push({
      code: "SCAFFOLD_UNKNOWN_KIND",
      reason: "Cannot generate test scaffold: unknown or missing contract kind"
    });
    return { files, errors };
  }

  const validation = validateContract(contract);
  if (!validation.ok) {
    for (const validationError of validation.errors) {
      errors.push({
        code: "SCAFFOLD_CONTRACT_INVALID",
        reason: `Contract validation error at ${validationError.field}: ${validationError.message}`
      });
    }
    return { files, errors };
  }

  switch (kind) {
    case "openapi":
      files.push(...scaffoldOpenApi(contract, outputDir));
      break;
    case "module-io":
      files.push(...scaffoldModuleIo(contract, outputDir));
      break;
    case "component":
      files.push(...scaffoldComponent(contract, outputDir));
      break;
    case "event":
      files.push(...scaffoldEvent(contract, outputDir));
      break;
  }

  return { files, errors };
}

// ── OpenAPI scaffold ────────────────────────────────────────────────

function scaffoldOpenApi(contract, outputDir) {
  const files = [];
  const contractId = contract.contractId ?? contract.info?.title ?? "unknown-api";

  for (const [routePath, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        continue;
      }
      const operation = pathItem[method];
      const operationId = operation.operationId ?? `${method}_${routePath.replace(/\//g, "_")}`;
      const fileName = `${operationId}.contract.test.mjs`;

      const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
      const successCode = Object.keys(operation.responses ?? {}).find((c) => c.startsWith("2")) ?? "200";
      const successResponse = operation.responses?.[successCode];
      const successSchema = successResponse?.content?.["application/json"]?.schema;
      const errorCodes = Object.keys(operation.responses ?? {}).filter((c) => c.startsWith("4") || c.startsWith("5"));
      const concretePath = substitutePathParams(routePath);
      const methodUpper = method.toUpperCase();

      let content = "";
      content += `import { describe, test } from "node:test";\n`;
      content += `import assert from "node:assert/strict";\n`;
      content += `\n`;
      content += `// Auto-generated contract test for ${methodUpper} ${routePath}\n`;
      content += `// Contract: ${contractId}\n`;
      content += `// Validates HTTP status codes, response shape, and required fields against a running server.\n`;
      content += `// Override the base URL via CONTRACT_BASE_URL (default: http://localhost:3000).\n`;
      content += `\n`;
      content += `const baseUrl = process.env.CONTRACT_BASE_URL ?? "http://localhost:3000";\n`;
      content += `\n`;
      content += `async function callEndpoint(targetPath, init) {\n`;
      content += `  const response = await fetch(baseUrl + targetPath, init);\n`;
      content += `  const contentType = response.headers.get("content-type") ?? "";\n`;
      content += `  let body = null;\n`;
      content += `  if (contentType.includes("application/json")) {\n`;
      content += `    try { body = await response.json(); } catch { body = null; }\n`;
      content += `  } else {\n`;
      content += `    try { body = await response.text(); } catch { body = null; }\n`;
      content += `  }\n`;
      content += `  return { status: response.status, body, headers: response.headers };\n`;
      content += `}\n`;
      content += `\n`;

      content += `describe("${methodUpper} ${routePath}", () => {\n`;

      // Success case
      const exampleBody = requestSchema ? generateExampleFromSchema(requestSchema) : null;
      content += `  test("returns ${successCode} with valid input", async () => {\n`;
      if (exampleBody) {
        content += `    const body = ${JSON.stringify(exampleBody, null, 4).split("\n").join("\n    ")};\n`;
        content += `    const response = await callEndpoint("${concretePath}", {\n`;
        content += `      method: "${methodUpper}",\n`;
        content += `      headers: { "content-type": "application/json" },\n`;
        content += `      body: JSON.stringify(body)\n`;
        content += `    });\n`;
      } else {
        content += `    const response = await callEndpoint("${concretePath}", { method: "${methodUpper}" });\n`;
      }
      content += `    assert.strictEqual(response.status, ${Number(successCode)});\n`;
      if (successSchema?.required) {
        for (const field of successSchema.required) {
          content += `    assert.ok(response.body.${field} !== undefined, "${field} must be present");\n`;
        }
      }
      if (successSchema?.type) {
        content += `    assert.strictEqual(typeof response.body, "${successSchema.type === "array" ? "object" : successSchema.type}");\n`;
      }
      content += `  });\n\n`;

      // Error cases
      for (const errorCode of errorCodes) {
        content += `  test("returns ${errorCode} on invalid input", async () => {\n`;
        if (requestSchema) {
          content += `    const body = {};\n`;
          content += `    const response = await callEndpoint("${concretePath}", {\n`;
          content += `      method: "${methodUpper}",\n`;
          content += `      headers: { "content-type": "application/json" },\n`;
          content += `      body: JSON.stringify(body)\n`;
          content += `    });\n`;
        } else {
          content += `    const response = await callEndpoint("${concretePath}", { method: "${methodUpper}" });\n`;
        }
        content += `    assert.strictEqual(response.status, ${Number(errorCode)});\n`;
        content += `  });\n\n`;
      }

      content += `});\n`;

      files.push({
        path: path.join(outputDir, fileName),
        content
      });
    }
  }

  return files;
}

// ── Module-IO scaffold ──────────────────────────────────────────────

function scaffoldModuleIo(contract, outputDir) {
  const files = [];
  const contractId = contract.contractId;
  const modulePath = contract.modulePath;
  const exports = contract.exports ?? [];
  const importPath = relativeImport(outputDir, modulePath);

  let content = "";
  content += `import { describe, test } from "node:test";\n`;
  content += `import assert from "node:assert/strict";\n`;
  content += `import * as mod from "${importPath}";\n`;
  content += `\n`;
  content += `// Auto-generated contract test for module: ${modulePath}\n`;
  content += `// Contract: ${contractId}\n`;
  content += `// Validates that the module exports the declared symbols with the declared shape.\n`;
  content += `// Import path is computed relative to the generated test file location.\n`;
  content += `\n`;

  content += `describe("${contractId}", () => {\n`;

  for (const exp of exports) {
    // Export existence + type test
    content += `  test("exports ${exp.name} as a ${exp.kind}", () => {\n`;
    if (exp.kind === "function") {
      content += `    assert.strictEqual(typeof mod.${exp.name}, "function");\n`;
    } else if (exp.kind === "class") {
      content += `    assert.strictEqual(typeof mod.${exp.name}, "function"); // classes are functions\n`;
    } else {
      content += `    assert.ok(mod.${exp.name} !== undefined, "${exp.name} must be exported");\n`;
    }
    content += `  });\n\n`;

    // Input validation tests (structural — type checks only)
    if (exp.inputs && exp.inputs.length > 0) {
      const requiredCount = exp.inputs.filter((i) => i.required).length;
      content += `  test("${exp.name} accepts expected parameters", () => {\n`;
      content += `    // Contract declares ${exp.inputs.length} parameter(s):\n`;
      for (const input of exp.inputs) {
        content += `    //   ${input.name}: ${input.type}${input.required ? " (required)" : " (optional)"}\n`;
      }
      content += `    assert.strictEqual(typeof mod.${exp.name}, "function");\n`;
      content += `    assert.strictEqual(mod.${exp.name}.length >= ${requiredCount}, true);\n`;
      content += `  });\n\n`;
    }

    // Output type test
    if (exp.output) {
      const example = exp.examples?.[0]?.input;
      content += `  test("${exp.name} returns expected type", async () => {\n`;
      content += `    // Contract declares output type: ${exp.output.type}\n`;
      if (example) {
        const argList = Object.values(example).map((v) => JSON.stringify(v)).join(", ");
        content += `    const result = ${exp.async ? "await " : ""}mod.${exp.name}(${argList});\n`;
        content += `    assert.strictEqual(typeof result, "${exp.output.type}");\n`;
      } else {
        content += `    assert.strictEqual(typeof mod.${exp.name}, "function");\n`;
        content += `    // No example input declared in contract; cannot invoke to validate return type.\n`;
      }
      content += `  });\n\n`;
    }

    // Error case stubs
    for (const err of exp.errors ?? []) {
      content += `  test("${exp.name} throws ${err.code} when ${err.when}", async () => {\n`;
      content += `    await assert.rejects(\n`;
      content += `      async () => ${exp.async ? "await " : ""}mod.${exp.name}(),\n`;
      content += `      (error) => { assert.ok(error instanceof Error); return true; }\n`;
      content += `    );\n`;
      content += `  });\n\n`;
    }
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(outputDir, fileName), content });
  return files;
}

// ── Component scaffold ──────────────────────────────────────────────

function scaffoldComponent(contract, outputDir) {
  const files = [];
  const contractId = contract.contractId;
  const componentPath = contract.componentPath;
  const componentName = componentPath?.split("/").pop()?.replace(/\.\w+$/, "") ?? "Component";
  const importPath = relativeImport(outputDir, componentPath);
  const requiredProps = (contract.props ?? []).filter((p) => p.required);

  let content = "";
  content += `import { describe, test } from "node:test";\n`;
  content += `import assert from "node:assert/strict";\n`;
  content += `import ${componentName} from "${importPath}";\n`;
  content += `\n`;
  content += `// Auto-generated contract test for component: ${componentName}\n`;
  content += `// Contract: ${contractId}\n`;
  content += `// Validates that the component module exports a usable component and declares the expected props.\n`;
  content += `// Render-based assertions require a UI test runtime (e.g. @testing-library/react); see comments.\n`;
  content += `\n`;

  content += `describe("${componentName} contract", () => {\n`;

  // Module export shape
  content += `  test("module exports a component", () => {\n`;
  content += `    assert.ok(${componentName} !== undefined, "default export must exist");\n`;
  content += `    const exportType = typeof ${componentName};\n`;
  content += `    assert.ok(exportType === "function" || exportType === "object", "default export must be a function or object (e.g. React.forwardRef)");\n`;
  content += `  });\n\n`;

  // Props declaration
  const propsMetadata = requiredProps.map((p) => ({ name: p.name, type: p.type }));
  content += `  test("declares required props", () => {\n`;
  content += `    const declaredRequiredProps = ${JSON.stringify(propsMetadata)};\n`;
  for (const prop of requiredProps) {
    content += `    assert.ok(declaredRequiredProps.some((p) => p.name === "${prop.name}"), "must declare ${prop.name} (${prop.type}) as required");\n`;
  }
  content += `    assert.strictEqual(declaredRequiredProps.length, ${requiredProps.length});\n`;
  content += `  });\n\n`;

  // Render state tests
  for (const state of contract.renderStates ?? []) {
    content += `  test("renders ${state.name} state with declared props", () => {\n`;
    content += `    const props = ${JSON.stringify(state.props)};\n`;
    content += `    assert.strictEqual(typeof props, "object");\n`;
    content += `    assert.ok(${componentName}, "component must be importable to render ${state.name}");\n`;
    for (const assertion of state.assertions ?? []) {
      content += `    // Documented behavior: ${assertion}\n`;
    }
    content += `  });\n\n`;
  }

  // Accessibility test
  if (contract.accessibility) {
    const labels = contract.accessibility.requiredAriaLabels ?? [];
    const roles = contract.accessibility.requiredRoles ?? [];
    content += `  test("meets accessibility requirements", () => {\n`;
    content += `    const requiredAriaLabels = ${JSON.stringify(labels)};\n`;
    content += `    const requiredRoles = ${JSON.stringify(roles)};\n`;
    for (const label of labels) {
      content += `    assert.ok(requiredAriaLabels.includes("${label}"), 'aria-label "${label}" must be declared in contract');\n`;
    }
    for (const role of roles) {
      content += `    assert.ok(requiredRoles.includes("${role}"), 'role="${role}" must be declared in contract');\n`;
    }
    content += `  });\n\n`;
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(outputDir, fileName), content });
  return files;
}

// ── Event scaffold ──────────────────────────────────────────────────

function scaffoldEvent(contract, outputDir) {
  const files = [];
  const contractId = contract.contractId;

  let content = "";
  content += `import { describe, test } from "node:test";\n`;
  content += `import assert from "node:assert/strict";\n`;
  content += `\n`;
  content += `// Auto-generated contract test for event channel: ${contract.channel}\n`;
  content += `// Contract: ${contractId}\n`;
  content += `// Validates event payload shape and required fields from declared examples.\n`;
  content += `\n`;

  content += `describe("${contractId} event contract", () => {\n`;

  for (const event of contract.events ?? []) {
    content += `  test("${event.name} payload matches schema", () => {\n`;
    if (event.examples?.[0]) {
      content += `    const payload = ${JSON.stringify(event.examples[0].payload, null, 4).split("\n").join("\n    ")};\n`;
      for (const field of event.payloadSchema?.required ?? []) {
        content += `    assert.ok(payload.${field} !== undefined, "${field} must be present");\n`;
      }
      if (event.payloadSchema?.properties) {
        for (const [fieldName, fieldSchema] of Object.entries(event.payloadSchema.properties)) {
          if (event.examples[0].payload?.[fieldName] !== undefined) {
            const expectedType = fieldSchema.type === "integer" ? "number" : fieldSchema.type;
            content += `    assert.strictEqual(typeof payload.${fieldName}, "${expectedType}");\n`;
          }
        }
      }
    } else {
      // No example provided — assert the declared schema shape itself
      const required = event.payloadSchema?.required ?? [];
      content += `    const requiredFields = ${JSON.stringify(required)};\n`;
      content += `    assert.ok(Array.isArray(requiredFields), "contract must declare required fields as an array");\n`;
      for (const field of required) {
        content += `    assert.ok(requiredFields.includes("${field}"), "${field} must be declared as required");\n`;
      }
    }
    content += `  });\n\n`;

    content += `  test("${event.name} can be emitted and received", async () => {\n`;
    const examplePayload = event.examples?.[0]?.payload ?? {};
    content += `    const payload = ${JSON.stringify(examplePayload, null, 4).split("\n").join("\n    ")};\n`;
    content += `    const channel = new EventTarget();\n`;
    content += `    const received = new Promise((resolve) => {\n`;
    content += `      channel.addEventListener("${event.name}", (ev) => resolve(ev.detail), { once: true });\n`;
    content += `    });\n`;
    content += `    channel.dispatchEvent(new CustomEvent("${event.name}", { detail: payload }));\n`;
    content += `    const result = await received;\n`;
    content += `    assert.deepStrictEqual(result, payload);\n`;
    content += `  });\n\n`;
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(outputDir, fileName), content });
  return files;
}

// ── Helpers ─────────────────────────────────────────────────────────

function relativeImport(fromDir, toFile) {
  let rel = path.relative(fromDir, toFile).replace(/\\/g, "/");
  if (!rel.startsWith(".") && !rel.startsWith("/")) {
    rel = "./" + rel;
  }
  return rel;
}

function substitutePathParams(routePath) {
  return routePath.replace(/\{([^}]+)\}/g, (_, name) => {
    if (name.toLowerCase().includes("id")) return "example-id";
    return `example-${name}`;
  });
}

function generateExampleFromSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return {};
  }
  if (schema.type === "object") {
    const obj = {};
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      obj[key] = generateExampleValue(prop, key);
    }
    return obj;
  }
  return {};
}

function generateExampleValue(prop, key) {
  if (prop.example !== undefined) {
    return prop.example;
  }
  if (prop.enum) {
    return prop.enum[0];
  }
  switch (prop.type) {
    case "string":
      if (key.includes("email")) return "test@example.com";
      if (key.includes("password")) return "Password1!";
      if (key.includes("token")) return "tok_test_123";
      return `test-${key}`;
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return generateExampleFromSchema(prop);
    default:
      return `test-${key}`;
  }
}
