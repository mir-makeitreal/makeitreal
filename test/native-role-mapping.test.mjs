import assert from "node:assert/strict";
import { test } from "node:test";
import { requiredEvidenceRoles, validateNativeRoleMapping } from "../src/orchestrator/native-role-mapping.mjs";

const mapping = {
  schemaVersion: "1.0",
  mappings: [
    { evidenceRole: "implementation-worker", nativeSubagentType: "general-purpose", mappingSource: "builtin-default" },
    { evidenceRole: "spec-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
    { evidenceRole: "quality-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
    { evidenceRole: "verification-reviewer", nativeSubagentType: "oh-my-claudecode:verifier", mappingSource: "project-config" }
  ]
};

test("validates required native role mappings", () => {
  assert.deepEqual(requiredEvidenceRoles(), [
    "implementation-worker",
    "spec-reviewer",
    "quality-reviewer",
    "verification-reviewer"
  ]);
  assert.equal(validateNativeRoleMapping(mapping).ok, true);
});

test("rejects missing reviewer mapping", () => {
  const result = validateNativeRoleMapping({
    ...mapping,
    mappings: mapping.mappings.filter((entry) => entry.evidenceRole !== "quality-reviewer")
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_ROLE_MAPPING_MISSING");
});
