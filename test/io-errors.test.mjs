import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHarnessError, isHarnessError } from "../src/domain/errors.mjs";
import { fileExists, listJsonFiles, readJsonFile, stableStringify, writeJsonFile } from "../src/io/json.mjs";

test("stable JSON writer creates directories and sorted JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "harness-json-"));
  const filePath = path.join(dir, "nested", "artifact.json");

  await writeJsonFile(filePath, { z: 1, a: { y: 2, b: 3 } });

  assert.equal(await fileExists(filePath), true);
  assert.equal(await readFile(filePath, "utf8"), "{\n  \"a\": {\n    \"b\": 3,\n    \"y\": 2\n  },\n  \"z\": 1\n}\n");
  assert.deepEqual(await readJsonFile(filePath), { a: { b: 3, y: 2 }, z: 1 });
  assert.deepEqual(await listJsonFiles(path.join(dir, "nested")), [filePath]);
  assert.equal(stableStringify({ b: 2, a: 1 }), "{\n  \"a\": 1,\n  \"b\": 2\n}\n");

  await rm(dir, { recursive: true, force: true });
});

test("harness errors have the canonical envelope", () => {
  const error = createHarnessError({
    code: "HARNESS_DESIGN_PACK_MISSING",
    reason: "Ready requires design-pack.json.",
    evidence: ["design-pack.json"]
  });

  assert.equal(isHarnessError(error), true);
  assert.deepEqual(error, {
    code: "HARNESS_DESIGN_PACK_MISSING",
    reason: "Ready requires design-pack.json.",
    contractId: null,
    ownerModule: null,
    evidence: ["design-pack.json"],
    recoverable: false
  });
});
