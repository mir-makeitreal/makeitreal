/**
 * Contract kind definitions, schemas, and validators.
 *
 * Supported kinds: openapi, module-io, component, event
 * Each kind has a schema shape definition, a validator, and a test scaffold template key.
 */

const CONTRACT_KINDS = new Map();

// ── OpenAPI kind ────────────────────────────────────────────────────

CONTRACT_KINDS.set("openapi", {
  requiredFields: ["openapi", "info", "paths"],
  validate(contract) {
    const errors = [];
    if (typeof contract.openapi !== "string" || !contract.openapi.startsWith("3.")) {
      errors.push({ field: "openapi", message: "Must be a 3.x version string" });
    }
    if (!contract.info || typeof contract.info !== "object") {
      errors.push({ field: "info", message: "Must be an object with title" });
    } else if (typeof contract.info.title !== "string" || contract.info.title.length === 0) {
      errors.push({ field: "info.title", message: "Must be a non-empty string" });
    }
    if (!contract.paths || typeof contract.paths !== "object" || Array.isArray(contract.paths)) {
      errors.push({ field: "paths", message: "Must be an object" });
    } else if (Object.keys(contract.paths).length === 0) {
      errors.push({ field: "paths", message: "Must declare at least one path" });
    }
    return errors;
  }
});

// ── Module-IO kind ──────────────────────────────────────────────────

CONTRACT_KINDS.set("module-io", {
  requiredFields: ["kind", "contractId", "modulePath", "exports"],
  validate(contract) {
    const errors = [];
    if (contract.kind !== "module-io") {
      errors.push({ field: "kind", message: "Must be \"module-io\"" });
    }
    if (typeof contract.contractId !== "string" || contract.contractId.length === 0) {
      errors.push({ field: "contractId", message: "Must be a non-empty string" });
    }
    if (typeof contract.modulePath !== "string" || contract.modulePath.length === 0) {
      errors.push({ field: "modulePath", message: "Must be a non-empty string" });
    }
    if (!Array.isArray(contract.exports) || contract.exports.length === 0) {
      errors.push({ field: "exports", message: "Must be a non-empty array" });
    } else {
      for (const [index, exp] of contract.exports.entries()) {
        if (typeof exp.name !== "string" || exp.name.length === 0) {
          errors.push({ field: `exports[${index}].name`, message: "Must be a non-empty string" });
        }
        if (typeof exp.kind !== "string") {
          errors.push({ field: `exports[${index}].kind`, message: "Must be a string" });
        }
      }
    }
    return errors;
  }
});

// ── Component kind ──────────────────────────────────────────────────

CONTRACT_KINDS.set("component", {
  requiredFields: ["kind", "contractId", "componentPath", "props"],
  validate(contract) {
    const errors = [];
    if (contract.kind !== "component") {
      errors.push({ field: "kind", message: "Must be \"component\"" });
    }
    if (typeof contract.contractId !== "string" || contract.contractId.length === 0) {
      errors.push({ field: "contractId", message: "Must be a non-empty string" });
    }
    if (typeof contract.componentPath !== "string" || contract.componentPath.length === 0) {
      errors.push({ field: "componentPath", message: "Must be a non-empty string" });
    }
    if (!Array.isArray(contract.props)) {
      errors.push({ field: "props", message: "Must be an array" });
    }
    return errors;
  }
});

// ── Event kind ──────────────────────────────────────────────────────

CONTRACT_KINDS.set("event", {
  requiredFields: ["kind", "contractId", "channel", "events"],
  validate(contract) {
    const errors = [];
    if (contract.kind !== "event") {
      errors.push({ field: "kind", message: "Must be \"event\"" });
    }
    if (typeof contract.contractId !== "string" || contract.contractId.length === 0) {
      errors.push({ field: "contractId", message: "Must be a non-empty string" });
    }
    if (typeof contract.channel !== "string" || contract.channel.length === 0) {
      errors.push({ field: "channel", message: "Must be a non-empty string" });
    }
    if (!Array.isArray(contract.events) || contract.events.length === 0) {
      errors.push({ field: "events", message: "Must be a non-empty array" });
    } else {
      for (const [index, event] of contract.events.entries()) {
        if (typeof event.name !== "string" || event.name.length === 0) {
          errors.push({ field: `events[${index}].name`, message: "Must be a non-empty string" });
        }
      }
    }
    return errors;
  }
});

/**
 * Detect the kind of a contract from its shape.
 *
 * @param {object} contract
 * @returns {string|null} The kind string, or null if unrecognizable
 */
export function detectContractKind(contract) {
  if (!contract || typeof contract !== "object") {
    return null;
  }
  // Explicit kind field takes precedence
  if (typeof contract.kind === "string" && CONTRACT_KINDS.has(contract.kind)) {
    return contract.kind;
  }
  // Detect OpenAPI by shape (has openapi + paths)
  if (typeof contract.openapi === "string" && contract.paths) {
    return "openapi";
  }
  return null;
}

/**
 * Validate a contract against its kind schema.
 *
 * @param {object} contract
 * @returns {{ ok: boolean, kind: string|null, errors: Array<{field: string, message: string}> }}
 */
export function validateContract(contract) {
  const kind = detectContractKind(contract);
  if (!kind) {
    return {
      ok: false,
      kind: null,
      errors: [{ field: "kind", message: "Unknown or missing contract kind" }]
    };
  }

  const kindDef = CONTRACT_KINDS.get(kind);
  const errors = kindDef.validate(contract);

  return {
    ok: errors.length === 0,
    kind,
    errors
  };
}

/**
 * Get all supported contract kind names.
 * @returns {string[]}
 */
export function supportedKinds() {
  return [...CONTRACT_KINDS.keys()];
}
