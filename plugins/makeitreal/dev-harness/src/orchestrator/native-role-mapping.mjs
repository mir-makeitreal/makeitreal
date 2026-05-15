import { createHarnessError } from "../domain/errors.mjs";

const ROLES = Object.freeze([
  "implementation-worker",
  "spec-reviewer",
  "quality-reviewer",
  "verification-reviewer"
]);

export function requiredEvidenceRoles() {
  return [...ROLES];
}

function mappingError(code, reason) {
  return createHarnessError({
    code,
    reason,
    evidence: ["native-role-mapping.json"],
    recoverable: true
  });
}

export function validateNativeRoleMapping(mapping) {
  const errors = [];
  const entries = mapping?.mappings ?? [];
  for (const role of ROLES) {
    const entry = entries.find((candidate) => candidate.evidenceRole === role);
    if (!entry) {
      errors.push(mappingError("HARNESS_NATIVE_ROLE_MAPPING_MISSING", `Missing native role mapping for ${role}.`));
      continue;
    }
    if (!entry.nativeSubagentType || !entry.mappingSource) {
      errors.push(mappingError("HARNESS_NATIVE_ROLE_MAPPING_INVALID", `${role} mapping requires nativeSubagentType and mappingSource.`));
    }
  }
  return { ok: errors.length === 0, errors };
}

export function defaultNativeRoleMapping() {
  return {
    schemaVersion: "1.0",
    mappings: [
      { evidenceRole: "implementation-worker", nativeSubagentType: "general-purpose", mappingSource: "builtin-default" },
      { evidenceRole: "spec-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
      { evidenceRole: "quality-reviewer", nativeSubagentType: "oh-my-claudecode:critic", mappingSource: "project-config" },
      { evidenceRole: "verification-reviewer", nativeSubagentType: "oh-my-claudecode:verifier", mappingSource: "project-config" }
    ]
  };
}
