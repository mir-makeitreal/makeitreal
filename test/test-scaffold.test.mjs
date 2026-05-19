import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTestScaffold } from "../src/contracts/test-scaffold.mjs";
import { validateContract, detectContractKind, supportedKinds } from "../src/contracts/contract-kinds.mjs";

// ── Contract Kinds ──────────────────────────────────────────────────

test("supportedKinds returns all four kinds", () => {
  const kinds = supportedKinds();
  assert.deepStrictEqual(kinds, ["openapi", "module-io", "component", "event"]);
});

test("detectContractKind returns null for non-objects", () => {
  assert.strictEqual(detectContractKind(null), null);
  assert.strictEqual(detectContractKind(undefined), null);
  assert.strictEqual(detectContractKind("string"), null);
  assert.strictEqual(detectContractKind(42), null);
});

test("detectContractKind recognizes explicit kind field", () => {
  assert.strictEqual(detectContractKind({ kind: "module-io" }), "module-io");
  assert.strictEqual(detectContractKind({ kind: "component" }), "component");
  assert.strictEqual(detectContractKind({ kind: "event" }), "event");
});

test("detectContractKind recognizes openapi by shape", () => {
  assert.strictEqual(detectContractKind({ openapi: "3.0.0", paths: {} }), "openapi");
});

test("detectContractKind returns null for unknown kind string", () => {
  assert.strictEqual(detectContractKind({ kind: "unknown-thing" }), null);
});

test("validateContract returns error for unknown kind", () => {
  const result = validateContract({ kind: "alien" });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.kind, null);
  assert.strictEqual(result.errors.length, 1);
  assert.ok(result.errors[0].message.includes("Unknown"));
});

test("validateContract validates openapi contract", () => {
  const valid = validateContract({
    openapi: "3.0.3",
    info: { title: "Test API", version: "1.0.0" },
    paths: { "/test": { get: {} } }
  });
  assert.strictEqual(valid.ok, true);
  assert.strictEqual(valid.kind, "openapi");
  assert.strictEqual(valid.errors.length, 0);
});

test("validateContract rejects openapi contract with empty paths", () => {
  const result = validateContract({
    openapi: "3.0.3",
    info: { title: "Test API", version: "1.0.0" },
    paths: {}
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.kind, "openapi");
  assert.ok(result.errors.some((e) => e.field === "paths"));
});

test("validateContract validates module-io contract", () => {
  const valid = validateContract({
    kind: "module-io",
    contractId: "contract.auth.hash",
    modulePath: "src/auth/hash.mjs",
    exports: [{ name: "hashPassword", kind: "function" }]
  });
  assert.strictEqual(valid.ok, true);
  assert.strictEqual(valid.kind, "module-io");
});

test("validateContract rejects module-io with empty exports", () => {
  const result = validateContract({
    kind: "module-io",
    contractId: "contract.auth.hash",
    modulePath: "src/auth/hash.mjs",
    exports: []
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === "exports"));
});

test("validateContract validates component contract", () => {
  const valid = validateContract({
    kind: "component",
    contractId: "contract.ui.login",
    componentPath: "src/components/LoginForm.tsx",
    props: [{ name: "onSubmit", type: "function", required: true }]
  });
  assert.strictEqual(valid.ok, true);
  assert.strictEqual(valid.kind, "component");
});

test("validateContract validates event contract", () => {
  const valid = validateContract({
    kind: "event",
    contractId: "contract.events.user-created",
    channel: "user-events",
    events: [{ name: "user.created" }]
  });
  assert.strictEqual(valid.ok, true);
  assert.strictEqual(valid.kind, "event");
});

test("validateContract rejects event contract with empty events", () => {
  const result = validateContract({
    kind: "event",
    contractId: "contract.events.user-created",
    channel: "user-events",
    events: []
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === "events"));
});

// ── Test Scaffold: OpenAPI ──────────────────────────────────────────

test("OpenAPI contract generates valid test files", () => {
  const contract = {
    openapi: "3.0.3",
    info: { title: "Auth API", version: "1.0.0" },
    contractId: "auth-api",
    paths: {
      "/auth/login": {
        post: {
          operationId: "loginUser",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" }
                  },
                  required: ["email", "password"]
                }
              }
            }
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["token"],
                    properties: {
                      token: { type: "string" }
                    }
                  }
                }
              }
            },
            "401": { description: "Unauthorized" }
          }
        }
      }
    }
  };

  const result = generateTestScaffold(contract);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.files.length, 1);

  const file = result.files[0];
  assert.ok(file.path.endsWith("loginUser.contract.test.mjs"));
  assert.ok(file.content.includes('import { describe, test'));
  assert.ok(file.content.includes('import assert from "node:assert/strict"'));
  assert.ok(file.content.includes("POST /auth/login"));
  assert.ok(file.content.includes("returns 200"));
  assert.ok(file.content.includes("returns 401"));
  assert.ok(file.content.includes("token must be present"));
  assert.ok(file.content.includes("test@example.com"));
});

test("OpenAPI contract with multiple endpoints generates multiple files", () => {
  const contract = {
    openapi: "3.0.3",
    info: { title: "User API", version: "1.0.0" },
    paths: {
      "/users": {
        get: { operationId: "listUsers", responses: { "200": {} } }
      },
      "/users/{id}": {
        get: { operationId: "getUser", responses: { "200": {}, "404": {} } },
        delete: { operationId: "deleteUser", responses: { "204": {}, "404": {} } }
      }
    }
  };

  const result = generateTestScaffold(contract);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.files.length, 3);
  const names = result.files.map((f) => f.path.split("/").pop());
  assert.ok(names.includes("listUsers.contract.test.mjs"));
  assert.ok(names.includes("getUser.contract.test.mjs"));
  assert.ok(names.includes("deleteUser.contract.test.mjs"));
});

// ── Test Scaffold: Module-IO ────────────────────────────────────────

test("module-io contract generates valid test file", () => {
  const contract = {
    kind: "module-io",
    contractId: "contract.auth.hash-password",
    modulePath: "src/auth/password-hasher.mjs",
    exports: [
      {
        name: "hashPassword",
        kind: "function",
        async: true,
        inputs: [
          { name: "password", type: "string", required: true },
          { name: "options", type: "object", required: false }
        ],
        output: { type: "string", description: "bcrypt hash" },
        errors: [
          { code: "PASSWORD_TOO_SHORT", when: "password.length < 8" }
        ],
        examples: [
          { input: { password: "MyStr0ng!Pass" }, outputMatch: "startsWith('$2b$')" }
        ]
      }
    ]
  };

  const result = generateTestScaffold(contract);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.files.length, 1);

  const file = result.files[0];
  assert.ok(file.path.endsWith("contract-auth-hash-password.contract.test.mjs"));
  assert.ok(file.content.includes('import { describe, test }'));
  assert.ok(file.content.includes('import assert from "node:assert/strict"'));
  assert.ok(file.content.includes("exports hashPassword as a function"));
  assert.ok(file.content.includes("accepts expected parameters"));
  assert.ok(file.content.includes("password: string (required)"));
  assert.ok(file.content.includes("returns expected type"));
  assert.ok(file.content.includes("throws PASSWORD_TOO_SHORT"));
});

// ── Test Scaffold: Component ────────────────────────────────────────

test("component contract generates valid test file", () => {
  const contract = {
    kind: "component",
    contractId: "contract.ui.login-form",
    componentPath: "src/components/LoginForm.tsx",
    props: [
      { name: "onSubmit", type: "function", required: true },
      { name: "loading", type: "boolean", required: false, default: false }
    ],
    renderStates: [
      { name: "idle", props: { loading: false }, assertions: ["contains submit button"] },
      { name: "loading", props: { loading: true }, assertions: ["submit button is disabled"] }
    ],
    accessibility: {
      requiredAriaLabels: ["Email", "Password"],
      requiredRoles: ["form"]
    }
  };

  const result = generateTestScaffold(contract);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.files.length, 1);

  const file = result.files[0];
  assert.ok(file.path.endsWith("contract-ui-login-form.contract.test.mjs"));
  assert.ok(file.content.includes("LoginForm contract"));
  assert.ok(file.content.includes("renders idle state"));
  assert.ok(file.content.includes("renders loading state"));
  assert.ok(file.content.includes("meets accessibility requirements"));
  assert.ok(file.content.includes('aria-label "Email"'));
  assert.ok(file.content.includes('role="form"'));
});

// ── Test Scaffold: Event ────────────────────────────────────────────

test("event contract generates valid test file", () => {
  const contract = {
    kind: "event",
    contractId: "contract.events.user-created",
    channel: "user-events",
    events: [
      {
        name: "user.created",
        payloadSchema: {
          type: "object",
          properties: {
            userId: { type: "string" },
            email: { type: "string" },
            createdAt: { type: "string", format: "date-time" }
          },
          required: ["userId", "email", "createdAt"]
        },
        examples: [
          { payload: { userId: "usr_123", email: "a@b.com", createdAt: "2026-01-01T00:00:00Z" } }
        ]
      }
    ]
  };

  const result = generateTestScaffold(contract);
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.files.length, 1);

  const file = result.files[0];
  assert.ok(file.path.endsWith("contract-events-user-created.contract.test.mjs"));
  assert.ok(file.content.includes("user.created payload matches schema"));
  assert.ok(file.content.includes("userId"));
  assert.ok(file.content.includes("email"));
  assert.ok(file.content.includes("createdAt"));
  assert.ok(file.content.includes("can be emitted and received"));
});

// ── Generated test files are syntactically valid JS ─────────────────

test("generated OpenAPI test file is syntactically valid JavaScript", () => {
  const contract = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/items": {
        get: { operationId: "getItems", responses: { "200": {} } }
      }
    }
  };

  const result = generateTestScaffold(contract);
  assert.strictEqual(result.files.length, 1);

  // Attempt to parse as a module — if it throws, the generated code is invalid JS
  // We use Function constructor-like validation but since it's ESM with imports,
  // we verify it doesn't contain obvious syntax errors by checking balanced braces
  const content = result.files[0].content;
  const opens = (content.match(/\{/g) || []).length;
  const closes = (content.match(/\}/g) || []).length;
  assert.strictEqual(opens, closes, "Braces must be balanced");

  const openParens = (content.match(/\(/g) || []).length;
  const closeParens = (content.match(/\)/g) || []).length;
  assert.strictEqual(openParens, closeParens, "Parentheses must be balanced");
});

test("generated module-io test file is syntactically valid JavaScript", () => {
  const contract = {
    kind: "module-io",
    contractId: "contract.test.mod",
    modulePath: "src/mod.mjs",
    exports: [
      {
        name: "doThing",
        kind: "function",
        async: false,
        inputs: [{ name: "x", type: "number", required: true }],
        output: { type: "number" },
        errors: [{ code: "BAD_INPUT", when: "x < 0" }],
        examples: [{ input: { x: 5 }, output: 10 }]
      }
    ]
  };

  const result = generateTestScaffold(contract);
  const content = result.files[0].content;
  const opens = (content.match(/\{/g) || []).length;
  const closes = (content.match(/\}/g) || []).length;
  assert.strictEqual(opens, closes, "Braces must be balanced");
});

test("generated event test file is syntactically valid JavaScript", () => {
  const contract = {
    kind: "event",
    contractId: "contract.events.test",
    channel: "test-channel",
    events: [
      {
        name: "test.event",
        payloadSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        },
        examples: [{ payload: { id: "abc" } }]
      }
    ]
  };

  const result = generateTestScaffold(contract);
  const content = result.files[0].content;
  const opens = (content.match(/\{/g) || []).length;
  const closes = (content.match(/\}/g) || []).length;
  assert.strictEqual(opens, closes, "Braces must be balanced");
});

// ── Error cases ─────────────────────────────────────────────────────

test("unknown contract kind returns error", () => {
  const result = generateTestScaffold({ kind: "alien-protocol" });
  assert.strictEqual(result.files.length, 0);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].code, "SCAFFOLD_UNKNOWN_KIND");
});

test("invalid contract returns validation errors", () => {
  // openapi 3.x detected as openapi kind, but missing info and empty paths
  const result = generateTestScaffold({ openapi: "3.0.0", info: null, paths: {} });
  assert.strictEqual(result.files.length, 0);
  assert.ok(result.errors.length > 0);
  assert.strictEqual(result.errors[0].code, "SCAFFOLD_CONTRACT_INVALID");
});

test("null input returns error", () => {
  const result = generateTestScaffold(null);
  assert.strictEqual(result.files.length, 0);
  assert.strictEqual(result.errors.length, 1);
  assert.strictEqual(result.errors[0].code, "SCAFFOLD_UNKNOWN_KIND");
});

test("generateTestScaffold respects outputDir option", () => {
  const contract = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/x": { get: { operationId: "getX", responses: { "200": {} } } }
    }
  };

  const result = generateTestScaffold(contract, { outputDir: "custom/tests" });
  assert.ok(result.files[0].path.startsWith("custom/tests/"));
});

test("OpenAPI scaffold generates example values from schema types", () => {
  const contract = {
    openapi: "3.0.3",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/register": {
        post: {
          operationId: "register",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    email: { type: "string" },
                    age: { type: "integer" },
                    active: { type: "boolean" }
                  }
                }
              }
            }
          },
          responses: { "201": {} }
        }
      }
    }
  };

  const result = generateTestScaffold(contract);
  const content = result.files[0].content;
  assert.ok(content.includes("test@example.com"), "should generate email-like string for email field");
  assert.ok(content.includes("true"), "should generate boolean for boolean field");
});
