export function createHarnessError(input) {
  const error = {
    code: input.code,
    reason: input.reason,
    contractId: input.contractId ?? null,
    ownerModule: input.ownerModule ?? null,
    evidence: input.evidence ?? [],
    recoverable: input.recoverable ?? false
  };

  for (const key of ["nextAction", "suggestedBoundaries", "guidance"]) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      error[key] = input[key];
    }
  }

  return error;
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
