import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTestScaffold, buildTestScaffoldPrompt } from "../src/contracts/test-scaffold.mjs";
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

test("detectContractKind returns null without an explicit kind (no shape inference)", () => {
  // Doctrine: the engine does not guess the kind from shape. The LLM must
  // declare `kind` explicitly; an OpenAPI-shaped object without it is null.
  assert.strictEqual(detectContractKind({ openapi: "3.0.0", paths: {} }), null);
});

test("detectContractKind recognizes explicit openapi kind", () => {
  assert.strictEqual(detectContractKind({ kind: "openapi", openapi: "3.0.0", paths: {} }), "openapi");
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
    kind: "openapi",
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
    kind: "openapi",
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

// ── Test Scaffold Prompt Builder ────────────────────────────────────
// DOCTRINE: the LLM writes tests; the engine only builds the prompt that
// hands the contract to the LLM. These tests assert the prompt-builder
// behavior, NOT generated test code.

test("buildTestScaffoldPrompt returns a string prompt, not test code", () => {
  const contract = {
    kind: "module-io",
    contractId: "contract.auth.hash",
    modulePath: "src/auth/hash.mjs",
    exports: [{ name: "hashPassword", kind: "function" }]
  };

  const prompt = buildTestScaffoldPrompt(contract);
  assert.strictEqual(typeof prompt, "string");
  assert.ok(prompt.length > 0);
});

test("buildTestScaffoldPrompt embeds the full contract as JSON", () => {
  const contract = {
    kind: "module-io",
    contractId: "contract.auth.hash-password",
    modulePath: "src/auth/password-hasher.mjs",
    exports: [{ name: "hashPassword", kind: "function", async: true }]
  };

  const prompt = buildTestScaffoldPrompt(contract);
  assert.ok(prompt.includes(JSON.stringify(contract, null, 2)));
  assert.ok(prompt.includes("contract.auth.hash-password"));
  assert.ok(prompt.includes("password-hasher.mjs"));
});

test("buildTestScaffoldPrompt instructs the LLM to write the tests", () => {
  const prompt = buildTestScaffoldPrompt({ kind: "event", channel: "x", events: [] });
  assert.ok(/write test/i.test(prompt), "prompt should ask the LLM to write tests");
  assert.ok(/contract/i.test(prompt), "prompt should reference the contract");
});

test("buildTestScaffoldPrompt includes the default outputDir", () => {
  const prompt = buildTestScaffoldPrompt({ kind: "module-io", exports: [] });
  assert.ok(prompt.includes("test"), "should mention the default output directory");
});

test("buildTestScaffoldPrompt includes a custom outputDir from options", () => {
  const prompt = buildTestScaffoldPrompt({ kind: "module-io", exports: [] }, { outputDir: "custom/tests" });
  assert.ok(prompt.includes("custom/tests"), "should mention the custom output directory");
});

test("buildTestScaffoldPrompt does not fabricate test code or example values", () => {
  // The engine must not invent assertions or example values — those are LLM decisions.
  const contract = {
    openapi: "3.0.3",
    info: { title: "Auth API", version: "1.0.0" },
    paths: { "/auth/login": { post: { operationId: "loginUser", responses: { "200": {} } } } }
  };

  const prompt = buildTestScaffoldPrompt(contract);
  // No fabricated example values that the old engine used to inject.
  assert.equal(prompt.includes("test@example.com"), false);
  assert.equal(prompt.includes("Password1!"), false);
  // No generated assertion statements.
  assert.equal(prompt.includes("assert.strictEqual(response.status"), false);
});

// ── generateTestScaffold throws (LLM required) ──────────────────────

test("generateTestScaffold throws explaining the LLM is required", () => {
  const contract = {
    kind: "module-io",
    contractId: "contract.auth.hash",
    modulePath: "src/auth/hash.mjs",
    exports: [{ name: "hashPassword", kind: "function" }]
  };

  assert.throws(
    () => generateTestScaffold(contract),
    /Test scaffold generation requires LLM/
  );
});

test("generateTestScaffold throws even for an unknown/invalid contract", () => {
  assert.throws(() => generateTestScaffold(null), /requires LLM/);
  assert.throws(() => generateTestScaffold({ kind: "alien-protocol" }), /requires LLM/);
});

test("generateTestScaffold points callers to buildTestScaffoldPrompt", () => {
  assert.throws(
    () => generateTestScaffold({ kind: "module-io", exports: [] }),
    /buildTestScaffoldPrompt\(\)/
  );
});
