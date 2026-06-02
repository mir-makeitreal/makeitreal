import { createHarnessError } from "../domain/errors.mjs";

function mappingError(code, reason) {
  return createHarnessError({
    code,
    reason,
    evidence: ["native-role-mapping.json"],
    recoverable: true
  });
}

// Doctrine: the engine does not own a role taxonomy. Validation only checks that
// each declared mapping entry carries the fields the engine needs to dispatch it
// (evidenceRole + nativeSubagentType). Which roles a given run requires is decided
// by the work item / completion policy, not by an engine-defined list.
export function validateNativeRoleMapping(mapping) {
  const errors = [];
  const entries = mapping?.mappings ?? [];
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(mappingError(
      "HARNESS_NATIVE_ROLE_MAPPING_MISSING",
      "native-role-mapping.json must declare at least one role mapping."
    ));
    return { ok: false, errors };
  }
  for (const entry of entries) {
    if (!entry?.evidenceRole || !entry?.nativeSubagentType) {
      errors.push(mappingError(
        "HARNESS_NATIVE_ROLE_MAPPING_INVALID",
        "Each native role mapping entry requires evidenceRole and nativeSubagentType."
      ));
    }
  }
  return { ok: errors.length === 0, errors };
}

// Doctrine: the engine never fabricates a role mapping. If native-role-mapping.json
// is absent the run must fail fast instead of falling back to a built-in default.
export function defaultNativeRoleMapping() {
  const error = mappingError(
    "HARNESS_NATIVE_ROLE_MAPPING_MISSING",
    "native-role-mapping.json must be declared in the run."
  );
  throw Object.assign(new Error(error.reason), { harnessError: error });
}
