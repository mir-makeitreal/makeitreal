# Implementation Specs — 5 Gap-Filling Specifications

**Date:** 2026-05-19
**Status:** IMPLEMENTATION-READY
**Scope:** Contract System, Recursive Orchestration, Plugin Architecture, Documentation, Error Recovery

These 5 specs fill the gaps identified in COMPLETE-PRODUCT-PLAN.md. Each spec is detailed
enough that a coding agent can implement it without asking questions.

---

## SPEC 1: CONTRACT SYSTEM — Test Scaffold Generation

### 1.1 Overview

The contract system currently only validates OpenAPI contracts and module surface
conformance. This spec adds:
- 4 new contract kind schemas (module-io, component, event, migration)
- Contract-derived test scaffold generation for all 5 kinds
- Test framework detection (node:test, jest, vitest, mocha)
- Integration test stub generation for cross-boundary work items
- A test-setup.mjs convention for app bootstrap in generated tests

### 1.2 New Files

```
src/contracts/test-scaffold.mjs          — Main scaffold generator
src/contracts/test-framework-detect.mjs  — Detect project test framework
src/contracts/test-setup-convention.mjs  — Generate test-setup.mjs bootstrap
src/contracts/kinds/module-io.mjs        — module-io contract validator
src/contracts/kinds/component.mjs        — component contract validator
src/contracts/kinds/event.mjs            — event contract validator
src/contracts/kinds/migration.mjs        — migration contract validator
src/contracts/integration-stubs.mjs      — Cross-boundary integration test gen
test/contract-scaffold.test.mjs          — Tests for scaffold generation
test/contract-kinds.test.mjs             — Tests for contract kind validators
test/test-framework-detect.test.mjs      — Tests for framework detection
```

### 1.3 Modified Files

```
src/gates/index.mjs                      — Register new contract kind validators
src/domain/artifacts.mjs                 — Load contracts by kind
```

### 1.4 Contract Kind Schemas

#### module-io contract (src/contracts/kinds/module-io.mjs)

```json
{
  "schemaVersion": "1.0",
  "kind": "module-io",
  "contractId": "contract.auth.hash-password",
  "modulePath": "src/auth/password-hasher.mjs",
  "exports": [
    {
      "name": "hashPassword",
      "kind": "function",
      "async": true,
      "inputs": [
        { "name": "password", "type": "string", "required": true },
        { "name": "options", "type": "object", "required": false,
          "properties": {
            "rounds": { "type": "number", "default": 12 }
          }
        }
      ],
      "output": {
        "type": "string",
        "description": "bcrypt hash"
      },
      "errors": [
        { "code": "PASSWORD_TOO_SHORT", "when": "password.length < 8" },
        { "code": "PASSWORD_TOO_LONG", "when": "password.length > 128" }
      ],
      "examples": [
        {
          "input": { "password": "MyStr0ng!Pass" },
          "outputMatch": "startsWith('$2b$')"
        }
      ]
    }
  ]
}
```

#### component contract (src/contracts/kinds/component.mjs)

```json
{
  "schemaVersion": "1.0",
  "kind": "component",
  "contractId": "contract.ui.login-form",
  "componentPath": "src/components/LoginForm.tsx",
  "framework": "react",
  "props": [
    { "name": "onSubmit", "type": "function", "required": true,
      "signature": "(credentials: {email: string, password: string}) => Promise<void>" },
    { "name": "loading", "type": "boolean", "required": false, "default": false },
    { "name": "error", "type": "string | null", "required": false, "default": null }
  ],
  "renderStates": [
    { "name": "idle", "props": { "loading": false, "error": null },
      "assertions": ["contains email input", "contains password input", "contains submit button"] },
    { "name": "loading", "props": { "loading": true },
      "assertions": ["submit button is disabled", "shows spinner"] },
    { "name": "error", "props": { "error": "Invalid credentials" },
      "assertions": ["shows error message", "submit button is enabled"] }
  ],
  "accessibility": {
    "requiredAriaLabels": ["Email", "Password"],
    "requiredRoles": ["form"]
  }
}
```

#### event contract (src/contracts/kinds/event.mjs)

```json
{
  "schemaVersion": "1.0",
  "kind": "event",
  "contractId": "contract.events.user-created",
  "channel": "user-events",
  "events": [
    {
      "name": "user.created",
      "payloadSchema": {
        "type": "object",
        "properties": {
          "userId": { "type": "string" },
          "email": { "type": "string" },
          "createdAt": { "type": "string", "format": "date-time" }
        },
        "required": ["userId", "email", "createdAt"]
      },
      "examples": [
        {
          "payload": { "userId": "usr_123", "email": "a@b.com", "createdAt": "2026-01-01T00:00:00Z" }
        }
      ]
    }
  ]
}
```

#### migration contract (src/contracts/kinds/migration.mjs)

```json
{
  "schemaVersion": "1.0",
  "kind": "migration",
  "contractId": "contract.migration.add-users-table",
  "engine": "sql",
  "migrationPath": "migrations/001-add-users-table.sql",
  "up": {
    "creates": [
      {
        "table": "users",
        "columns": [
          { "name": "id", "type": "uuid", "primaryKey": true },
          { "name": "email", "type": "varchar(255)", "unique": true, "notNull": true },
          { "name": "password_hash", "type": "varchar(255)", "notNull": true },
          { "name": "created_at", "type": "timestamp", "notNull": true, "default": "now()" }
        ]
      }
    ]
  },
  "down": {
    "drops": ["users"]
  },
  "verification": {
    "postMigrationQuery": "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'",
    "expectedColumns": ["id", "email", "password_hash", "created_at"]
  }
}
```

### 1.5 Test Framework Detection

File: `src/contracts/test-framework-detect.mjs`

```javascript
import path from "node:path";
import { fileExists, readJsonFile } from "../io/json.mjs";

/**
 * @param {{ projectRoot: string }} options
 * @returns {Promise<{
 *   framework: "node:test" | "jest" | "vitest" | "mocha",
 *   importStatement: string,
 *   testFunction: string,
 *   assertImport: string,
 *   runCommand: { file: string, args: string[] }
 * }>}
 */
export async function detectTestFramework({ projectRoot }) {
  const pkgPath = path.join(projectRoot, "package.json");
  let pkg = {};
  if (await fileExists(pkgPath)) {
    pkg = await readJsonFile(pkgPath);
  }

  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies
  };

  // Check vitest first (often coexists with jest in config)
  if (deps.vitest || await fileExists(path.join(projectRoot, "vitest.config.ts"))
      || await fileExists(path.join(projectRoot, "vitest.config.js"))) {
    return {
      framework: "vitest",
      importStatement: 'import { describe, test, expect } from "vitest";',
      testFunction: "test",
      assertImport: "",  // vitest has built-in expect
      assertStyle: "expect",
      runCommand: { file: "npx", args: ["vitest", "run"] }
    };
  }

  // Check jest
  if (deps.jest || await fileExists(path.join(projectRoot, "jest.config.js"))
      || await fileExists(path.join(projectRoot, "jest.config.ts"))
      || pkg.jest) {
    return {
      framework: "jest",
      importStatement: "",  // jest globals
      testFunction: "test",
      assertImport: "",
      assertStyle: "expect",
      runCommand: { file: "npx", args: ["jest"] }
    };
  }

  // Check mocha
  if (deps.mocha) {
    return {
      framework: "mocha",
      importStatement: 'import { describe, it } from "mocha";',
      testFunction: "it",
      assertImport: 'import assert from "node:assert/strict";',
      assertStyle: "assert",
      runCommand: { file: "npx", args: ["mocha"] }
    };
  }

  // Default: node:test (zero dependency)
  return {
    framework: "node:test",
    importStatement: 'import { describe, test } from "node:test";',
    testFunction: "test",
    assertImport: 'import assert from "node:assert/strict";',
    assertStyle: "assert",
    runCommand: { file: "node", args: ["--test"] }
  };
}
```

### 1.6 Test Setup Convention

File: `src/contracts/test-setup-convention.mjs`

The test-setup.mjs convention: every generated test imports a `test-setup.mjs` from
the test directory. This file is responsible for app bootstrap (starting the server,
connecting the DB, etc.). The scaffold generates a minimal stub; the sub-agent fills it in.

```javascript
import path from "node:path";

/**
 * Generate the test-setup.mjs content for a work item.
 *
 * @param {{ workItem: object, contracts: object[], projectRoot: string }} options
 * @returns {{ path: string, content: string }}
 */
export function generateTestSetup({ workItem, contracts, projectRoot }) {
  const hasOpenApi = contracts.some(c => c.kind === "openapi" || c.openapi);
  const hasModuleIo = contracts.some(c => c.kind === "module-io");

  const testDir = resolveTestDir(workItem);

  let content = `// Auto-generated by Make It Real — test bootstrap for ${workItem.id}
// Sub-agent: fill in the app bootstrap logic below.

`;

  if (hasOpenApi) {
    content += `/**
 * Start the HTTP server and return the app/request object.
 * Example: return supertest(app) or return { baseUrl: "http://localhost:3000" }
 *
 * @returns {Promise<{ app: any, teardown: () => Promise<void> }>}
 */
export async function startApp() {
  // TODO: import your app and start it
  // const app = (await import("../../src/app.mjs")).default;
  // return { app, teardown: async () => {} };
  throw new Error("test-setup.mjs: startApp() not implemented — sub-agent must fill this in");
}
`;
  }

  if (hasModuleIo) {
    content += `
/**
 * Import the module under test.
 * @returns {Promise<object>} The module's exports
 */
export async function importModule() {
  // TODO: import the module under test
  // return await import("../../src/auth/password-hasher.mjs");
  throw new Error("test-setup.mjs: importModule() not implemented — sub-agent must fill this in");
}
`;
  }

  return {
    path: path.join(testDir, "test-setup.mjs"),
    content
  };
}

/**
 * Resolve the test directory for a work item based on allowedPaths.
 * Convention: first allowedPath that matches test/** or __tests__/**,
 * or fallback to test/ under the first allowedPath base.
 */
export function resolveTestDir(workItem) {
  const paths = workItem.allowedPaths ?? [];
  const testPath = paths.find(p =>
    /\btest[s]?\b/i.test(p) || /__tests__/.test(p)
  );
  if (testPath) {
    return testPath.replace(/\/\*\*$/, "");
  }
  // Fallback: sibling test/ dir of first allowed path
  const first = paths[0] ?? "src";
  const base = first.replace(/\/\*\*$/, "").split("/")[0];
  return `${base}/test`;
}
```

### 1.7 Main Scaffold Generator

File: `src/contracts/test-scaffold.mjs`

```javascript
import path from "node:path";
import { detectTestFramework } from "./test-framework-detect.mjs";
import { generateTestSetup, resolveTestDir } from "./test-setup-convention.mjs";

/**
 * Generate test scaffold files for a work item's contracts.
 *
 * @param {{
 *   workItem: object,
 *   contracts: object[],
 *   projectRoot: string,
 *   framework?: object  // override auto-detection
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   files: Array<{ path: string, content: string, contractId: string }>,
 *   testSetup: { path: string, content: string } | null,
 *   errors: object[]
 * }>}
 */
export async function generateTestScaffold({ workItem, contracts, projectRoot, framework }) {
  const fw = framework ?? await detectTestFramework({ projectRoot });
  const testDir = resolveTestDir(workItem);
  const files = [];
  const errors = [];

  // Bind only contracts referenced by this work item
  const boundContracts = contracts.filter(c => {
    const contractId = c.contractId ?? c.info?.title;
    return (workItem.contractIds ?? []).includes(contractId);
  });

  for (const contract of boundContracts) {
    const kind = contract.kind ?? (contract.openapi ? "openapi" : "unknown");
    try {
      switch (kind) {
        case "openapi":
          files.push(...scaffoldOpenApi({ contract, testDir, fw, workItem }));
          break;
        case "module-io":
          files.push(...scaffoldModuleIo({ contract, testDir, fw, workItem }));
          break;
        case "component":
          files.push(...scaffoldComponent({ contract, testDir, fw, workItem }));
          break;
        case "event":
          files.push(...scaffoldEvent({ contract, testDir, fw, workItem }));
          break;
        case "migration":
          files.push(...scaffoldMigration({ contract, testDir, fw, workItem }));
          break;
        default:
          // Unknown contract kind — skip silently
          break;
      }
    } catch (error) {
      errors.push({
        code: "HARNESS_SCAFFOLD_GENERATION_FAILED",
        reason: `Failed to scaffold tests for ${contract.contractId}: ${error.message}`,
        evidence: [contract.contractId]
      });
    }
  }

  const testSetup = boundContracts.length > 0
    ? generateTestSetup({ workItem, contracts: boundContracts, projectRoot })
    : null;

  return { ok: errors.length === 0, files, testSetup, errors };
}

// ── OpenAPI scaffold ──────────────────────────────────────────────

function scaffoldOpenApi({ contract, testDir, fw, workItem }) {
  const files = [];
  const contractId = contract.contractId ?? contract.info?.title ?? "unknown";

  for (const [pathStr, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = pathItem[method];
      const operationId = op.operationId ?? `${method}_${pathStr.replace(/\//g, "_")}`;
      const fileName = `${operationId}.contract.test.mjs`;

      const requestSchema = op.requestBody?.content?.["application/json"]?.schema;
      const successCode = Object.keys(op.responses ?? {}).find(c => c.startsWith("2")) ?? "200";
      const successResponse = op.responses?.[successCode];
      const successSchema = successResponse?.content?.["application/json"]?.schema;
      const errorCodes = Object.keys(op.responses ?? {}).filter(c => c.startsWith("4") || c.startsWith("5"));

      let content = "";
      // Imports
      if (fw.importStatement) content += `${fw.importStatement}\n`;
      if (fw.assertImport) content += `${fw.assertImport}\n`;
      content += `import { startApp } from "./test-setup.mjs";\n\n`;

      // Describe block
      content += `describe("${method.toUpperCase()} ${pathStr}", () => {\n`;
      content += `  let app, teardown;\n\n`;
      content += `  before(async () => {\n`;
      content += `    ({ app, teardown } = await startApp());\n`;
      content += `  });\n\n`;
      content += `  after(async () => {\n`;
      content += `    if (teardown) await teardown();\n`;
      content += `  });\n\n`;

      // Success case
      const exampleBody = generateExampleFromSchema(requestSchema);
      content += `  ${fw.testFunction}("${method.toUpperCase()} ${pathStr} returns ${successCode} with valid input", async () => {\n`;
      if (requestSchema) {
        content += `    const body = ${JSON.stringify(exampleBody, null, 4).split("\n").join("\n    ")};\n`;
        content += `    const response = await app.${method}("${pathStr}").send(body);\n`;
      } else {
        content += `    const response = await app.${method}("${pathStr}");\n`;
      }
      if (fw.assertStyle === "expect") {
        content += `    expect(response.status).toBe(${successCode});\n`;
        if (successSchema?.required) {
          for (const field of successSchema.required) {
            content += `    expect(response.body.${field}).toBeDefined();\n`;
          }
        }
      } else {
        content += `    assert.strictEqual(response.status, ${Number(successCode)});\n`;
        if (successSchema?.required) {
          for (const field of successSchema.required) {
            content += `    assert.ok(response.body.${field} !== undefined, "${field} must be present");\n`;
          }
        }
      }
      content += `  });\n\n`;

      // Error cases
      for (const errorCode of errorCodes) {
        const errResponse = op.responses[errorCode];
        content += `  ${fw.testFunction}("${method.toUpperCase()} ${pathStr} returns ${errorCode} on invalid input", async () => {\n`;
        if (requestSchema) {
          content += `    const body = {};  // intentionally invalid\n`;
          content += `    const response = await app.${method}("${pathStr}").send(body);\n`;
        } else {
          content += `    const response = await app.${method}("${pathStr}");\n`;
        }
        if (fw.assertStyle === "expect") {
          content += `    expect(response.status).toBe(${errorCode});\n`;
        } else {
          content += `    assert.strictEqual(response.status, ${Number(errorCode)});\n`;
        }
        content += `  });\n\n`;
      }

      content += `});\n`;

      files.push({
        path: path.join(testDir, fileName),
        content,
        contractId
      });
    }
  }
  return files;
}

// ── Module-IO scaffold ────────────────────────────────────────────

function scaffoldModuleIo({ contract, testDir, fw, workItem }) {
  const files = [];
  const contractId = contract.contractId;
  const modulePath = contract.modulePath;
  const exports = contract.exports ?? [];

  let content = "";
  if (fw.importStatement) content += `${fw.importStatement}\n`;
  if (fw.assertImport) content += `${fw.assertImport}\n`;
  content += `import { importModule } from "./test-setup.mjs";\n\n`;

  content += `describe("${contractId}", () => {\n`;
  content += `  let mod;\n\n`;
  content += `  before(async () => {\n`;
  content += `    mod = await importModule();\n`;
  content += `  });\n\n`;

  for (const exp of exports) {
    // Export existence test
    content += `  ${fw.testFunction}("exports ${exp.name}", () => {\n`;
    if (fw.assertStyle === "expect") {
      content += `    expect(typeof mod.${exp.name}).toBe("function");\n`;
    } else {
      content += `    assert.strictEqual(typeof mod.${exp.name}, "function");\n`;
    }
    content += `  });\n\n`;

    // Example-based tests
    for (const [idx, example] of (exp.examples ?? []).entries()) {
      const inputArgs = example.input
        ? Object.values(example.input).map(v => JSON.stringify(v)).join(", ")
        : "";
      content += `  ${fw.testFunction}("${exp.name} example ${idx + 1}", async () => {\n`;
      content += `    const result = ${exp.async ? "await " : ""}mod.${exp.name}(${inputArgs});\n`;
      if (example.output !== undefined) {
        if (fw.assertStyle === "expect") {
          content += `    expect(result).toEqual(${JSON.stringify(example.output)});\n`;
        } else {
          content += `    assert.deepStrictEqual(result, ${JSON.stringify(example.output)});\n`;
        }
      } else if (example.outputMatch) {
        content += `    // Verify: ${example.outputMatch}\n`;
        content += `    assert.ok(result, "result must be truthy");\n`;
      }
      content += `  });\n\n`;
    }

    // Error case tests
    for (const err of exp.errors ?? []) {
      content += `  ${fw.testFunction}("${exp.name} throws ${err.code} when ${err.when}", async () => {\n`;
      if (fw.assertStyle === "expect") {
        content += `    await expect(mod.${exp.name}(/* TODO: invalid input for ${err.when} */)).rejects.toThrow();\n`;
      } else {
        content += `    await assert.rejects(\n`;
        content += `      () => mod.${exp.name}(/* TODO: invalid input for ${err.when} */),\n`;
        content += `      (error) => { assert.ok(error); return true; }\n`;
        content += `    );\n`;
      }
      content += `  });\n\n`;
    }
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(testDir, fileName), content, contractId });
  return files;
}

// ── Component scaffold ────────────────────────────────────────────

function scaffoldComponent({ contract, testDir, fw, workItem }) {
  const files = [];
  const contractId = contract.contractId;
  const componentName = contract.componentPath?.split("/").pop()?.replace(/\.\w+$/, "") ?? "Component";

  let content = "";
  if (fw.importStatement) content += `${fw.importStatement}\n`;
  if (fw.assertImport) content += `${fw.assertImport}\n`;
  content += `// Component contract test scaffold — sub-agent must add render utility\n`;
  content += `// import { render, screen } from "@testing-library/react";\n`;
  content += `// import ${componentName} from "${contract.componentPath}";\n\n`;

  content += `describe("${componentName} contract", () => {\n`;

  for (const state of contract.renderStates ?? []) {
    content += `  ${fw.testFunction}("renders ${state.name} state correctly", () => {\n`;
    content += `    // Props: ${JSON.stringify(state.props)}\n`;
    content += `    // render(<${componentName} ${Object.entries(state.props).map(([k, v]) => `${k}={${JSON.stringify(v)}}`).join(" ")} />);\n`;
    for (const assertion of state.assertions ?? []) {
      content += `    // assert: ${assertion}\n`;
    }
    content += `    // TODO: sub-agent implements render + assertions\n`;
    content += `  });\n\n`;
  }

  if (contract.accessibility) {
    content += `  ${fw.testFunction}("meets accessibility requirements", () => {\n`;
    for (const label of contract.accessibility.requiredAriaLabels ?? []) {
      content += `    // assert: aria-label "${label}" exists\n`;
    }
    for (const role of contract.accessibility.requiredRoles ?? []) {
      content += `    // assert: role="${role}" exists\n`;
    }
    content += `  });\n\n`;
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(testDir, fileName), content, contractId });
  return files;
}

// ── Event scaffold ────────────────────────────────────────────────

function scaffoldEvent({ contract, testDir, fw, workItem }) {
  const files = [];
  const contractId = contract.contractId;

  let content = "";
  if (fw.importStatement) content += `${fw.importStatement}\n`;
  if (fw.assertImport) content += `${fw.assertImport}\n`;
  content += `\n`;

  content += `describe("${contractId} event contract", () => {\n`;

  for (const event of contract.events ?? []) {
    content += `  ${fw.testFunction}("${event.name} payload matches schema", () => {\n`;
    if (event.examples?.[0]) {
      content += `    const payload = ${JSON.stringify(event.examples[0].payload, null, 4).split("\n").join("\n    ")};\n`;
      for (const field of event.payloadSchema?.required ?? []) {
        if (fw.assertStyle === "expect") {
          content += `    expect(payload.${field}).toBeDefined();\n`;
        } else {
          content += `    assert.ok(payload.${field} !== undefined, "${field} must be present");\n`;
        }
      }
    }
    content += `  });\n\n`;

    content += `  ${fw.testFunction}("${event.name} can be emitted and received", async () => {\n`;
    content += `    // TODO: sub-agent implements emit/subscribe round-trip\n`;
    content += `  });\n\n`;
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(testDir, fileName), content, contractId });
  return files;
}

// ── Migration scaffold ────────────────────────────────────────────

function scaffoldMigration({ contract, testDir, fw, workItem }) {
  const files = [];
  const contractId = contract.contractId;

  let content = "";
  if (fw.importStatement) content += `${fw.importStatement}\n`;
  if (fw.assertImport) content += `${fw.assertImport}\n`;
  content += `\n`;

  content += `describe("${contractId} migration contract", () => {\n`;

  for (const table of contract.up?.creates ?? []) {
    content += `  ${fw.testFunction}("creates table ${table.table} with required columns", async () => {\n`;
    content += `    // TODO: sub-agent runs migration, then queries information_schema\n`;
    for (const col of table.columns) {
      content += `    // assert column exists: ${col.name} (${col.type})\n`;
    }
    content += `  });\n\n`;
  }

  if (contract.down?.drops) {
    content += `  ${fw.testFunction}("rollback drops tables", async () => {\n`;
    for (const table of contract.down.drops) {
      content += `    // assert table ${table} no longer exists after down migration\n`;
    }
    content += `  });\n\n`;
  }

  content += `});\n`;

  const fileName = `${contractId.replace(/\./g, "-")}.contract.test.mjs`;
  files.push({ path: path.join(testDir, fileName), content, contractId });
  return files;
}

// ── Helpers ───────────────────────────────────────────────────────

function generateExampleFromSchema(schema) {
  if (!schema || typeof schema !== "object") return {};
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
  if (prop.example !== undefined) return prop.example;
  if (prop.enum) return prop.enum[0];
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
```

### 1.8 Integration Test Stubs

File: `src/contracts/integration-stubs.mjs`

```javascript
import path from "node:path";
import { detectTestFramework } from "./test-framework-detect.mjs";
import { resolveTestDir } from "./test-setup-convention.mjs";

/**
 * Generate integration test stubs for cross-boundary verification.
 * These go into the integration-evidence work item.
 *
 * @param {{
 *   integrationWorkItem: object,
 *   providerWorkItems: object[],
 *   contracts: object[],
 *   projectRoot: string
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   files: Array<{ path: string, content: string }>,
 *   errors: object[]
 * }>}
 */
export async function generateIntegrationStubs({
  integrationWorkItem,
  providerWorkItems,
  contracts,
  projectRoot
}) {
  const fw = await detectTestFramework({ projectRoot });
  const testDir = resolveTestDir(integrationWorkItem);
  const files = [];

  // For each dependency contract on the integration work item,
  // generate a stub that tests the boundary
  for (const dep of integrationWorkItem.dependencyContracts ?? []) {
    const contract = contracts.find(c =>
      (c.contractId ?? c.info?.title) === dep.contractId
    );
    if (!contract) continue;

    const provider = providerWorkItems.find(w =>
      w.responsibilityUnitId === dep.providerResponsibilityUnitId
    );

    let content = "";
    if (fw.importStatement) content += `${fw.importStatement}\n`;
    if (fw.assertImport) content += `${fw.assertImport}\n`;
    content += `\n`;
    content += `// Integration test: verifies ${dep.contractId}\n`;
    content += `// Provider: ${dep.providerResponsibilityUnitId}\n`;
    content += `// Consumer: ${integrationWorkItem.responsibilityUnitId}\n`;
    content += `// Surface: ${dep.surface}\n\n`;

    content += `describe("integration: ${dep.contractId}", () => {\n`;
    content += `  ${fw.testFunction}("provider and consumer agree on contract surface", async () => {\n`;
    content += `    // TODO: sub-agent verifies provider exports match consumer imports\n`;
    content += `    // Provider module: ${provider?.allowedPaths?.[0] ?? "unknown"}\n`;
    content += `    // Contract surface: ${dep.surface}\n`;
    content += `    // Allowed use: ${dep.allowedUse}\n`;
    content += `  });\n`;
    content += `});\n`;

    const fileName = `integration-${dep.contractId.replace(/\./g, "-")}.test.mjs`;
    files.push({ path: path.join(testDir, fileName), content });
  }

  return { ok: true, files, errors: [] };
}
```

### 1.9 Gate System Integration

Modify `src/gates/index.mjs` to validate new contract kinds:

```javascript
// Add to imports at top of src/gates/index.mjs:
import { validateModuleIoContract } from "../contracts/kinds/module-io.mjs";
import { validateComponentContract } from "../contracts/kinds/component.mjs";
import { validateEventContract } from "../contracts/kinds/event.mjs";
import { validateMigrationContract } from "../contracts/kinds/migration.mjs";

// Add inside runGates(), after the existing validateOpenApiContracts call:
// In the "if (target === 'Ready' || target === 'Done')" block, add:
const contractsByKind = groupContractsByKind(artifacts.contracts);
for (const contract of contractsByKind["module-io"] ?? []) {
  const result = validateModuleIoContract(contract);
  errors.push(...result.errors);
}
for (const contract of contractsByKind["component"] ?? []) {
  const result = validateComponentContract(contract);
  errors.push(...result.errors);
}
for (const contract of contractsByKind["event"] ?? []) {
  const result = validateEventContract(contract);
  errors.push(...result.errors);
}
for (const contract of contractsByKind["migration"] ?? []) {
  const result = validateMigrationContract(contract);
  errors.push(...result.errors);
}
```

Each kind validator follows the same pattern as `validateOpenApiContracts`:

```javascript
// src/contracts/kinds/module-io.mjs
export function validateModuleIoContract(contract) {
  const errors = [];
  const contractId = contract.contractId;

  if (contract.kind !== "module-io") {
    errors.push(contractError("HARNESS_CONTRACT_KIND_INVALID",
      `Expected kind module-io, got ${contract.kind}`, contractId));
    return { ok: false, errors };
  }
  if (!contract.modulePath || typeof contract.modulePath !== "string") {
    errors.push(contractError("HARNESS_MODULE_IO_PATH_MISSING",
      `module-io contract ${contractId} requires modulePath`, contractId));
  }
  if (!Array.isArray(contract.exports) || contract.exports.length === 0) {
    errors.push(contractError("HARNESS_MODULE_IO_EXPORTS_MISSING",
      `module-io contract ${contractId} requires at least one export`, contractId));
  }
  for (const exp of contract.exports ?? []) {
    if (!exp.name || typeof exp.name !== "string") {
      errors.push(contractError("HARNESS_MODULE_IO_EXPORT_NAME_MISSING",
        `module-io export requires a name in ${contractId}`, contractId));
    }
    if (!Array.isArray(exp.inputs)) {
      errors.push(contractError("HARNESS_MODULE_IO_INPUTS_MISSING",
        `module-io export ${exp.name} requires inputs array in ${contractId}`, contractId));
    }
  }
  return { ok: errors.length === 0, errors };
}
```

### 1.10 Edge Cases

1. **No package.json** → default to node:test framework
2. **Empty contract.exports** → validation error, no scaffold generated
3. **OpenAPI contract with no paths** → validation error
4. **Work item with no contractIds** → scaffold returns empty files array
5. **Contract referenced by work item but not found in artifacts** → error in files[], ok: false
6. **Multiple work items referencing same contract** → each gets its own scaffold copy
7. **Test directory already has files** → scaffold generates with `.contract.test.mjs` suffix to avoid collisions
8. **Schema with $ref** → resolve refs using existing `resolveSchemaRef()` from openapi-contract.mjs

### 1.11 Test Cases

File: `test/contract-scaffold.test.mjs`

```javascript
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { generateTestScaffold } from "../src/contracts/test-scaffold.mjs";

describe("generateTestScaffold", () => {
  const nodeTestFw = {
    framework: "node:test",
    importStatement: 'import { describe, test } from "node:test";',
    testFunction: "test",
    assertImport: 'import assert from "node:assert/strict";',
    assertStyle: "assert",
    runCommand: { file: "node", args: ["--test"] }
  };

  test("generates OpenAPI tests from auth contract", async () => {
    const workItem = {
      id: "work.auth-api",
      contractIds: ["contract.auth.login"],
      allowedPaths: ["src/auth/**"],
      responsibilityUnitId: "ru.auth"
    };
    const contracts = [{
      contractId: "contract.auth.login",
      openapi: "3.1.0",
      info: { title: "Auth Login", version: "1.0.0" },
      paths: {
        "/auth/login": {
          post: {
            operationId: "login",
            requestBody: {
              content: { "application/json": { schema: {
                type: "object",
                properties: { email: { type: "string" }, password: { type: "string" } },
                required: ["email", "password"]
              }}}
            },
            responses: {
              "200": { description: "OK", content: { "application/json": { schema: {
                type: "object", properties: { token: { type: "string" } }, required: ["token"]
              }}}},
              "401": { description: "Unauthorized" }
            }
          }
        }
      }
    }];

    const result = await generateTestScaffold({
      workItem, contracts, projectRoot: "/tmp/test-project", framework: nodeTestFw
    });

    assert.ok(result.ok);
    assert.ok(result.files.length >= 1);
    const testFile = result.files[0];
    assert.ok(testFile.content.includes("POST /auth/login"));
    assert.ok(testFile.content.includes("returns 200"));
    assert.ok(testFile.content.includes("returns 401"));
    assert.ok(testFile.content.includes("assert.strictEqual"));
    assert.ok(testFile.path.endsWith(".contract.test.mjs"));
  });

  test("generates module-io tests from function contract", async () => {
    const workItem = {
      id: "work.hasher",
      contractIds: ["contract.auth.hash-password"],
      allowedPaths: ["src/auth/**"]
    };
    const contracts = [{
      kind: "module-io",
      contractId: "contract.auth.hash-password",
      modulePath: "src/auth/password-hasher.mjs",
      exports: [{
        name: "hashPassword",
        kind: "function",
        async: true,
        inputs: [{ name: "password", type: "string", required: true }],
        output: { type: "string" },
        errors: [{ code: "PASSWORD_TOO_SHORT", when: "password.length < 8" }],
        examples: [{ input: { password: "MyStr0ng!Pass" }, outputMatch: "startsWith('$2b$')" }]
      }]
    }];

    const result = await generateTestScaffold({
      workItem, contracts, projectRoot: "/tmp/test-project", framework: nodeTestFw
    });

    assert.ok(result.ok);
    assert.ok(result.files.length === 1);
    assert.ok(result.files[0].content.includes("hashPassword"));
    assert.ok(result.files[0].content.includes("PASSWORD_TOO_SHORT"));
    assert.ok(result.files[0].content.includes("exports hashPassword"));
  });

  test("returns empty files for work item with no matching contracts", async () => {
    const workItem = { id: "w1", contractIds: ["nonexistent"], allowedPaths: ["src/**"] };
    const result = await generateTestScaffold({
      workItem, contracts: [], projectRoot: "/tmp", framework: nodeTestFw
    });
    assert.ok(result.ok);
    assert.strictEqual(result.files.length, 0);
  });

  test("generates test-setup.mjs with startApp for OpenAPI contracts", async () => {
    const workItem = { id: "w1", contractIds: ["c1"], allowedPaths: ["src/api/**"] };
    const contracts = [{ contractId: "c1", openapi: "3.1.0", paths: { "/x": { get: { operationId: "getX", responses: { "200": {} } } } } }];
    const result = await generateTestScaffold({
      workItem, contracts, projectRoot: "/tmp", framework: nodeTestFw
    });
    assert.ok(result.testSetup);
    assert.ok(result.testSetup.content.includes("startApp"));
  });
});
```

File: `test/test-framework-detect.test.mjs`

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectTestFramework } from "../src/contracts/test-framework-detect.mjs";

test("detects node:test when no framework in package.json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fw-detect-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "test" }));
  const result = await detectTestFramework({ projectRoot: dir });
  assert.strictEqual(result.framework, "node:test");
  await rm(dir, { recursive: true });
});

test("detects vitest when vitest in devDependencies", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fw-detect-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    devDependencies: { vitest: "^1.0.0" }
  }));
  const result = await detectTestFramework({ projectRoot: dir });
  assert.strictEqual(result.framework, "vitest");
  await rm(dir, { recursive: true });
});

test("detects jest when jest.config.js exists", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fw-detect-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({}));
  await writeFile(path.join(dir, "jest.config.js"), "module.exports = {};");
  const result = await detectTestFramework({ projectRoot: dir });
  assert.strictEqual(result.framework, "jest");
  await rm(dir, { recursive: true });
});

test("defaults to node:test when no package.json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fw-detect-"));
  const result = await detectTestFramework({ projectRoot: dir });
  assert.strictEqual(result.framework, "node:test");
  await rm(dir, { recursive: true });
});
```

---

## SPEC 2: RECURSIVE ORCHESTRATION — NEEDS_DECOMPOSE Protocol

### 2.1 Overview

Implement the NEEDS_DECOMPOSE protocol allowing sub-agents to signal that a work item
is too large and propose a decomposition into child work items. The orchestrator
validates the proposal, atomically mutates the board, and dispatches child work items.

### 2.2 New Files

```
src/board/board-mutator.mjs              — Atomic board mutation (add/remove work items)
test/board-mutator.test.mjs              — Tests for board mutation
test/needs-decompose.test.mjs            — Tests for NEEDS_DECOMPOSE flow
```

### 2.3 Modified Files

```
src/kanban/lanes.mjs                     — Add "Decomposing" lane + transitions
src/orchestrator/orchestrator.mjs        — Handle NEEDS_DECOMPOSE in finishNativeClaudeTask
src/domain/work-item-dag.mjs             — Support parentWorkItemId in validation
src/domain/runtime-events.mjs            — Add decomposition events
```

### 2.4 childWorkProposal JSON Schema

This is the exact schema a sub-agent must return when reporting NEEDS_DECOMPOSE:

```json
{
  "childWorkProposal": {
    "schemaVersion": "1.0",
    "reason": "The auth system requires separate password-hashing, session-store, and API-endpoint modules that cross responsibility boundaries.",
    "children": [
      {
        "id": "work.auth-hasher",
        "title": "Password hashing module",
        "responsibilityUnitId": "ru.auth-hasher",
        "allowedPaths": ["src/auth/hasher/**"],
        "contractIds": ["contract.auth.hash-password"],
        "dependencyContracts": [],
        "dependsOn": [],
        "verificationCommands": [
          { "file": "node", "args": ["--test", "src/auth/hasher/test/**"] }
        ],
        "doneEvidence": [
          { "kind": "verification", "path": "evidence/verification-auth-hasher.json" },
          { "kind": "wiki-sync", "path": "evidence/wiki-sync-auth-hasher.json" }
        ]
      },
      {
        "id": "work.auth-api",
        "title": "Auth API endpoint",
        "responsibilityUnitId": "ru.auth-api",
        "allowedPaths": ["src/auth/api/**"],
        "contractIds": ["contract.auth.login"],
        "dependencyContracts": [
          {
            "contractId": "contract.auth.hash-password",
            "providerResponsibilityUnitId": "ru.auth-hasher",
            "surface": "hashPassword(password) → hash",
            "allowedUse": "import"
          }
        ],
        "dependsOn": ["work.auth-hasher"],
        "verificationCommands": [
          { "file": "node", "args": ["--test", "src/auth/api/test/**"] }
        ],
        "doneEvidence": [
          { "kind": "verification", "path": "evidence/verification-auth-api.json" },
          { "kind": "wiki-sync", "path": "evidence/wiki-sync-auth-api.json" }
        ]
      }
    ],
    "newContracts": [
      {
        "kind": "module-io",
        "contractId": "contract.auth.hash-password",
        "modulePath": "src/auth/hasher/index.mjs",
        "exports": [
          {
            "name": "hashPassword",
            "kind": "function",
            "async": true,
            "inputs": [{ "name": "password", "type": "string", "required": true }],
            "output": { "type": "string" },
            "errors": [],
            "examples": []
          }
        ]
      }
    ],
    "newResponsibilityUnits": [
      {
        "id": "ru.auth-hasher",
        "owner": "work.auth-hasher",
        "allowedPaths": ["src/auth/hasher/**"],
        "mustProvideContracts": ["contract.auth.hash-password"]
      },
      {
        "id": "ru.auth-api",
        "owner": "work.auth-api",
        "allowedPaths": ["src/auth/api/**"],
        "mustProvideContracts": ["contract.auth.login"]
      }
    ]
  }
}
```

### 2.5 Proposal Validation

File: `src/board/board-mutator.mjs`

```javascript
import path from "node:path";
import { loadBoard, saveBoard, appendBoardEvent } from "./board-store.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern, reservedControlPlanePath } from "../domain/path-policy.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { readJsonFile, writeJsonFile, fileExists } from "../io/json.mjs";
import { mkdir } from "node:fs/promises";

const MAX_DECOMPOSITION_DEPTH = 2;
const MAX_CHILDREN_PER_PROPOSAL = 8;

/**
 * Validate a childWorkProposal against existing board state.
 *
 * @param {{
 *   proposal: object,
 *   parentWorkItem: object,
 *   board: object,
 *   artifacts: object,
 *   depth: number
 * }} options
 * @returns {{ ok: boolean, errors: object[] }}
 */
export function validateChildWorkProposal({ proposal, parentWorkItem, board, artifacts, depth }) {
  const errors = [];

  // 1. Schema version check
  if (!proposal || typeof proposal !== "object") {
    return { ok: false, errors: [createError("HARNESS_DECOMPOSE_SCHEMA_INVALID",
      "childWorkProposal must be a non-null object.")] };
  }

  // 2. Depth limit
  const effectiveDepth = (depth ?? parentWorkItem.decompositionDepth ?? 0) + 1;
  if (effectiveDepth > MAX_DECOMPOSITION_DEPTH) {
    errors.push(createError("HARNESS_DECOMPOSE_DEPTH_EXCEEDED",
      `Decomposition depth ${effectiveDepth} exceeds maximum ${MAX_DECOMPOSITION_DEPTH}.`));
  }

  // 3. Children array
  const children = proposal.children ?? [];
  if (!Array.isArray(children) || children.length === 0) {
    errors.push(createError("HARNESS_DECOMPOSE_CHILDREN_EMPTY",
      "childWorkProposal.children must be a non-empty array."));
    return { ok: false, errors };
  }
  if (children.length > MAX_CHILDREN_PER_PROPOSAL) {
    errors.push(createError("HARNESS_DECOMPOSE_CHILDREN_EXCEEDED",
      `childWorkProposal has ${children.length} children, max is ${MAX_CHILDREN_PER_PROPOSAL}.`));
  }

  // 4. Unique child IDs
  const childIds = new Set();
  const existingIds = new Set(board.workItems.map(w => w.id));
  for (const child of children) {
    if (!child.id || typeof child.id !== "string") {
      errors.push(createError("HARNESS_DECOMPOSE_CHILD_ID_MISSING",
        "Each child must have a non-empty string id."));
      continue;
    }
    if (childIds.has(child.id)) {
      errors.push(createError("HARNESS_DECOMPOSE_CHILD_ID_DUPLICATE",
        `Duplicate child work item id: ${child.id}.`));
    }
    if (existingIds.has(child.id)) {
      errors.push(createError("HARNESS_DECOMPOSE_CHILD_ID_CONFLICT",
        `Child id ${child.id} conflicts with existing board work item.`));
    }
    childIds.add(child.id);
  }

  // 5. Child allowedPaths ⊆ parent allowedPaths
  const parentPaths = new Set(parentWorkItem.allowedPaths ?? []);
  for (const child of children) {
    for (const childPath of child.allowedPaths ?? []) {
      if (reservedControlPlanePath(childPath)) {
        errors.push(createError("HARNESS_DECOMPOSE_PATH_RESERVED",
          `Child ${child.id} uses reserved path: ${childPath}.`));
      } else if (invalidAllowedPathPattern(childPath)) {
        errors.push(createError("HARNESS_DECOMPOSE_PATH_INVALID",
          `Child ${child.id} has invalid path pattern: ${childPath}.`));
      }
      // Path subsumption check: child path must be under a parent path
      if (!isSubsumedByAny(childPath, parentWorkItem.allowedPaths ?? [])) {
        errors.push(createError("HARNESS_DECOMPOSE_PATH_OUTSIDE_PARENT",
          `Child ${child.id} path ${childPath} is not within parent's allowed paths.`));
      }
    }
  }

  // 6. No overlapping allowedPaths between children
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      for (const leftPath of children[i].allowedPaths ?? []) {
        for (const rightPath of children[j].allowedPaths ?? []) {
          if (patternsOverlap(leftPath, rightPath)) {
            errors.push(createError("HARNESS_DECOMPOSE_PATH_OVERLAP",
              `Children ${children[i].id} and ${children[j].id} overlap on ${leftPath} / ${rightPath}.`));
          }
        }
      }
    }
  }

  // 7. DAG is acyclic among children
  const childIdSet = new Set(children.map(c => c.id));
  for (const child of children) {
    for (const dep of child.dependsOn ?? []) {
      if (!childIdSet.has(dep) && dep !== parentWorkItem.id) {
        errors.push(createError("HARNESS_DECOMPOSE_DEPENDENCY_INVALID",
          `Child ${child.id} depends on ${dep} which is not a sibling child or parent.`));
      }
    }
  }
  if (hasCycle(children)) {
    errors.push(createError("HARNESS_DECOMPOSE_CYCLE",
      "childWorkProposal.children contain a dependency cycle."));
  }

  // 8. Verification commands parse
  for (const child of children) {
    if (!Array.isArray(child.verificationCommands) || child.verificationCommands.length === 0) {
      errors.push(createError("HARNESS_DECOMPOSE_VERIFICATION_MISSING",
        `Child ${child.id} must have at least one verificationCommand.`));
    }
  }

  // 9. Done evidence plan
  for (const child of children) {
    const kinds = new Set((child.doneEvidence ?? []).map(e => e.kind));
    if (!kinds.has("verification") || !kinds.has("wiki-sync")) {
      errors.push(createError("HARNESS_DECOMPOSE_EVIDENCE_MISSING",
        `Child ${child.id} must plan verification and wiki-sync done evidence.`));
    }
  }

  // 10. Reason is provided
  if (!proposal.reason || typeof proposal.reason !== "string" || proposal.reason.trim().length < 10) {
    errors.push(createError("HARNESS_DECOMPOSE_REASON_MISSING",
      "childWorkProposal.reason must be a non-empty explanation (min 10 chars)."));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Atomically materialize child work items on the board.
 *
 * @param {{
 *   boardDir: string,
 *   parentWorkItemId: string,
 *   proposal: object,
 *   now: Date
 * }} options
 * @returns {Promise<{ ok: boolean, childWorkItemIds: string[], errors: object[] }>}
 */
export async function materializeChildWorkItems({ boardDir, parentWorkItemId, proposal, now }) {
  const board = await loadBoard(boardDir);
  const parentWorkItem = board.workItems.find(w => w.id === parentWorkItemId);
  if (!parentWorkItem) {
    return { ok: false, childWorkItemIds: [], errors: [
      createError("HARNESS_WORK_ITEM_UNKNOWN", `Parent work item not found: ${parentWorkItemId}`)
    ]};
  }

  const artifacts = await loadRunArtifacts(boardDir);
  const parentDepth = parentWorkItem.decompositionDepth ?? 0;

  // Validate proposal
  const validation = validateChildWorkProposal({
    proposal,
    parentWorkItem,
    board,
    artifacts,
    depth: parentDepth
  });
  if (!validation.ok) {
    return { ok: false, childWorkItemIds: [], errors: validation.errors };
  }

  // Materialize children on board
  const childWorkItemIds = [];
  for (const child of proposal.children) {
    const childWorkItem = {
      ...child,
      schemaVersion: "1.0",
      lane: "Ready",
      parentWorkItemId,
      decompositionDepth: parentDepth + 1,
      childWorkItemIds: [],
      prdId: parentWorkItem.prdId,
      prdTrace: parentWorkItem.prdTrace
    };
    board.workItems.push(childWorkItem);
    childWorkItemIds.push(child.id);
  }

  // Update parent
  parentWorkItem.lane = "Decomposing";
  parentWorkItem.childWorkItemIds = childWorkItemIds;

  // Update DAG
  const dag = artifacts.workItemDag;
  for (const child of proposal.children) {
    dag.nodes.push({
      id: child.id,
      kind: "implementation",
      requiredForDone: true,
      responsibilityUnitId: child.responsibilityUnitId
    });
    // Add edges from child to its dependencies
    for (const depId of child.dependsOn ?? []) {
      const contractId = findSharedContract(child, proposal.children.find(c => c.id === depId));
      dag.edges.push({
        from: depId,
        to: child.id,
        kind: contractId ? "contract-dependency" : "coordination",
        ...(contractId ? { contractId } : {})
      });
    }
  }

  // Write new contract files if any
  for (const contract of proposal.newContracts ?? []) {
    const contractPath = path.join(boardDir, "contracts",
      `${contract.contractId.replace(/\./g, "-")}.json`);
    await mkdir(path.dirname(contractPath), { recursive: true });
    await writeJsonFile(contractPath, contract);
  }

  // Write new responsibility units
  if (proposal.newResponsibilityUnits?.length > 0) {
    const ruPath = path.join(boardDir, "responsibility-units.json");
    const ru = await readJsonFile(ruPath);
    for (const unit of proposal.newResponsibilityUnits) {
      if (!ru.units.some(u => u.id === unit.id)) {
        ru.units.push(unit);
      }
    }
    await writeJsonFile(ruPath, ru);
  }

  // Write child work item files
  for (const child of proposal.children) {
    const workItemPath = path.join(boardDir, "work-items", `${child.id}.json`);
    await mkdir(path.dirname(workItemPath), { recursive: true });
    const childWorkItem = board.workItems.find(w => w.id === child.id);
    await writeJsonFile(workItemPath, childWorkItem);
  }

  // Save updated DAG
  await writeJsonFile(path.join(boardDir, "work-item-dag.json"), dag);

  // Save board
  await saveBoard(boardDir, board);

  // Emit events
  await appendBoardEvent(boardDir, {
    event: "work_decomposed",
    timestamp: now.toISOString(),
    workItemId: parentWorkItemId,
    payload: { childWorkItemIds, reason: proposal.reason }
  });
  for (const childId of childWorkItemIds) {
    await appendBoardEvent(boardDir, {
      event: "work_ready",
      timestamp: now.toISOString(),
      workItemId: childId,
      payload: { source: "decomposition", parentWorkItemId }
    });
  }

  return { ok: true, childWorkItemIds, errors: [] };
}

/**
 * Check if all children of a parent are Done, and if so transition parent.
 *
 * @param {{ boardDir: string, parentWorkItemId: string, now: Date }} options
 * @returns {Promise<{ ok: boolean, transitioned: boolean, errors: object[] }>}
 */
export async function completeParentWhenChildrenDone({ boardDir, parentWorkItemId, now }) {
  const board = await loadBoard(boardDir);
  const parent = board.workItems.find(w => w.id === parentWorkItemId);
  if (!parent || parent.lane !== "Decomposing") {
    return { ok: true, transitioned: false, errors: [] };
  }

  const childIds = parent.childWorkItemIds ?? [];
  if (childIds.length === 0) {
    return { ok: true, transitioned: false, errors: [] };
  }

  const allDone = childIds.every(id => {
    const child = board.workItems.find(w => w.id === id);
    return child && child.lane === "Done";
  });

  if (!allDone) {
    return { ok: true, transitioned: false, errors: [] };
  }

  parent.lane = "Verifying";
  await saveBoard(boardDir, board);
  await appendBoardEvent(boardDir, {
    event: "work_ready",
    timestamp: now.toISOString(),
    workItemId: parentWorkItemId,
    payload: { source: "children_complete" }
  });

  return { ok: true, transitioned: true, errors: [] };
}

// ── Helpers ───────────────────────────────────────────────────────

function createError(code, reason) {
  return createHarnessError({ code, reason, evidence: ["board.json"], recoverable: true });
}

function normalizePattern(p) {
  return String(p ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

function patternBase(p) {
  const n = normalizePattern(p);
  return n.endsWith("/**") ? n.slice(0, -3) : n;
}

function patternsOverlap(a, b) {
  const ba = patternBase(a);
  const bb = patternBase(b);
  return ba === bb || ba.startsWith(`${bb}/`) || bb.startsWith(`${ba}/`);
}

function isSubsumedByAny(childPath, parentPaths) {
  const childBase = patternBase(childPath);
  return parentPaths.some(parentPath => {
    const parentBase = patternBase(parentPath);
    return childBase === parentBase || childBase.startsWith(`${parentBase}/`);
  });
}

function hasCycle(children) {
  const visited = new Set();
  const stack = new Set();
  const adj = new Map(children.map(c => [c.id, c.dependsOn ?? []]));

  function dfs(id) {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const dep of adj.get(id) ?? []) {
      if (adj.has(dep) && dfs(dep)) return true;
    }
    stack.delete(id);
    return false;
  }

  return children.some(c => dfs(c.id));
}

function findSharedContract(child, dep) {
  if (!dep) return null;
  const depContracts = new Set(dep.contractIds ?? []);
  return (child.dependencyContracts ?? [])
    .find(dc => depContracts.has(dc.contractId))?.contractId ?? null;
}
```

### 2.6 Lane Changes

Modify `src/kanban/lanes.mjs`:

```javascript
export const LANES = [
  "Intake",
  "Discovery",
  "Scoped",
  "Blueprint Bound",
  "Contract Frozen",
  "Ready",
  "Claimed",
  "Running",
  "Decomposing",       // NEW
  "Verifying",
  "Human Review",
  "Done",
  "Failed Fast",
  "Rework",
  "Blocked",
  "Cancelled"
];

export const TRANSITIONS = [
  { from: "Intake", to: "Discovery", requiredGates: [] },
  { from: "Discovery", to: "Scoped", requiredGates: ["prd"] },
  { from: "Scoped", to: "Blueprint Bound", requiredGates: ["blueprint"] },
  { from: "Blueprint Bound", to: "Contract Frozen", requiredGates: ["contract"] },
  { from: "Contract Frozen", to: "Ready", requiredGates: ["design", "contract", "responsibility", "blueprintApproval"] },
  { from: "Ready", to: "Claimed", requiredGates: [] },
  { from: "Claimed", to: "Ready", requiredGates: ["leaseExpired"] },
  { from: "Claimed", to: "Running", requiredGates: [] },
  { from: "Running", to: "Verifying", requiredGates: [] },
  { from: "Running", to: "Decomposing", requiredGates: [] },    // NEW
  { from: "Running", to: "Failed Fast", requiredGates: [] },
  { from: "Decomposing", to: "Verifying", requiredGates: ["childrenComplete"] }, // NEW
  { from: "Failed Fast", to: "Ready", requiredGates: ["retry"] },
  { from: "Verifying", to: "Human Review", requiredGates: ["evidence"] },
  { from: "Verifying", to: "Rework", requiredGates: [] },
  { from: "Rework", to: "Verifying", requiredGates: ["reworkResolved"] },
  { from: "Human Review", to: "Done", requiredGates: ["evidence", "wiki"] }
];
```

### 2.7 Runtime Events

Add to `src/domain/runtime-events.mjs`:

```javascript
// Add "work_decomposed" and "children_complete" to RUNTIME_EVENTS:
export const RUNTIME_EVENTS = new Set([
  // ... existing events ...
  "work_decomposed",     // NEW
  "children_complete"    // NEW
]);
```

### 2.8 Orchestrator Integration

Modify `finishNativeClaudeTask` in `src/orchestrator/orchestrator.mjs`:

After extracting the policyReport (around line 897), add:

```javascript
// Handle NEEDS_DECOMPOSE status
if (policyReport?.status === "NEEDS_DECOMPOSE") {
  const proposal = policyReport.childWorkProposal;
  if (!proposal) {
    return {
      ok: false,
      command: "orchestrator native finish",
      workItemId,
      attemptId,
      errors: [createHarnessError({
        code: "HARNESS_DECOMPOSE_PROPOSAL_MISSING",
        reason: "NEEDS_DECOMPOSE status requires a childWorkProposal object.",
        evidence: ["--result-stdin"],
        recoverable: true
      })]
    };
  }

  const { materializeChildWorkItems } = await import("../board/board-mutator.mjs");
  const result = await materializeChildWorkItems({
    boardDir,
    parentWorkItemId: workItemId,
    proposal,
    now
  });

  if (!result.ok) {
    // Proposal validation failed — move to Failed Fast
    const attemptNumber = (workItem.attemptNumber ?? 0) + 1;
    const dueAt = new Date(now.getTime() + nextBackoffMs(attemptNumber)).toISOString();
    transitionLane(board, workItem.id, "Failed Fast", { gates: {} }, {
      attemptNumber,
      nextRetryAt: dueAt,
      errorCode: result.errors[0]?.code ?? "HARNESS_DECOMPOSE_FAILED",
      errorReason: result.errors[0]?.reason ?? "Decomposition proposal validation failed."
    });
    await saveBoard(boardDir, board);
    await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
    return {
      ok: false,
      command: "orchestrator native finish",
      workItemId,
      attemptId,
      errors: result.errors
    };
  }

  // Update attempt record
  await updateRunAttempt({
    boardDir,
    attemptId,
    patch: {
      status: "decomposed",
      completedAt: now.toISOString(),
      events: [...new Set([...(attempt?.events ?? []), "work_decomposed"])],
      runner: {
        ...(attempt?.runner ?? {}),
        decomposition: {
          childWorkItemIds: result.childWorkItemIds,
          reason: proposal.reason
        }
      }
    }
  });

  const runtimeState = await loadRuntimeState(boardDir);
  clearRunning(runtimeState, workItem.id);
  clearClaimed(runtimeState, workItem.id);
  await saveRuntimeState(boardDir, runtimeState);
  await releaseClaim({ boardDir, workItemId: workItem.id, workerId });

  return {
    ok: true,
    command: "orchestrator native finish",
    workItemId,
    attemptId,
    decomposed: true,
    childWorkItemIds: result.childWorkItemIds,
    events: ["work_decomposed"],
    errors: []
  };
}
```

### 2.9 Sub-Agent Prompt Changes at Depth > 0

When rendering prompts for child work items (depth > 0), add to `renderNativeTaskPrompt`:

```javascript
// In renderNativeTaskPrompt, after the existing rules section for implementation:
const depth = workItem.decompositionDepth ?? 0;
if (depth > 0) {
  prompt += `
Parent work item: ${workItem.parentWorkItemId}
Decomposition depth: ${depth} (max ${MAX_DECOMPOSITION_DEPTH})
${depth >= MAX_DECOMPOSITION_DEPTH
  ? "You are at maximum decomposition depth. Do NOT report NEEDS_DECOMPOSE. You must complete this work item directly."
  : "You may report NEEDS_DECOMPOSE if this is still too large, but depth " + (depth + 1) + " is the limit."}
`;
}
```

### 2.10 Cascading Failure Paths

When a child work item fails:
1. Child moves to "Failed Fast" (existing behavior)
2. Orchestrator retry policy applies (existing exponential backoff)
3. Parent stays in "Decomposing" — it only auto-transitions when ALL children reach Done
4. If a child is permanently stuck (max retries exhausted), parent must be manually moved to "Blocked"

When checking `completeParentWhenChildrenDone`, also check in `reconcileBoard`:

```javascript
// Add to reconcileBoard in orchestrator.mjs, after retry loop:
const { completeParentWhenChildrenDone } = await import("../board/board-mutator.mjs");
for (const workItem of board.workItems) {
  if (workItem.lane === "Decomposing" && (workItem.childWorkItemIds ?? []).length > 0) {
    await completeParentWhenChildrenDone({ boardDir, parentWorkItemId: workItem.id, now });
  }
}
```

### 2.11 Concurrency Model

Child work items follow the SAME dispatch model as top-level work items:
- `getReadyWorkItems(board)` already respects `dependsOn` — children with no dependencies
  are immediately dispatchable
- The `concurrency` parameter to `startNativeClaudeTask` limits how many children run at once
- Children and top-level items compete for the same dispatch slots
- No special priority — first ready, first dispatched

### 2.12 Test Cases

File: `test/needs-decompose.test.mjs`

```javascript
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateChildWorkProposal, materializeChildWorkItems,
         completeParentWhenChildrenDone } from "../src/board/board-mutator.mjs";

describe("validateChildWorkProposal", () => {
  const baseBoard = {
    workItems: [
      { id: "work.parent", lane: "Running", allowedPaths: ["src/auth/**"],
        contractIds: ["contract.auth"], decompositionDepth: 0 }
    ]
  };
  const baseParent = baseBoard.workItems[0];
  const baseArtifacts = { workItemDag: { nodes: [], edges: [] } };

  test("accepts valid 2-child proposal", () => {
    const proposal = {
      reason: "Too complex for single implementation",
      children: [
        { id: "work.child-a", allowedPaths: ["src/auth/hasher/**"],
          contractIds: [], dependsOn: [], verificationCommands: [{ file: "npm", args: ["test"] }],
          doneEvidence: [{ kind: "verification", path: "ev/v.json" }, { kind: "wiki-sync", path: "ev/w.json" }],
          responsibilityUnitId: "ru.a" },
        { id: "work.child-b", allowedPaths: ["src/auth/api/**"],
          contractIds: [], dependsOn: ["work.child-a"], verificationCommands: [{ file: "npm", args: ["test"] }],
          doneEvidence: [{ kind: "verification", path: "ev/v2.json" }, { kind: "wiki-sync", path: "ev/w2.json" }],
          responsibilityUnitId: "ru.b" }
      ]
    };
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(result.ok, result.errors.map(e => e.reason).join("; "));
  });

  test("rejects depth > MAX", () => {
    const proposal = { reason: "Split needed", children: [
      { id: "c1", allowedPaths: ["src/auth/x/**"], contractIds: [], dependsOn: [],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a" }, { kind: "wiki-sync", path: "b" }],
        responsibilityUnitId: "ru.x" }
    ]};
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: { ...baseParent, decompositionDepth: 2 },
      board: baseBoard, artifacts: baseArtifacts, depth: 2
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_DEPTH_EXCEEDED"));
  });

  test("rejects overlapping child paths", () => {
    const proposal = { reason: "Split needed", children: [
      { id: "c1", allowedPaths: ["src/auth/**"], contractIds: [], dependsOn: [],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a" }, { kind: "wiki-sync", path: "b" }],
        responsibilityUnitId: "ru.x" },
      { id: "c2", allowedPaths: ["src/auth/**"], contractIds: [], dependsOn: [],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a2" }, { kind: "wiki-sync", path: "b2" }],
        responsibilityUnitId: "ru.y" }
    ]};
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_PATH_OVERLAP"));
  });

  test("rejects child path outside parent", () => {
    const proposal = { reason: "Split needed", children: [
      { id: "c1", allowedPaths: ["src/billing/**"], contractIds: [], dependsOn: [],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a" }, { kind: "wiki-sync", path: "b" }],
        responsibilityUnitId: "ru.x" }
    ]};
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_PATH_OUTSIDE_PARENT"));
  });

  test("rejects cyclic children dependencies", () => {
    const proposal = { reason: "Split needed", children: [
      { id: "c1", allowedPaths: ["src/auth/a/**"], dependsOn: ["c2"],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a" }, { kind: "wiki-sync", path: "b" }],
        responsibilityUnitId: "ru.x" },
      { id: "c2", allowedPaths: ["src/auth/b/**"], dependsOn: ["c1"],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a2" }, { kind: "wiki-sync", path: "b2" }],
        responsibilityUnitId: "ru.y" }
    ]};
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CYCLE"));
  });

  test("rejects duplicate child id", () => {
    const proposal = { reason: "Split needed", children: [
      { id: "c1", allowedPaths: ["src/auth/a/**"], dependsOn: [],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a" }, { kind: "wiki-sync", path: "b" }],
        responsibilityUnitId: "ru.x" },
      { id: "c1", allowedPaths: ["src/auth/b/**"], dependsOn: [],
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [{ kind: "verification", path: "a2" }, { kind: "wiki-sync", path: "b2" }],
        responsibilityUnitId: "ru.y" }
    ]};
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CHILD_ID_DUPLICATE"));
  });
});
```

File: `test/board-mutator.test.mjs` — Tests for `materializeChildWorkItems` and
`completeParentWhenChildrenDone` using the `withFixture` helper pattern from existing tests.

---

## SPEC 3: PLUGIN ARCHITECTURE — Init, Config, Demo, Sync

### 3.1 Overview

Implement `npx makeitreal init`, `makeitreal.config.json` extended schema,
`/makeitreal:demo` command, and the updated plugin sync pipeline.

### 3.2 New Files

```
src/cli/init.mjs                         — npx makeitreal init implementation
src/cli/demo.mjs                         — /makeitreal:demo template generator
examples/demo-templates/todo-app/         — Baked-in todo-app demo fixtures
examples/demo-templates/auth-system/      — Baked-in auth-system demo fixtures
test/init.test.mjs                        — Tests for init flow
test/demo.test.mjs                        — Tests for demo command
```

### 3.3 Modified Files

```
src/config/project-config.mjs            — Extended config schema
bin/harness.mjs                          — Add init and demo commands
scripts/sync-plugin-engine.mjs           — Updated sync list
```

### 3.4 npx makeitreal init

File: `src/cli/init.mjs`

```javascript
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { initializeProject } from "../project/bootstrap.mjs";
import { installClaudeHooks } from "../hooks/claude-settings.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";
import { detectTestFramework } from "../contracts/test-framework-detect.mjs";

/**
 * Detect project characteristics for smart defaults.
 *
 * @param {{ projectRoot: string }} options
 * @returns {Promise<{
 *   name: string | null,
 *   hasPackageJson: boolean,
 *   framework: string | null,
 *   testFramework: string,
 *   hasTypeScript: boolean,
 *   hasSrcDir: boolean,
 *   detectedPatterns: string[]
 * }>}
 */
export async function detectProject({ projectRoot }) {
  const pkgPath = path.join(projectRoot, "package.json");
  let pkg = null;
  const hasPackageJson = await fileExists(pkgPath);
  if (hasPackageJson) {
    pkg = await readJsonFile(pkgPath);
  }

  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const patterns = [];

  // Framework detection
  let framework = null;
  if (deps.next) { framework = "nextjs"; patterns.push("Next.js"); }
  else if (deps.express) { framework = "express"; patterns.push("Express"); }
  else if (deps.fastify) { framework = "fastify"; patterns.push("Fastify"); }
  else if (deps.react && !deps.next) { framework = "react"; patterns.push("React SPA"); }
  else if (deps.vue) { framework = "vue"; patterns.push("Vue"); }
  else if (deps.svelte || deps["@sveltejs/kit"]) { framework = "svelte"; patterns.push("Svelte"); }

  // Test framework
  const testFw = await detectTestFramework({ projectRoot });
  patterns.push(`Tests: ${testFw.framework}`);

  // TypeScript
  const hasTS = Boolean(deps.typescript)
    || await fileExists(path.join(projectRoot, "tsconfig.json"));
  if (hasTS) patterns.push("TypeScript");

  // Src directory
  const hasSrcDir = await dirExists(path.join(projectRoot, "src"));
  if (hasSrcDir) patterns.push("src/ directory");

  return {
    name: pkg?.name ?? path.basename(projectRoot),
    hasPackageJson,
    framework,
    testFramework: testFw.framework,
    hasTypeScript: hasTS,
    hasSrcDir,
    detectedPatterns: patterns
  };
}

async function dirExists(dirPath) {
  try { return (await stat(dirPath)).isDirectory(); } catch { return false; }
}

/**
 * Run the full init flow.
 *
 * @param {{
 *   projectRoot: string,
 *   skipHooks?: boolean,
 *   now?: Date
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   command: "init",
 *   projectRoot: string,
 *   detection: object,
 *   configPath: string,
 *   gitignoreUpdated: boolean,
 *   hooksInstalled: boolean,
 *   errors: object[],
 *   nextAction: string
 * }>}
 */
export async function runInit({ projectRoot, skipHooks = false, now = new Date() }) {
  const resolvedRoot = path.resolve(projectRoot);

  // 1. Detect project
  const detection = await detectProject({ projectRoot: resolvedRoot });

  // 2. Initialize project (creates .makeitreal/, config, .gitignore)
  const init = await initializeProject({ projectRoot: resolvedRoot, now });
  if (!init.ok) {
    return {
      ok: false,
      command: "init",
      projectRoot: resolvedRoot,
      detection,
      configPath: init.config?.configPath ?? null,
      gitignoreUpdated: false,
      hooksInstalled: false,
      errors: init.errors,
      nextAction: "Fix the errors above and retry."
    };
  }

  // 3. Install Claude hooks (unless skipped)
  let hooksInstalled = false;
  if (!skipHooks) {
    try {
      // Claude hooks need a run dir. Since no run exists yet, skip hook installation
      // but inform user they'll be installed on first plan.
      hooksInstalled = false;
    } catch {
      hooksInstalled = false;
    }
  }

  return {
    ok: true,
    command: "init",
    projectRoot: resolvedRoot,
    detection,
    configPath: init.config?.configPath ?? null,
    gitignoreUpdated: init.gitignore?.updated ?? false,
    hooksInstalled,
    errors: [],
    nextAction: "/makeitreal:plan <describe what you want to build>"
  };
}
```

### 3.5 makeitreal.config.json Extended Schema

Modify `src/config/project-config.mjs` to add new fields:

```javascript
// Extended DEFAULT_CONFIG:
export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: "1.2",
  features: Object.freeze({
    liveWiki: Object.freeze({ enabled: true }),
    dashboard: Object.freeze({
      autoOpen: true,
      refreshOnStatus: true,
      refreshOnLaunch: true,
      refreshOnVerify: true
    }),
    contracts: Object.freeze({
      autoScaffoldTests: true,
      requireContractsForReady: true
    }),
    decomposition: Object.freeze({
      maxDepth: 2,
      maxChildrenPerProposal: 8,
      autoDispatchChildren: true
    })
  }),
  blueprintEngine: Object.freeze({
    mode: "auto",         // "auto" | "claude" | "regex"
    fallbackToRegex: true
  })
});

// Add to ROOT_KEYS:
const ROOT_KEYS = new Set(["schemaVersion", "features", "blueprintEngine"]);

// Add to FEATURE_KEYS:
const FEATURE_KEYS = new Set(["liveWiki", "dashboard", "contracts", "decomposition"]);
```

The validator must be backward-compatible: existing configs with schemaVersion "1.0" or
"1.1" are accepted and get defaults for new fields.

### 3.6 /makeitreal:demo Command

File: `src/cli/demo.mjs`

```javascript
import path from "node:path";
import { mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_TEMPLATES_DIR = path.resolve(__dirname, "../../examples/demo-templates");

const AVAILABLE_TEMPLATES = ["todo-app", "auth-system"];

/**
 * Generate a demo blueprint from a baked-in template.
 *
 * @param {{
 *   template: string,
 *   outputDir: string,
 *   now?: Date
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   command: "demo",
 *   template: string,
 *   outputDir: string,
 *   artifactCount: number,
 *   errors: object[],
 *   nextAction: string
 * }>}
 */
export async function runDemo({ template, outputDir, now = new Date() }) {
  if (!AVAILABLE_TEMPLATES.includes(template)) {
    return {
      ok: false,
      command: "demo",
      template,
      outputDir,
      artifactCount: 0,
      errors: [{
        code: "HARNESS_DEMO_TEMPLATE_UNKNOWN",
        reason: `Unknown demo template: ${template}. Available: ${AVAILABLE_TEMPLATES.join(", ")}`,
        evidence: ["--template"]
      }],
      nextAction: `Choose one of: ${AVAILABLE_TEMPLATES.join(", ")}`
    };
  }

  const templateDir = path.join(DEMO_TEMPLATES_DIR, template);
  const targetDir = path.join(path.resolve(outputDir), ".makeitreal", "runs", `demo-${template}`);

  await mkdir(targetDir, { recursive: true });
  await cp(templateDir, targetDir, { recursive: true });

  return {
    ok: true,
    command: "demo",
    template,
    outputDir: targetDir,
    artifactCount: 7,  // prd, design-pack, responsibility-units, work-item-dag, contracts/, work-items/, board.json
    errors: [],
    nextAction: `/makeitreal:status --run-dir ${targetDir}`
  };
}
```

### 3.7 Demo Template: todo-app

Directory: `examples/demo-templates/todo-app/`

This is a pre-generated set of MIR artifacts for a simple CRUD todo app.
Files to create (all JSON, using patterns from the canonical fixture):

```
examples/demo-templates/todo-app/prd.json
examples/demo-templates/todo-app/design-pack.json
examples/demo-templates/todo-app/responsibility-units.json
examples/demo-templates/todo-app/work-item-dag.json
examples/demo-templates/todo-app/board.json
examples/demo-templates/todo-app/blueprint-review.json
examples/demo-templates/todo-app/contracts/todo-crud.openapi.json
examples/demo-templates/todo-app/contracts/todo-store.module-io.json
examples/demo-templates/todo-app/work-items/work.todo-api.json
examples/demo-templates/todo-app/work-items/work.todo-store.json
examples/demo-templates/todo-app/work-items/work.todo-pm.json
```

Example `prd.json`:
```json
{
  "schemaVersion": "1.0",
  "id": "prd.todo-app",
  "title": "Todo CRUD Application",
  "summary": "A simple REST API for managing todo items with create, read, update, delete operations.",
  "acceptanceCriteria": [
    { "id": "AC-001", "description": "POST /todos creates a new todo and returns 201" },
    { "id": "AC-002", "description": "GET /todos returns all todos as an array" },
    { "id": "AC-003", "description": "PUT /todos/:id updates a todo and returns 200" },
    { "id": "AC-004", "description": "DELETE /todos/:id removes a todo and returns 204" }
  ]
}
```

Example `contracts/todo-crud.openapi.json`:
```json
{
  "openapi": "3.1.0",
  "info": { "title": "Todo CRUD Contract", "version": "1.0.0" },
  "paths": {
    "/todos": {
      "get": {
        "operationId": "listTodos",
        "responses": {
          "200": {
            "description": "All todos",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": { "type": "string" },
                      "title": { "type": "string" },
                      "completed": { "type": "boolean" }
                    },
                    "required": ["id", "title", "completed"]
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "operationId": "createTodo",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "title": { "type": "string" }
                },
                "required": ["title"]
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "completed": { "type": "boolean" }
                  },
                  "required": ["id", "title", "completed"]
                }
              }
            }
          },
          "400": { "description": "Missing title" }
        }
      }
    }
  }
}
```

Example `contracts/todo-store.module-io.json`:
```json
{
  "schemaVersion": "1.0",
  "kind": "module-io",
  "contractId": "contract.todo.store",
  "modulePath": "src/store/todo-store.mjs",
  "exports": [
    {
      "name": "createTodo",
      "kind": "function",
      "async": true,
      "inputs": [{ "name": "title", "type": "string", "required": true }],
      "output": { "type": "object", "properties": { "id": {}, "title": {}, "completed": {} } },
      "errors": [{ "code": "TITLE_EMPTY", "when": "title is empty string" }],
      "examples": [{ "input": { "title": "Buy milk" }, "output": { "id": "1", "title": "Buy milk", "completed": false } }]
    },
    {
      "name": "listTodos",
      "kind": "function",
      "async": true,
      "inputs": [],
      "output": { "type": "array" },
      "errors": [],
      "examples": []
    }
  ]
}
```

### 3.8 Plugin Sync Changes

The `scripts/sync-plugin-engine.mjs` currently copies src/ to plugins/makeitreal/dev-harness/src/.
Update the file list to include new modules:

```javascript
// Add to the sync file list in sync-plugin-engine.mjs:
const ADDITIONAL_SYNC_PATHS = [
  "src/contracts/test-scaffold.mjs",
  "src/contracts/test-framework-detect.mjs",
  "src/contracts/test-setup-convention.mjs",
  "src/contracts/kinds/module-io.mjs",
  "src/contracts/kinds/component.mjs",
  "src/contracts/kinds/event.mjs",
  "src/contracts/kinds/migration.mjs",
  "src/contracts/integration-stubs.mjs",
  "src/board/board-mutator.mjs",
  "src/cli/init.mjs",
  "src/cli/demo.mjs",
  "examples/demo-templates/"
];
```

### 3.9 bin/harness.mjs Changes

Add new CLI commands:

```javascript
// In the command dispatch section of bin/harness.mjs:

case "init": {
  const { runInit } = await import("../src/cli/init.mjs");
  const result = await runInit({
    projectRoot: args[0] ?? process.cwd(),
    skipHooks: flags.includes("--skip-hooks")
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
}

case "demo": {
  const { runDemo } = await import("../src/cli/demo.mjs");
  const template = args[0] ?? "todo-app";
  const result = await runDemo({
    template,
    outputDir: args[1] ?? process.cwd()
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
}
```

### 3.10 Test Cases

File: `test/init.test.mjs`

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInit, detectProject } from "../src/cli/init.mjs";
import { fileExists } from "../src/io/json.mjs";

test("init creates .makeitreal directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mir-init-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "test" }));
  const result = await runInit({ projectRoot: dir });
  assert.ok(result.ok);
  assert.ok(await fileExists(path.join(dir, ".makeitreal", "config.json")));
  await rm(dir, { recursive: true });
});

test("init adds .makeitreal to .gitignore", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mir-init-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "test" }));
  await writeFile(path.join(dir, ".gitignore"), "node_modules/\n");
  const result = await runInit({ projectRoot: dir });
  assert.ok(result.ok);
  assert.ok(result.gitignoreUpdated);
  await rm(dir, { recursive: true });
});

test("detectProject identifies Express", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mir-detect-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    dependencies: { express: "^4.0.0" }
  }));
  const result = await detectProject({ projectRoot: dir });
  assert.strictEqual(result.framework, "express");
  await rm(dir, { recursive: true });
});

test("detectProject handles missing package.json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mir-detect-"));
  const result = await detectProject({ projectRoot: dir });
  assert.strictEqual(result.hasPackageJson, false);
  assert.strictEqual(result.testFramework, "node:test");
  await rm(dir, { recursive: true });
});
```

File: `test/demo.test.mjs`

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDemo } from "../src/cli/demo.mjs";
import { fileExists } from "../src/io/json.mjs";

test("demo generates todo-app fixtures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mir-demo-"));
  const result = await runDemo({ template: "todo-app", outputDir: dir });
  assert.ok(result.ok);
  assert.ok(await fileExists(path.join(result.outputDir, "prd.json")));
  assert.ok(await fileExists(path.join(result.outputDir, "work-item-dag.json")));
  await rm(dir, { recursive: true });
});

test("demo rejects unknown template", async () => {
  const result = await runDemo({ template: "nonexistent", outputDir: "/tmp" });
  assert.ok(!result.ok);
  assert.ok(result.errors[0].code === "HARNESS_DEMO_TEMPLATE_UNKNOWN");
});
```

---

## SPEC 4: DOCUMENTATION — Content Generation

### 4.1 Overview

Create the actual documentation content: README.md, concept docs, comparison table,
and 3 example blueprint walkthroughs.

### 4.2 Files to Create

```
README.md                                — Project README
docs/getting-started.md                  — Install + first run guide
docs/how-it-works.md                     — Pipeline walkthrough
docs/concepts/blueprints.md              — What blueprints are
docs/concepts/contracts.md               — Contract kinds and enforcement
docs/concepts/responsibility-units.md    — Boundaries and ownership
docs/concepts/kanban.md                  — Lane lifecycle
docs/concepts/orchestration.md           — Sub-agents and task dispatch
docs/api-reference.md                    — CLI command reference
docs/troubleshooting.md                  — Common errors + recovery
```

### 4.3 README.md Structure and Content

File: `README.md`

The README must follow this exact structure with these sections:

```markdown
# Make It Real 🏗️

**Blueprint-first development for Claude Code.** Give it a goal, it architects the
solution, decomposes it into a DAG of scoped sub-agent tasks with contracts, and
every unit test passes because contracts guarantee integration.

> "Unit Test = QA" — when contracts define the interface and tests are derived FROM
> the contracts, passing unit tests proves the system works.

<!-- TODO: Add asciinema GIF here once recorded -->

## The Problem

When you tell Claude Code "build an auth system with email/password", it:
- Dumps everything into one file
- Invents its own architecture on the fly
- Has no concept of module boundaries
- Writes tests that test implementation details, not contracts
- Can't parallelize — one long serial session

## The Solution: Blueprint First

Make It Real interposes a planning phase:

1. **Blueprint** — Claude (or deterministic fallback) generates an architecture:
   responsibility units, module interfaces, contracts, and a work item DAG
2. **Contracts** — OpenAPI specs, module-io function signatures, component props,
   event schemas — each frozen before implementation begins
3. **Decompose** — The DAG defines which sub-agents work on what, in what order,
   with explicit dependency edges
4. **Implement** — Each sub-agent gets: allowed file paths, contracts to satisfy,
   pre-generated test scaffolds, and nothing else
5. **Verify** — Gate system enforces: tests pass, exports match contracts,
   files stay within boundaries, wiki is updated

## Quick Start

```bash
# In any project directory:
npx makeitreal init

# In Claude Code:
/makeitreal:plan "build auth with email/password and JWT tokens"
/makeitreal:approve
/makeitreal:launch
/makeitreal:dashboard
```

## Comparison

| Capability | Vanilla Claude Code | Cursor | Make It Real |
|---|---|---|---|
| Architecture planning before code | ❌ ad-hoc | ❌ ad-hoc | ✅ Blueprint first |
| Contract enforcement | ❌ | ❌ | ✅ OpenAPI + module-io + component + event |
| Parallel sub-agents | ❌ serial only | ❌ serial | ✅ DAG-ordered parallel dispatch |
| File boundary enforcement | ❌ edits anything | ❌ | ✅ allowedPaths per work item |
| Contract-derived tests | ❌ | ❌ | ✅ auto-generated from contracts |
| Recursive decomposition | ❌ | ❌ | ✅ NEEDS_DECOMPOSE protocol |
| Live progress dashboard | ❌ | ❌ | ✅ React Flow + WebSocket |
| Reproducible builds | ❌ | ❌ | ✅ Blueprint fingerprinting |
| Integration verification | ❌ | ❌ | ✅ Cross-boundary test stubs |

## Key Concepts

- **[Blueprints](docs/concepts/blueprints.md)** — The architecture plan
- **[Contracts](docs/concepts/contracts.md)** — Interface specifications
- **[Responsibility Units](docs/concepts/responsibility-units.md)** — Ownership boundaries
- **[Kanban Lifecycle](docs/concepts/kanban.md)** — How work items flow
- **[Orchestration](docs/concepts/orchestration.md)** — Sub-agent dispatch

## Examples

- **[Todo App](examples/demo-templates/todo-app/)** — Simple CRUD, 2 work items,
  OpenAPI + module-io contracts
- **[Auth System](examples/demo-templates/auth-system/)** — 4-node DAG with
  cross-boundary contracts, password hasher + API + session store
- **[Canonical Fixture](examples/canonical/)** — The test fixture used by the
  engine's own test suite

## CLI Reference

```
makeitreal-engine plan <request> [--verify <cmd>] [--offline]
makeitreal-engine design render <runDir>
makeitreal-engine contracts openapi <runDir>
makeitreal-engine gate <runDir> --target <Ready|Done>
makeitreal-engine verify <runDir>
makeitreal-engine wiki sync <runDir>
makeitreal-engine status <runDir>
makeitreal-engine orchestrator native start <runDir>
makeitreal-engine orchestrator native finish <runDir> --work-item <id> --attempt <id>
makeitreal-engine doctor
makeitreal-engine init [projectRoot]
makeitreal-engine demo <template> [outputDir]
```

## Architecture

```
User → Plugin (slash commands) → Blueprint Engine → Contracts
  → Gate System → Orchestrator → Sub-agents → Verification → Done
```

## License

MIT
```

### 4.4 Concept Docs Content

Each concept doc follows this template:
- What it is (1 paragraph)
- Why it matters (1 paragraph)
- How it works (detailed, with JSON examples from the codebase)
- How to customize (configuration options)

#### docs/concepts/blueprints.md

Content must cover:
- What a blueprint is: a set of JSON artifacts (prd.json, design-pack.json, responsibility-units.json, contracts/*.json, work-items/*.json, work-item-dag.json)
- The generation pipeline: request → classify → profile → emit → validate → approve
- Blueprint approval flow (blueprint-review.json with decision: "approved")
- Blueprint fingerprinting (src/blueprint/fingerprint.mjs)
- Example: show the actual prd.json and design-pack.json from examples/canonical/

#### docs/concepts/contracts.md

Content must cover:
- The 5 contract kinds: openapi, module-io, component, event, migration
- How contracts are validated (gate system, src/gates/index.mjs)
- How conformance is checked (openapi-conformance.mjs, module-surface-conformance.mjs)
- "Unit Test = QA" explanation with concrete example
- How contract-derived test scaffolds work
- Example: show the auth-login.openapi.json and the test scaffold it generates

#### docs/concepts/responsibility-units.md

Content must cover:
- What an RU is (owner, allowedPaths, mustProvideContracts)
- How path enforcement works (pre-tool-use hook, validateChangedPaths)
- No overlapping ownership rule
- How RUs map to work items
- Example: show responsibility-units.json from canonical fixture

#### docs/concepts/kanban.md

Content must cover:
- All 16 lanes (including new Decomposing lane)
- All transitions with required gates
- The gate system (Ready gate, Done gate)
- State engine (src/kanban/state-engine.mjs)
- Lane lifecycle diagram (ASCII)

#### docs/concepts/orchestration.md

Content must cover:
- orchestratorTick vs startNativeClaudeTask
- Completion policies (3 node kinds)
- Native role mapping (implementation-worker, reviewers)
- Review evidence flow
- NEEDS_DECOMPOSE protocol
- Retry with exponential backoff
- Concurrency model

### 4.5 docs/troubleshooting.md

Must cover these 10 error codes with causes and fixes:

1. `HARNESS_CLAUDE_HOOKS_MISSING` — hooks not installed → run /makeitreal:setup
2. `HARNESS_VERIFICATION_PLAN_MISSING` — no verification commands → add --verify flag
3. `HARNESS_PATH_BOUNDARY_VIOLATION` — sub-agent edited wrong files → check allowedPaths
4. `HARNESS_AGENT_REPORT_MISSING` — sub-agent didn't emit report JSON → check prompt format
5. `HARNESS_CONTRACT_MISSING` — work item references undeclared contract → fix design-pack
6. `HARNESS_DAG_CYCLE` — circular dependency in work items → fix dependsOn
7. `HARNESS_PREVIEW_MISSING` — no dashboard HTML → run design render
8. `HARNESS_CLAUDE_BINARY_MISSING` — claude CLI not found → install Claude Code
9. `HARNESS_READY_PROMOTION_INVALID` — artifacts malformed → check run directory
10. `HARNESS_REVIEW_REJECTED` — reviewer rejected work → address findings

Each entry format:
```
### HARNESS_CLAUDE_HOOKS_MISSING

**Cause:** Claude Code hooks are not installed in .claude/settings.local.json.

**Fix:**
1. Run `/makeitreal:setup` to install hooks
2. Or manually: `makeitreal-engine hooks install`
3. Verify: `makeitreal-engine doctor`

**Related:** [Plugin Architecture](../concepts/orchestration.md)
```

### 4.6 Example Blueprint Walkthroughs

Each example in `examples/demo-templates/` needs a `WALKTHROUGH.md`:

```markdown
# Todo App — Blueprint Walkthrough

## Request
"Build a REST API for managing todo items with CRUD operations"

## Generated Blueprint

### Architecture
- 2 responsibility units: `ru.todo-api` (HTTP endpoints) and `ru.todo-store` (data layer)
- 1 OpenAPI contract: `todo-crud.openapi.json`
- 1 module-io contract: `todo-store.module-io.json`

### Work Item DAG
```
[work.todo-pm] ──coordination──→ [work.todo-store] ──contract-dependency──→ [work.todo-api]
```

### Contract Surface
The OpenAPI contract defines: GET /todos, POST /todos (201/400), PUT /todos/:id, DELETE /todos/:id
The module-io contract defines: createTodo(title) → Todo, listTodos() → Todo[]

### What Sub-Agents Do
1. **work.todo-pm** (domain-pm): Validates the split is correct
2. **work.todo-store** (implementation): Implements the in-memory store
3. **work.todo-api** (implementation): Implements Express routes consuming the store

### Run It
```bash
makeitreal-engine demo todo-app .
makeitreal-engine design render .makeitreal/runs/demo-todo-app
makeitreal-engine gate .makeitreal/runs/demo-todo-app --target Ready
```
```

### 4.7 Test Cases

File: `test/docs-examples.test.mjs`

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;

test("README.md exists and has required sections", async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("## Quick Start"));
  assert.ok(readme.includes("## Comparison"));
  assert.ok(readme.includes("## Key Concepts"));
  assert.ok(readme.includes("## Examples"));
  assert.ok(readme.includes("npx makeitreal init"));
});

test("all concept docs exist", async () => {
  const docs = [
    "docs/concepts/blueprints.md",
    "docs/concepts/contracts.md",
    "docs/concepts/responsibility-units.md",
    "docs/concepts/kanban.md",
    "docs/concepts/orchestration.md"
  ];
  for (const doc of docs) {
    const s = await stat(path.join(ROOT, doc));
    assert.ok(s.isFile(), `${doc} must exist`);
    assert.ok(s.size > 500, `${doc} must have substantial content`);
  }
});

test("troubleshooting doc covers 10 error codes", async () => {
  const content = await readFile(path.join(ROOT, "docs/troubleshooting.md"), "utf8");
  const codes = [
    "HARNESS_CLAUDE_HOOKS_MISSING",
    "HARNESS_VERIFICATION_PLAN_MISSING",
    "HARNESS_PATH_BOUNDARY_VIOLATION",
    "HARNESS_AGENT_REPORT_MISSING",
    "HARNESS_CONTRACT_MISSING",
    "HARNESS_DAG_CYCLE",
    "HARNESS_PREVIEW_MISSING",
    "HARNESS_CLAUDE_BINARY_MISSING",
    "HARNESS_READY_PROMOTION_INVALID",
    "HARNESS_REVIEW_REJECTED"
  ];
  for (const code of codes) {
    assert.ok(content.includes(code), `troubleshooting must cover ${code}`);
  }
});

test("demo template todo-app has all required files", async () => {
  const files = ["prd.json", "design-pack.json", "work-item-dag.json",
    "responsibility-units.json", "board.json"];
  for (const file of files) {
    const s = await stat(path.join(ROOT, "examples/demo-templates/todo-app", file));
    assert.ok(s.isFile());
  }
});
```

---

## SPEC 5: ERROR RECOVERY — Resume, Cost Estimation, Enhanced Doctor

### 5.1 Overview

Implement error recovery for:
- Sub-agent failures mid-run (graceful degradation)
- Terminal close / session interruption (resume from last state)
- Cost estimation before Claude API calls
- Enhanced doctor command with recovery suggestions

### 5.2 New Files

```
src/recovery/resume.mjs                  — Resume interrupted runs
src/recovery/cost-estimator.mjs          — Estimate Claude API costs
src/recovery/session-checkpoint.mjs      — Checkpoint session state
test/recovery-resume.test.mjs            — Tests for resume logic
test/cost-estimator.test.mjs             — Tests for cost estimation
```

### 5.3 Modified Files

```
src/diagnostics/doctor.mjs               — Enhanced recovery diagnostics
src/orchestrator/orchestrator.mjs        — Checkpoint after each state change
bin/harness.mjs                          — Add resume command
```

### 5.4 Session Checkpoint

File: `src/recovery/session-checkpoint.mjs`

```javascript
import path from "node:path";
import { writeJsonFile, readJsonFile, fileExists } from "../io/json.mjs";
import { loadBoard } from "../board/board-store.mjs";

const CHECKPOINT_FILE = "session-checkpoint.json";

/**
 * @typedef {{
 *   schemaVersion: string,
 *   sessionId: string,
 *   startedAt: string,
 *   lastCheckpointAt: string,
 *   phase: "planning" | "approval" | "launching" | "running" | "verifying" | "done" | "failed",
 *   runDir: string,
 *   projectRoot: string,
 *   workItemStates: Array<{ id: string, lane: string, attemptCount: number }>,
 *   pendingActions: string[],
 *   costEstimate: { inputTokens: number, outputTokens: number, estimatedUsd: number } | null,
 *   errors: object[]
 * }} SessionCheckpoint
 */

/**
 * Save a checkpoint of the current session state.
 *
 * @param {{
 *   boardDir: string,
 *   phase: string,
 *   projectRoot: string,
 *   sessionId?: string,
 *   costEstimate?: object,
 *   now?: Date
 * }} options
 * @returns {Promise<{ ok: boolean, checkpointPath: string, errors: object[] }>}
 */
export async function saveCheckpoint({ boardDir, phase, projectRoot, sessionId, costEstimate, now = new Date() }) {
  const checkpointPath = path.join(boardDir, CHECKPOINT_FILE);
  const existing = await fileExists(checkpointPath) ? await readJsonFile(checkpointPath) : null;

  let board;
  try {
    board = await loadBoard(boardDir);
  } catch {
    board = { workItems: [] };
  }

  const checkpoint = {
    schemaVersion: "1.0",
    sessionId: sessionId ?? existing?.sessionId ?? `session-${now.getTime()}`,
    startedAt: existing?.startedAt ?? now.toISOString(),
    lastCheckpointAt: now.toISOString(),
    phase,
    runDir: boardDir,
    projectRoot,
    workItemStates: (board.workItems ?? []).map(wi => ({
      id: wi.id,
      lane: wi.lane,
      attemptCount: wi.attemptNumber ?? 0
    })),
    pendingActions: derivePendingActions(phase, board),
    costEstimate: costEstimate ?? existing?.costEstimate ?? null,
    errors: []
  };

  await writeJsonFile(checkpointPath, checkpoint);
  return { ok: true, checkpointPath, errors: [] };
}

/**
 * Load the most recent checkpoint.
 *
 * @param {{ boardDir: string }} options
 * @returns {Promise<{ ok: boolean, checkpoint: SessionCheckpoint | null, errors: object[] }>}
 */
export async function loadCheckpoint({ boardDir }) {
  const checkpointPath = path.join(boardDir, CHECKPOINT_FILE);
  if (!await fileExists(checkpointPath)) {
    return { ok: false, checkpoint: null, errors: [{
      code: "HARNESS_CHECKPOINT_MISSING",
      reason: "No session checkpoint found. Nothing to resume.",
      evidence: [checkpointPath]
    }]};
  }
  const checkpoint = await readJsonFile(checkpointPath);
  return { ok: true, checkpoint, errors: [] };
}

function derivePendingActions(phase, board) {
  const actions = [];
  switch (phase) {
    case "planning":
      actions.push("/makeitreal:plan — generate or regenerate the blueprint");
      break;
    case "approval":
      actions.push("/makeitreal:approve — approve the current blueprint");
      break;
    case "launching":
      actions.push("/makeitreal:launch — start sub-agent execution");
      break;
    case "running": {
      const failed = (board.workItems ?? []).filter(w => w.lane === "Failed Fast");
      const running = (board.workItems ?? []).filter(w => w.lane === "Running");
      if (failed.length > 0) {
        actions.push(`${failed.length} work item(s) in Failed Fast — will auto-retry`);
      }
      if (running.length > 0) {
        actions.push(`${running.length} work item(s) still running — /makeitreal:status to check`);
      }
      actions.push("/makeitreal:launch — dispatch next ready work items");
      break;
    }
    case "verifying":
      actions.push("/makeitreal:status — check verification results");
      actions.push("makeitreal-engine gate <runDir> --target Done");
      break;
    case "done":
      actions.push("All work items complete!");
      break;
    case "failed":
      actions.push("/makeitreal:doctor — diagnose the failure");
      actions.push("/makeitreal:status — see current state");
      break;
  }
  return actions;
}
```

### 5.5 Resume Command

File: `src/recovery/resume.mjs`

```javascript
import path from "node:path";
import { loadCheckpoint } from "./session-checkpoint.mjs";
import { loadBoard } from "../board/board-store.mjs";
import { reconcileBoard } from "../orchestrator/orchestrator.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";

/**
 * Resume an interrupted run from the last checkpoint.
 *
 * This command:
 * 1. Loads the session checkpoint
 * 2. Reconciles board state (releases expired claims, retries due items)
 * 3. Determines the current phase
 * 4. Returns actionable next steps
 *
 * @param {{
 *   boardDir: string,
 *   now?: Date
 * }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   command: "resume",
 *   phase: string,
 *   checkpoint: object | null,
 *   reconciliation: object | null,
 *   staleWorkItems: string[],
 *   nextActions: string[],
 *   errors: object[]
 * }>}
 */
export async function resumeRun({ boardDir, now = new Date() }) {
  // 1. Load checkpoint
  const checkpointResult = await loadCheckpoint({ boardDir });

  // 2. Reconcile board (release stale claims, retry due items)
  let reconciliation = null;
  try {
    reconciliation = await reconcileBoard({ boardDir, now });
  } catch (error) {
    return {
      ok: false,
      command: "resume",
      phase: "unknown",
      checkpoint: checkpointResult.checkpoint,
      reconciliation: null,
      staleWorkItems: [],
      nextActions: ["/makeitreal:doctor"],
      errors: [{
        code: "HARNESS_RESUME_RECONCILE_FAILED",
        reason: `Board reconciliation failed: ${error.message}`,
        evidence: ["board.json"]
      }]
    };
  }

  // 3. Determine current phase from board state
  const board = await loadBoard(boardDir);
  const phase = determinePhase(board);
  const staleWorkItems = findStaleWorkItems(board, now);
  const nextActions = deriveNextActions(phase, board, staleWorkItems);

  return {
    ok: true,
    command: "resume",
    phase,
    checkpoint: checkpointResult.checkpoint,
    reconciliation: {
      releasedClaims: reconciliation.releasedClaimWorkItemIds?.length ?? 0,
      retriedItems: reconciliation.retryReadyWorkItemIds?.length ?? 0
    },
    staleWorkItems,
    nextActions,
    errors: []
  };
}

function determinePhase(board) {
  const items = board.workItems ?? [];
  if (items.length === 0) return "planning";
  if (items.every(w => w.lane === "Done")) return "done";
  if (items.some(w => w.lane === "Running" || w.lane === "Claimed")) return "running";
  if (items.some(w => w.lane === "Verifying" || w.lane === "Human Review")) return "verifying";
  if (items.some(w => w.lane === "Ready")) return "launching";
  if (items.every(w => w.lane === "Contract Frozen")) return "approval";
  if (items.some(w => w.lane === "Failed Fast" || w.lane === "Blocked")) return "failed";
  return "planning";
}

function findStaleWorkItems(board, now) {
  const staleThreshold = 30 * 60 * 1000; // 30 minutes
  return (board.workItems ?? [])
    .filter(w => w.lane === "Running" || w.lane === "Claimed")
    .filter(w => {
      // If no timestamp, consider it stale
      if (!w.lastEventAt) return true;
      return (now.getTime() - new Date(w.lastEventAt).getTime()) > staleThreshold;
    })
    .map(w => w.id);
}

function deriveNextActions(phase, board, staleWorkItems) {
  const actions = [];

  if (staleWorkItems.length > 0) {
    actions.push(`⚠️ ${staleWorkItems.length} work item(s) appear stale (>30 min since last event): ${staleWorkItems.join(", ")}`);
    actions.push("These may be from a crashed session. They will be auto-released and retried.");
  }

  switch (phase) {
    case "planning":
      actions.push("→ /makeitreal:plan <request> to generate a blueprint");
      break;
    case "approval":
      actions.push("→ /makeitreal:approve to approve the blueprint");
      break;
    case "launching":
      actions.push("→ /makeitreal:launch to dispatch ready work items");
      break;
    case "running":
      actions.push("→ /makeitreal:status to check progress");
      actions.push("→ /makeitreal:launch to dispatch more ready work items");
      break;
    case "verifying":
      actions.push("→ makeitreal-engine gate <runDir> --target Done");
      break;
    case "done":
      actions.push("✅ All work items are Done!");
      break;
    case "failed": {
      const failed = (board.workItems ?? []).filter(w => w.lane === "Failed Fast");
      const blocked = (board.workItems ?? []).filter(w => w.lane === "Blocked");
      if (failed.length > 0) {
        actions.push(`${failed.length} item(s) failed — will auto-retry after backoff`);
      }
      if (blocked.length > 0) {
        actions.push(`${blocked.length} item(s) blocked — manual intervention needed`);
      }
      actions.push("→ /makeitreal:doctor for detailed diagnostics");
      break;
    }
  }

  return actions;
}
```

### 5.6 Cost Estimator

File: `src/recovery/cost-estimator.mjs`

```javascript
/**
 * Estimate Claude API costs for a blueprint execution.
 *
 * Pricing (Claude Sonnet 4, as of 2026-05):
 * - Input: $3 / 1M tokens
 * - Output: $15 / 1M tokens
 *
 * @param {{
 *   workItemCount: number,
 *   avgPromptTokens?: number,
 *   avgResponseTokens?: number,
 *   reviewRoundsPerItem?: number,
 *   includeBlueprint?: boolean
 * }} options
 * @returns {{
 *   blueprint: { inputTokens: number, outputTokens: number, usd: number },
 *   implementation: { inputTokens: number, outputTokens: number, usd: number },
 *   reviews: { inputTokens: number, outputTokens: number, usd: number },
 *   total: { inputTokens: number, outputTokens: number, usd: number },
 *   formattedTotal: string
 * }}
 */
export function estimateCost({
  workItemCount,
  avgPromptTokens = 4000,
  avgResponseTokens = 8000,
  reviewRoundsPerItem = 3,
  includeBlueprint = true
}) {
  const INPUT_PRICE_PER_TOKEN = 3 / 1_000_000;
  const OUTPUT_PRICE_PER_TOKEN = 15 / 1_000_000;

  // Blueprint generation: ~2000 input, ~6000 output
  const blueprintInput = includeBlueprint ? 2000 : 0;
  const blueprintOutput = includeBlueprint ? 6000 : 0;

  // Implementation: avgPromptTokens input, avgResponseTokens output per work item
  const implInput = workItemCount * avgPromptTokens;
  const implOutput = workItemCount * avgResponseTokens;

  // Reviews: ~1500 input, ~2000 output per review round
  const reviewInput = workItemCount * reviewRoundsPerItem * 1500;
  const reviewOutput = workItemCount * reviewRoundsPerItem * 2000;

  const totalInput = blueprintInput + implInput + reviewInput;
  const totalOutput = blueprintOutput + implOutput + reviewOutput;
  const totalUsd = (totalInput * INPUT_PRICE_PER_TOKEN) + (totalOutput * OUTPUT_PRICE_PER_TOKEN);

  return {
    blueprint: {
      inputTokens: blueprintInput,
      outputTokens: blueprintOutput,
      usd: round((blueprintInput * INPUT_PRICE_PER_TOKEN) + (blueprintOutput * OUTPUT_PRICE_PER_TOKEN))
    },
    implementation: {
      inputTokens: implInput,
      outputTokens: implOutput,
      usd: round((implInput * INPUT_PRICE_PER_TOKEN) + (implOutput * OUTPUT_PRICE_PER_TOKEN))
    },
    reviews: {
      inputTokens: reviewInput,
      outputTokens: reviewOutput,
      usd: round((reviewInput * INPUT_PRICE_PER_TOKEN) + (reviewOutput * OUTPUT_PRICE_PER_TOKEN))
    },
    total: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      usd: round(totalUsd)
    },
    formattedTotal: `~$${round(totalUsd).toFixed(2)} (${Math.round(totalInput / 1000)}K input + ${Math.round(totalOutput / 1000)}K output tokens)`
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
```

### 5.7 Enhanced Doctor Command

Modify `src/diagnostics/doctor.mjs` to add recovery-focused checks:

```javascript
// Add new check functions:

async function checkRecoveryState({ currentRun }) {
  if (!currentRun.ok || !currentRun.runDir) {
    return skipped("Recovery diagnostics require a current run.");
  }

  const { loadCheckpoint } = await import("../recovery/session-checkpoint.mjs");
  const checkpoint = await loadCheckpoint({ boardDir: currentRun.runDir });

  if (!checkpoint.ok) {
    return pass("No interrupted session found.", { interrupted: false });
  }

  const cp = checkpoint.checkpoint;
  const age = Date.now() - new Date(cp.lastCheckpointAt).getTime();
  const ageMinutes = Math.round(age / 60000);

  if (ageMinutes > 5) {
    return fail({
      code: "HARNESS_SESSION_INTERRUPTED",
      summary: `Session interrupted ${ageMinutes} minutes ago in phase: ${cp.phase}`,
      evidence: ["session-checkpoint.json"],
      nextAction: "makeitreal-engine resume",
      extra: {
        interrupted: true,
        phase: cp.phase,
        ageMinutes,
        pendingActions: cp.pendingActions
      }
    });
  }

  return pass(`Session checkpoint is recent (${ageMinutes}m ago).`, {
    interrupted: false,
    phase: cp.phase
  });
}

async function checkWorkItemHealth({ currentRun, now = new Date() }) {
  if (!currentRun.ok || !currentRun.runDir) {
    return skipped("Work item health requires a current run.");
  }

  try {
    const board = await loadBoard(currentRun.runDir);
    const items = board.workItems ?? [];
    const stuck = items.filter(w =>
      (w.lane === "Running" || w.lane === "Claimed") &&
      w.lastEventAt &&
      (now.getTime() - new Date(w.lastEventAt).getTime()) > 30 * 60 * 1000
    );

    if (stuck.length > 0) {
      return fail({
        code: "HARNESS_WORK_ITEMS_STUCK",
        summary: `${stuck.length} work item(s) appear stuck (>30 min without events).`,
        evidence: ["board.json"],
        nextAction: "makeitreal-engine resume",
        extra: { stuckWorkItemIds: stuck.map(w => w.id) }
      });
    }

    const maxRetries = items.filter(w => (w.attemptNumber ?? 0) >= 3);
    if (maxRetries.length > 0) {
      return fail({
        code: "HARNESS_WORK_ITEMS_MAX_RETRIES",
        summary: `${maxRetries.length} work item(s) have exhausted retries.`,
        evidence: ["board.json"],
        nextAction: "/makeitreal:status",
        extra: { exhaustedWorkItemIds: maxRetries.map(w => w.id) }
      });
    }

    return pass(`${items.length} work item(s) are healthy.`);
  } catch {
    return skipped("Could not load board for health check.");
  }
}

// Modify the runDoctor function to include new checks:
export async function runDoctor({
  projectRoot = process.cwd(),
  runDir = null,
  env = process.env,
  now = new Date()
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const config = await checkConfig({ projectRoot: resolvedProjectRoot });
  const plugin = await checkPlugin({ env });
  const currentRun = await checkCurrentRun({ projectRoot: resolvedProjectRoot, runDir, env });
  const hooks = await checkHooks({ projectRoot: resolvedProjectRoot, currentRun });
  const dashboard = await checkDashboard({ currentRun });
  const claudeBinary = checkClaudeBinary({ env });
  const recovery = await checkRecoveryState({ currentRun });     // NEW
  const workItemHealth = await checkWorkItemHealth({ currentRun, now }); // NEW

  const checks = { config, plugin, currentRun, hooks, dashboard, claudeBinary,
                    recovery, workItemHealth };
  const healthy = Object.values(checks).every((check) => check.status !== "fail");

  // ... rest of function same as before, but with new checks in the object
}
```

### 5.8 Orchestrator Checkpoint Integration

Add checkpoint saves at key state transitions in `src/orchestrator/orchestrator.mjs`:

```javascript
// Add import at top:
import { saveCheckpoint } from "../recovery/session-checkpoint.mjs";

// After startNativeClaudeTask dispatches tasks (around line 825):
try {
  const projectRoot = resolveProjectRootForRun({ runDir: boardDir });
  await saveCheckpoint({
    boardDir,
    phase: "running",
    projectRoot,
    now
  });
} catch {
  // Checkpoint failure is non-fatal — don't block the orchestrator
}

// After finishNativeClaudeTask completes (around line 990):
try {
  const projectRoot = resolveProjectRootForRun({ runDir: boardDir });
  const board = await loadBoard(boardDir);
  const allDone = board.workItems.every(w => w.lane === "Done");
  await saveCheckpoint({
    boardDir,
    phase: allDone ? "done" : "running",
    projectRoot,
    now
  });
} catch {
  // Non-fatal
}
```

### 5.9 CLI Command: resume

Add to `bin/harness.mjs`:

```javascript
case "resume": {
  const { resumeRun } = await import("../src/recovery/resume.mjs");
  const boardDir = args[0] ?? await resolveRunDir();
  const result = await resumeRun({ boardDir });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 1);
}
```

### 5.10 Edge Cases

1. **Checkpoint file corrupted** → loadCheckpoint returns ok: false, resume falls back to board-only reconciliation
2. **Board.json missing entirely** → resume returns error with nextAction: "/makeitreal:plan"
3. **All work items stuck in Running** → reconcileBoard releases expired claims, resume reports stale items
4. **Session interrupted during NEEDS_DECOMPOSE** → parent stays in Running, claim expires, orchestrator retries the parent (not children, since they weren't materialized yet)
5. **Cost estimate with 0 work items** → returns $0.00
6. **Terminal close mid-write** → board.json may be truncated. resumeRun wraps loadBoard in try/catch, suggests /makeitreal:doctor

### 5.11 Test Cases

File: `test/recovery-resume.test.mjs`

```javascript
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveCheckpoint, loadCheckpoint } from "../src/recovery/session-checkpoint.mjs";
import { writeJsonFile } from "../src/io/json.mjs";

describe("session checkpoints", () => {
  test("save and load checkpoint round-trips", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mir-ckpt-"));
    await mkdir(dir, { recursive: true });
    // Create minimal board
    await writeJsonFile(path.join(dir, "board.json"), {
      workItems: [{ id: "w1", lane: "Running" }]
    });

    await saveCheckpoint({
      boardDir: dir,
      phase: "running",
      projectRoot: "/tmp/project"
    });

    const result = await loadCheckpoint({ boardDir: dir });
    assert.ok(result.ok);
    assert.strictEqual(result.checkpoint.phase, "running");
    assert.strictEqual(result.checkpoint.workItemStates.length, 1);
    assert.strictEqual(result.checkpoint.workItemStates[0].lane, "Running");
    await rm(dir, { recursive: true });
  });

  test("loadCheckpoint returns error when no checkpoint exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mir-ckpt-"));
    const result = await loadCheckpoint({ boardDir: dir });
    assert.ok(!result.ok);
    assert.strictEqual(result.checkpoint, null);
    await rm(dir, { recursive: true });
  });
});
```

File: `test/cost-estimator.test.mjs`

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost } from "../src/recovery/cost-estimator.mjs";

test("estimates cost for 3 work items", () => {
  const estimate = estimateCost({ workItemCount: 3 });
  assert.ok(estimate.total.usd > 0);
  assert.ok(estimate.total.inputTokens > 0);
  assert.ok(estimate.total.outputTokens > 0);
  assert.ok(estimate.formattedTotal.startsWith("~$"));
});

test("estimates $0 for 0 work items without blueprint", () => {
  const estimate = estimateCost({ workItemCount: 0, includeBlueprint: false });
  assert.strictEqual(estimate.total.usd, 0);
  assert.strictEqual(estimate.total.inputTokens, 0);
});

test("blueprint adds ~$0.10 to cost", () => {
  const withBp = estimateCost({ workItemCount: 0, includeBlueprint: true });
  const noBp = estimateCost({ workItemCount: 0, includeBlueprint: false });
  assert.ok(withBp.total.usd > noBp.total.usd);
  assert.ok(withBp.blueprint.usd > 0);
});

test("more work items = higher cost", () => {
  const small = estimateCost({ workItemCount: 2 });
  const large = estimateCost({ workItemCount: 10 });
  assert.ok(large.total.usd > small.total.usd);
});
```

---

## Cross-Cutting: Integration Points Summary

### How all 5 specs connect:

1. **Contract System** (Spec 1) generates test scaffolds → consumed by **Orchestrator** sub-agent prompts
2. **Recursive Orchestration** (Spec 2) NEEDS_DECOMPOSE → creates children that get their own **Contract** test scaffolds
3. **Plugin Architecture** (Spec 3) `init` command uses **Contract** framework detection; `demo` uses pre-built artifacts that pass **Gate** validation
4. **Documentation** (Spec 4) references all APIs from Specs 1-3 and includes **Error Recovery** (Spec 5) troubleshooting
5. **Error Recovery** (Spec 5) checkpoints are saved by the **Orchestrator** and consumed by `resume` and enhanced `doctor`

### Import graph for new modules:

```
src/contracts/test-scaffold.mjs
  ← src/contracts/test-framework-detect.mjs
  ← src/contracts/test-setup-convention.mjs
  → src/io/json.mjs (existing)

src/contracts/kinds/*.mjs
  → src/domain/errors.mjs (existing)
  ← src/gates/index.mjs (existing, modified)

src/board/board-mutator.mjs
  → src/board/board-store.mjs (existing)
  → src/domain/errors.mjs (existing)
  → src/domain/path-policy.mjs (existing)
  → src/domain/artifacts.mjs (existing)
  → src/io/json.mjs (existing)
  ← src/orchestrator/orchestrator.mjs (existing, modified)

src/cli/init.mjs
  → src/project/bootstrap.mjs (existing)
  → src/contracts/test-framework-detect.mjs (new)
  → src/io/json.mjs (existing)

src/cli/demo.mjs
  (standalone, reads from examples/demo-templates/)

src/recovery/session-checkpoint.mjs
  → src/board/board-store.mjs (existing)
  → src/io/json.mjs (existing)
  ← src/orchestrator/orchestrator.mjs (existing, modified)

src/recovery/resume.mjs
  → src/recovery/session-checkpoint.mjs (new)
  → src/board/board-store.mjs (existing)
  → src/orchestrator/orchestrator.mjs (existing)

src/recovery/cost-estimator.mjs
  (standalone, pure function)
```

### Test file summary:

| Test File | Spec | Est. Tests |
|---|---|---|
| test/contract-scaffold.test.mjs | 1 | 10 |
| test/contract-kinds.test.mjs | 1 | 12 |
| test/test-framework-detect.test.mjs | 1 | 4 |
| test/needs-decompose.test.mjs | 2 | 8 |
| test/board-mutator.test.mjs | 2 | 6 |
| test/init.test.mjs | 3 | 4 |
| test/demo.test.mjs | 3 | 2 |
| test/docs-examples.test.mjs | 4 | 4 |
| test/recovery-resume.test.mjs | 5 | 3 |
| test/cost-estimator.test.mjs | 5 | 4 |
| **Total** | | **~57** |

All tests use `node:test` and `node:assert/strict` to match the existing project
convention (`"test": "node --test test/*.test.mjs"` in package.json).
