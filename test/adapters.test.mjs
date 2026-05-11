import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateOpenApiConformanceEvidence } from "../src/adapters/openapi-conformance.mjs";
import { validateOpenApiContracts } from "../src/adapters/openapi-contract.mjs";
import { validateRunChangedPaths } from "../src/adapters/path-boundary.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { withFixture } from "./helpers/fixture.mjs";

test("path boundary adapter rejects edits outside the work item allowed paths", async () => {
  await withFixture(async ({ runDir }) => {
    const inside = await validateRunChangedPaths({
      runDir,
      changedPaths: ["apps/web/auth/LoginForm.tsx"]
    });
    assert.equal(inside.ok, true);

    const outside = await validateRunChangedPaths({
      runDir,
      changedPaths: ["services/auth/private.ts"]
    });
    assert.equal(outside.ok, false);
    assert.equal(outside.errors[0].code, "HARNESS_PATH_BOUNDARY_VIOLATION");
  });
});

test("OpenAPI adapter validates declared contract documents", async () => {
  await withFixture(async ({ runDir }) => {
    assert.equal((await validateOpenApiContracts({ runDir })).ok, true);

    const specPath = path.join(runDir, "contracts", "auth-login.openapi.json");
    const spec = await readJsonFile(specPath);
    delete spec.openapi;
    await writeJsonFile(specPath, spec);

    const result = await validateOpenApiContracts({ runDir });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_OPENAPI_VERSION_INVALID");
  });
});

test("OpenAPI adapter requires implementation-grade operation contracts", async () => {
  await withFixture(async ({ runDir }) => {
    const specPath = path.join(runDir, "contracts", "auth-login.openapi.json");
    const spec = await readJsonFile(specPath);
    delete spec.paths["/auth/login"].post.requestBody;
    delete spec.paths["/auth/login"].post.responses["401"];
    await writeJsonFile(specPath, spec);

    const result = await validateOpenApiContracts({ runDir });
    const codes = result.errors.map((error) => error.code);
    assert.equal(result.ok, false);
    assert.equal(codes.includes("HARNESS_OPENAPI_REQUEST_SCHEMA_MISSING"), true);
    assert.equal(codes.includes("HARNESS_OPENAPI_ERROR_RESPONSE_MISSING"), true);
  });
});

test("OpenAPI adapter rejects breaking removals against a baseline", async () => {
  await withFixture(async ({ runDir }) => {
    const baselineRoot = await mkdtemp(path.join(os.tmpdir(), "harness-openapi-baseline-"));
    try {
      await cp(path.join(runDir, "contracts"), path.join(baselineRoot, "contracts"), { recursive: true });

      const specPath = path.join(runDir, "contracts", "auth-login.openapi.json");
      const spec = await readJsonFile(specPath);
      delete spec.paths["/auth/login"].post.responses["200"];
      await writeJsonFile(specPath, spec);

      const result = await validateOpenApiContracts({ runDir, baselineDir: baselineRoot });
      assert.equal(result.ok, false);
      assert.equal(result.errors.some((error) => error.code === "HARNESS_OPENAPI_RESPONSE_REMOVED"), true);
    } finally {
      await rm(baselineRoot, { recursive: true, force: true });
    }
  });
});

test("OpenAPI conformance evidence validates implementation samples against the declared spec", async () => {
  await withFixture(async ({ runDir }) => {
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.doneEvidence.push({ kind: "openapi-conformance", path: "evidence/work.feature-auth.openapi-conformance.json" });
    await writeJsonFile(workItemPath, workItem);
    await writeJsonFile(path.join(runDir, "evidence", "work.feature-auth.openapi-conformance.json"), {
      kind: "openapi-conformance",
      ok: true,
      workItemId: workItem.id,
      contractId: "contract.auth.login",
      cases: [
        {
          contractId: "contract.auth.login",
          request: { method: "POST", path: "/auth/login", body: { email: "a@example.com", password: "secret" } },
          response: { status: 200, body: { token: "abc" } }
        }
      ]
    });

    const passing = await validateOpenApiConformanceEvidence({ runDir, workItem });
    assert.equal(passing.ok, true);

    await writeJsonFile(path.join(runDir, "evidence", "work.feature-auth.openapi-conformance.json"), {
      kind: "openapi-conformance",
      ok: true,
      workItemId: workItem.id,
      contractId: "contract.auth.login",
      cases: [
        {
          contractId: "contract.auth.login",
          request: { method: "POST", path: "/auth/login", body: { email: "a@example.com", password: "secret" } },
          response: { status: 418, body: { token: "abc" } }
        }
      ]
    });

    const failing = await validateOpenApiConformanceEvidence({ runDir, workItem });
    assert.equal(failing.ok, false);
    assert.equal(failing.errors[0].code, "HARNESS_OPENAPI_CONFORMANCE_FAILED");

    await writeJsonFile(path.join(runDir, "evidence", "work.feature-auth.openapi-conformance.json"), {
      kind: "openapi-conformance",
      ok: true,
      workItemId: workItem.id,
      contractId: "contract.auth.login",
      cases: [
        {
          contractId: "contract.auth.login",
          request: { method: "POST", path: "/auth/login", body: { email: "a@example.com" } },
          response: { status: 200, body: { token: "abc" } }
        }
      ]
    });

    const requestSchemaFailing = await validateOpenApiConformanceEvidence({ runDir, workItem });
    assert.equal(requestSchemaFailing.ok, false);
    assert.match(requestSchemaFailing.errors[0].reason, /request\.body\.password is required/);
  });
});
