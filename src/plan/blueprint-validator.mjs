import { invalidAllowedPathPattern } from "../domain/path-policy.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function findDuplicates(arr) {
  return arr.filter((item, i) => arr.indexOf(item) !== i);
}

function detectCycle(nodes, edgesByNode) {
  const visited = new Set();
  const inStack = new Set();

  function dfs(nodeId, path) {
    if (inStack.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return path.slice(cycleStart).concat(nodeId);
    }
    if (visited.has(nodeId)) return null;

    visited.add(nodeId);
    inStack.add(nodeId);
    path.push(nodeId);

    for (const dep of (edgesByNode.get(nodeId) ?? [])) {
      const cycle = dfs(dep, path);
      if (cycle) return cycle;
    }

    path.pop();
    inStack.delete(nodeId);
    return null;
  }

  for (const node of nodes) {
    const cycle = dfs(node, []);
    if (cycle) return cycle;
  }
  return null;
}

function normalizePath(p) {
  return String(p ?? "").replace(/\/\*\*$/, "").replace(/\/+$/, "");
}

function patternsOverlap(a, b) {
  if (a === b) return true;
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (na === nb) return true;
  if (na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`)) return true;
  return false;
}

const CONTRACT_TYPES = new Set(["http", "function", "event", "component"]);

export const VALIDATION_RULES = [
  {
    id: "MODULES_NON_EMPTY",
    severity: "error",
    check(proposal) {
      return isNonEmptyArray(proposal.modules) ? null : "modules must be a non-empty array.";
    }
  },
  {
    id: "WORK_ITEMS_NON_EMPTY",
    severity: "error",
    check(proposal) {
      return isNonEmptyArray(proposal.workItems) ? null : "workItems must be a non-empty array.";
    }
  },
  {
    id: "TITLE_REQUIRED",
    severity: "error",
    check(proposal) {
      return isNonEmptyString(proposal.title) ? null : "title must be a non-empty string.";
    }
  },
  {
    id: "SUMMARY_REQUIRED",
    severity: "error",
    check(proposal) {
      return isNonEmptyString(proposal.summary) ? null : "summary must be a non-empty string.";
    }
  },
  {
    id: "MODULE_NAMES_UNIQUE",
    severity: "error",
    check(proposal) {
      const names = (proposal.modules ?? []).map(m => m.name);
      const dupes = [...new Set(findDuplicates(names))];
      return dupes.length === 0 ? null : `Duplicate module names: ${dupes.join(", ")}`;
    }
  },
  {
    id: "MODULE_FIELDS_REQUIRED",
    severity: "error",
    check(proposal) {
      const bad = [];
      for (const m of (proposal.modules ?? [])) {
        if (!isNonEmptyString(m.name)) bad.push("a module is missing name");
        if (!isNonEmptyString(m.purpose)) bad.push(`module ${m.name ?? "?"} missing purpose`);
        if (!isNonEmptyArray(m.ownedPaths)) bad.push(`module ${m.name ?? "?"} missing ownedPaths`);
      }
      return bad.length === 0 ? null : bad.join("; ");
    }
  },
  {
    id: "CONTRACT_FIELDS_REQUIRED",
    severity: "error",
    check(proposal) {
      const bad = [];
      for (const m of (proposal.modules ?? [])) {
        for (const c of (m.contracts ?? [])) {
          const label = `${m.name}.${c.name ?? "?"}`;
          if (!isNonEmptyString(c.name)) bad.push(`contract in ${m.name} missing name`);
          if (!CONTRACT_TYPES.has(c.type)) bad.push(`${label} type must be one of ${[...CONTRACT_TYPES].join(", ")}`);
          if (!Array.isArray(c.inputs)) bad.push(`${label} inputs must be an array`);
          if (!Array.isArray(c.outputs)) bad.push(`${label} outputs must be an array`);
        }
      }
      return bad.length === 0 ? null : bad.join("; ");
    }
  },
  {
    id: "WORK_ITEMS_EXCEED_MAX",
    severity: "error",
    check(proposal) {
      const count = (proposal.workItems ?? []).length;
      return count > 12 ? `Too many work items (${count}). Maximum is 12.` : null;
    }
  },
  {
    id: "WORK_ITEM_FIELDS_REQUIRED",
    severity: "error",
    check(proposal) {
      const bad = [];
      for (const wi of (proposal.workItems ?? [])) {
        if (!isNonEmptyString(wi.module)) bad.push("a work item is missing module");
        if (!isNonEmptyString(wi.title)) bad.push(`work item for ${wi.module ?? "?"} missing title`);
      }
      return bad.length === 0 ? null : bad.join("; ");
    }
  },
  {
    id: "WORK_ITEM_MODULE_REFERENCE_VALID",
    severity: "error",
    check(proposal) {
      const names = new Set((proposal.modules ?? []).map(m => m.name));
      const bad = (proposal.workItems ?? [])
        .filter(wi => wi.module && !names.has(wi.module))
        .map(wi => wi.module);
      return bad.length === 0 ? null : `Work items reference unknown modules: ${[...new Set(bad)].join(", ")}`;
    }
  },
  {
    id: "WORK_ITEM_MODULE_UNIQUE",
    severity: "error",
    check(proposal) {
      const refs = (proposal.workItems ?? []).map(wi => wi.module).filter(Boolean);
      const dupes = [...new Set(findDuplicates(refs))];
      return dupes.length === 0 ? null : `Multiple work items target the same module: ${dupes.join(", ")}`;
    }
  },
  {
    id: "WORK_ITEM_DEPENDSON_REFERENCE_VALID",
    severity: "error",
    check(proposal) {
      const names = new Set((proposal.modules ?? []).map(m => m.name));
      const bad = [];
      for (const wi of (proposal.workItems ?? [])) {
        for (const dep of (wi.dependsOn ?? [])) {
          if (!names.has(dep)) bad.push(`${wi.module ?? "?"} -> ${dep}`);
        }
      }
      return bad.length === 0 ? null : `Work item dependsOn references unknown modules: ${bad.join(", ")}`;
    }
  },
  {
    id: "MODULE_DEPENDSON_REFERENCE_VALID",
    severity: "error",
    check(proposal) {
      const names = new Set((proposal.modules ?? []).map(m => m.name));
      const bad = [];
      for (const m of (proposal.modules ?? [])) {
        for (const dep of (m.dependsOn ?? [])) {
          if (!names.has(dep)) bad.push(`${m.name} -> ${dep}`);
        }
      }
      return bad.length === 0 ? null : `Module dependsOn references unknown modules: ${bad.join(", ")}`;
    }
  },
  {
    id: "PATHS_NO_OVERLAP",
    severity: "error",
    check(proposal) {
      const modules = proposal.modules ?? [];
      const overlaps = [];
      for (let i = 0; i < modules.length; i++) {
        for (let j = i + 1; j < modules.length; j++) {
          for (const a of (modules[i].ownedPaths ?? [])) {
            for (const b of (modules[j].ownedPaths ?? [])) {
              if (patternsOverlap(a, b)) {
                overlaps.push(`${modules[i].name}(${a}) ↔ ${modules[j].name}(${b})`);
              }
            }
          }
        }
      }
      return overlaps.length === 0 ? null : `Overlapping module paths: ${overlaps.join(", ")}`;
    }
  },
  {
    id: "ALLOWED_PATHS_ARE_VALID",
    severity: "error",
    check(proposal) {
      const invalid = [];
      for (const m of (proposal.modules ?? [])) {
        for (const p of (m.ownedPaths ?? [])) {
          if (invalidAllowedPathPattern(p)) invalid.push(`${m.name}: ${p}`);
        }
      }
      return invalid.length === 0 ? null : `Invalid module paths: ${invalid.join(", ")}`;
    }
  },
  {
    id: "DAG_IS_ACYCLIC",
    severity: "error",
    check(proposal) {
      const edges = new Map();
      const nodes = new Set();
      for (const m of (proposal.modules ?? [])) {
        nodes.add(m.name);
        edges.set(m.name, [...(m.dependsOn ?? [])]);
      }
      for (const wi of (proposal.workItems ?? [])) {
        if (!wi.module) continue;
        const cur = edges.get(wi.module) ?? [];
        edges.set(wi.module, [...cur, ...(wi.dependsOn ?? [])]);
      }
      const cycle = detectCycle([...nodes], edges);
      return cycle ? `Dependency cycle: ${cycle.join(" → ")}` : null;
    }
  }
];

export function validateBlueprintProposal(proposal) {
  if (!proposal || typeof proposal !== "object") {
    return {
      ok: false,
      errors: [{ code: "INVALID_PROPOSAL", reason: "Proposal must be a non-null object" }],
      warnings: []
    };
  }

  const requiredFields = ["title", "summary", "modules", "workItems"];
  const missingFields = requiredFields.filter(f => !proposal[f]);
  if (missingFields.length > 0) {
    return {
      ok: false,
      errors: [{ code: "MISSING_FIELDS", reason: `Missing required fields: ${missingFields.join(", ")}` }],
      warnings: []
    };
  }

  const errors = [];
  const warnings = [];

  for (const rule of VALIDATION_RULES) {
    const reason = rule.check(proposal);
    if (reason) {
      if (rule.severity === "error") errors.push({ code: rule.id, reason });
      else warnings.push({ code: rule.id, reason });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
