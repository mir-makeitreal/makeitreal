import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultNativeRoleMapping, validateNativeRoleMapping } from "../src/orchestrator/native-role-mapping.mjs";

const mapping = {
  schemaVersion: "1.0",
  mappings: [
    { evidenceRole: "implementation-worker", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "spec-reviewer", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "quality-reviewer", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "verification-reviewer", nativeSubagentType: "general-purpose", mappingSource: "run-declared" }
  ]
};

test("accepts mapping entries that declare required fields", () => {
  assert.equal(validateNativeRoleMapping(mapping).ok, true);
});

test("does not constrain roles to an engine-defined list", () => {
  const result = validateNativeRoleMapping({
    schemaVersion: "1.0",
    mappings: [{ evidenceRole: "design-reviewer", nativeSubagentType: "general-purpose" }]
  });
  assert.equal(result.ok, true);
});

test("rejects entries missing evidenceRole or nativeSubagentType", () => {
  const result = validateNativeRoleMapping({
    schemaVersion: "1.0",
    mappings: [{ evidenceRole: "spec-reviewer" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_ROLE_MAPPING_INVALID");
});

test("rejects a mapping with no entries", () => {
  const result = validateNativeRoleMapping({ schemaVersion: "1.0", mappings: [] });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_ROLE_MAPPING_MISSING");
});

test("fails fast instead of fabricating a default mapping", () => {
  assert.throws(
    () => defaultNativeRoleMapping(),
    (error) => error.harnessError?.code === "HARNESS_NATIVE_ROLE_MAPPING_MISSING"
  );
});
