/**
 * Contract-derived test scaffold generation.
 *
 * Generates structural test files from contract definitions using node:test format.
 * Tests validate types, status codes, and shape — NOT behavioral logic.
 * Each generated file is self-contained with TODO comments for sub-agents.
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
  const safeId = contractId.replace(/[^a-zA-Z0-9-]/g, "-");

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

      let content = "";
      content += `import { describe, test, before, after } from "node:test";\n`;
      content += `import assert from "node:assert/strict";\n`;
      content += `\n`;
      content += `// Auto-generated contract test for ${method.toUpperCase()} ${routePath}\n`;
      content += `// Contract: ${contractId}\n`;
      content += `// STRUCTURAL tests only — validates status codes, response shape, required fields.\n`;
      content += `// TODO: Sub-agent must provide request utility (e.g. supertest, fetch wrapper).\n`;
      content += `\n`;

      content += `describe("${method.toUpperCase()} ${routePath}", () => {\n`;

      // Success case
      const exampleBody = requestSchema ? generateExampleFromSchema(requestSchema) : null;
      content += `  test("returns ${successCode} with valid input", async () => {\n`;
      content += `    // TODO: Replace with actual HTTP request to the endpoint\n`;
      if (exampleBody) {
        content += `    const body = ${JSON.stringify(exampleBody, null, 4).split("\n").join("\n    ")};\n`;
        content += `    const response = await request.${method}("${routePath}").send(body);\n`;
      } else {
        content += `    const response = await request.${method}("${routePath}");\n`;
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
        content += `    // TODO: Send invalid/missing payload to trigger ${errorCode}\n`;
        if (requestSchema) {
          content += `    const body = {};  // intentionally invalid\n`;
          content += `    const response = await request.${method}("${routePath}").send(body);\n`;
        } else {
          content += `    const response = await request.${method}("${routePath}");\n`;
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

  let content = "";
  content += `import { describe, test } from "node:test";\n`;
  content += `import assert from "node:assert/strict";\n`;
  content += `\n`;
  content += `// Auto-generated contract test for module: ${modulePath}\n`;
  content += `// Contract: ${contractId}\n`;
  content += `// STRUCTURAL tests only — validates exports exist, types match, required params.\n`;
  content += `// TODO: Sub-agent must adjust the import path for the target project.\n`;
  content += `\n`;
  content += `// TODO: Uncomment and adjust the import path:\n`;
  content += `// import * as mod from "${modulePath}";\n`;
  content += `\n`;

  content += `describe("${contractId}", () => {\n`;

  for (const exp of exports) {
    // Export existence + type test
    content += `  test("exports ${exp.name} as a ${exp.kind}", () => {\n`;
    content += `    // TODO: Configure the module import before running this assertion\n`;
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
      content += `  test("${exp.name} accepts expected parameters", () => {\n`;
      content += `    // Contract declares ${exp.inputs.length} parameter(s):\n`;
      for (const input of exp.inputs) {
        content += `    //   ${input.name}: ${input.type}${input.required ? " (required)" : " (optional)"}\n`;
      }
      content += `    // TODO: Configure the module import before running this assertion\n`;
      content += `    assert.strictEqual(mod.${exp.name}.length >= ${exp.inputs.filter((i) => i.required).length}, true);\n`;
      content += `  });\n\n`;
    }

    // Output type test
    if (exp.output) {
      content += `  test("${exp.name} returns expected type", async () => {\n`;
      content += `    // Contract declares output type: ${exp.output.type}\n`;
      const exampleInputArgs = (exp.examples?.[0]?.input)
        ? Object.values(exp.examples[0].input).map((v) => JSON.stringify(v)).join(", ")
        : "/* TODO: provide valid args */";
      content += `    // TODO: Configure the module import and valid args before running this assertion\n`;
      content += `    const result = ${exp.async ? "await " : ""}mod.${exp.name}(${exampleInputArgs});\n`;
      content += `    assert.strictEqual(typeof result, "${exp.output.type}");\n`;
      content += `  });\n\n`;
    }

    // Error case stubs
    for (const err of exp.errors ?? []) {
      content += `  test("${exp.name} throws ${err.code} when ${err.when}", async () => {\n`;
      content += `    // TODO: Provide invalid input that triggers: ${err.when}\n`;
      content += `    await assert.rejects(\n`;
      content += `      () => mod.${exp.name}(/* invalid input */),\n`;
      content += `      (error) => { assert.ok(error); return true; }\n`;
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
  const componentName = contract.componentPath?.split("/").pop()?.replace(/\.\w+$/, "") ?? "Component";

  let content = "";
  content += `import { describe, test } from "node:test";\n`;
  content += `import assert from "node:assert/strict";\n`;
  content += `\n`;
  content += `// Auto-generated contract test for component: ${componentName}\n`;
  content += `// Contract: ${contractId}\n`;
  content += `// STRUCTURAL tests — validates render states and accessibility.\n`;
  content += `// TODO: Sub-agent must add render utility (e.g. @testing-library/react).\n`;
  content += `\n`;
  content += `// TODO: Uncomment and configure:\n`;
  content += `// import { render, screen } from "@testing-library/react";\n`;
  content += `// import ${componentName} from "${contract.componentPath}";\n`;
  content += `\n`;

  content += `describe("${componentName} contract", () => {\n`;

  // Props type test
  content += `  test("declares required props", () => {\n`;
  const required = (contract.props ?? []).filter((p) => p.required);
  for (const prop of required) {
    content += `    // Required prop: ${prop.name} (${prop.type})\n`;
  }
  content += `    assert.ok(true, "prop contract documented");\n`;
  content += `  });\n\n`;

  // Render state tests
  for (const state of contract.renderStates ?? []) {
    content += `  test("renders ${state.name} state correctly", () => {\n`;
    content += `    // Props: ${JSON.stringify(state.props)}\n`;
    for (const assertion of state.assertions ?? []) {
      content += `    // TODO: Verify render assertion: ${assertion}\n`;
    }
    content += `    // TODO: Sub-agent implements render + assertions\n`;
    content += `  });\n\n`;
  }

  // Accessibility test
  if (contract.accessibility) {
    content += `  test("meets accessibility requirements", () => {\n`;
    for (const label of contract.accessibility.requiredAriaLabels ?? []) {
      content += `    // TODO: Verify aria-label "${label}" exists\n`;
    }
    for (const role of contract.accessibility.requiredRoles ?? []) {
      content += `    // TODO: Verify role="${role}" exists\n`;
    }
    content += `    // TODO: Sub-agent implements accessibility checks\n`;
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
  content += `// STRUCTURAL tests — validates event payload shape and required fields.\n`;
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
      content += `    // TODO: Provide example payload and validate against schema\n`;
    }
    content += `  });\n\n`;

    content += `  test("${event.name} can be emitted and received", async () => {\n`;
    content += `    // TODO: Sub-agent implements emit/subscribe round-trip\n`;
    content += `  });\n\n`;
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(outputDir, fileName), content });
  return files;
}

// ── Helpers ─────────────────────────────────────────────────────────

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
