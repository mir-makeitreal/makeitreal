export function createHarnessError(input) {
  return {
    code: input.code,
    reason: input.reason,
    contractId: input.contractId ?? null,
    ownerModule: input.ownerModule ?? null,
    evidence: input.evidence ?? [],
    recoverable: input.recoverable ?? false
  };
}

export function isHarnessError(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.code === "string" &&
    typeof value.reason === "string" &&
    Array.isArray(value.evidence) &&
    typeof value.recoverable === "boolean" &&
    Object.prototype.hasOwnProperty.call(value, "contractId") &&
    Object.prototype.hasOwnProperty.call(value, "ownerModule")
  );
}
