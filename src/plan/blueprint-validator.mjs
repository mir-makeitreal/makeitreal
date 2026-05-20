import { invalidAllowedPathPattern } from "../domain/path-policy.mjs";
import { normalizeVerificationCommand } from "../domain/verification-command.mjs";

/**
 * Validates a BlueprintProposal produced by Claude.
 * Returns { ok, errors[], warnings[] }.
 */

function findDuplicates(arr) {
  return arr.filter((item, i) => arr.indexOf(item) !== i);
}

function detectCycle(workItems) {
  const graph = new Map();
  for (const wi of workItems) {
    graph.set(wi.id, wi.dependsOn ?? []);
  }

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

    for (const dep of (graph.get(nodeId) ?? [])) {
      const cycle = dfs(dep, path);
      if (cycle) return cycle;
    }

    path.pop();
    inStack.delete(nodeId);
    return null;
  }

  for (const wi of workItems) {
    const cycle = dfs(wi.id, []);
    if (cycle) return cycle;
  }
  return null;
}

function longestPathDepth(workItems) {
  const depMap = new Map();
  for (const wi of workItems) {
    depMap.set(wi.id, wi.dependsOn ?? []);
  }

  const memo = new Map();
  const visiting = new Set();

  function depth(nodeId) {
    if (memo.has(nodeId)) return memo.get(nodeId);
    if (visiting.has(nodeId)) return 0; // cycle — handled by DAG_IS_ACYCLIC
    visiting.add(nodeId);
    const deps = depMap.get(nodeId) ?? [];
    if (deps.length === 0) {
      memo.set(nodeId, 0);
      visiting.delete(nodeId);
      return 0;
    }
    const d = 1 + Math.max(...deps.map(dep => depth(dep)));
    memo.set(nodeId, d);
    visiting.delete(nodeId);
    return d;
  }

  let max = 0;
  for (const wi of workItems) {
    max = Math.max(max, depth(wi.id));
  }
  return max;
}

function patternsOverlap(a, b) {
  // Simple overlap detection: exact match, or one is a prefix of the other
  const normalizeA = a.replace(/\/\*\*$/, "/");
  const normalizeB = b.replace(/\/\*\*$/, "/");
  if (a === b) return true;
  if (normalizeA.startsWith(normalizeB) || normalizeB.startsWith(normalizeA)) return true;
  return false;
}

export const VALIDATION_RULES = [
  {
    id: "UNIQUE_NODE_IDS",
    severity: "error",
    check(proposal) {
      const ids = proposal.architecture.nodes.map(n => n.id);
      const dupes = [...new Set(findDuplicates(ids))];
      return dupes.length === 0 ? null : `Duplicate node IDs: ${dupes.join(", ")}`;
    }
  },
  {
    id: "UNIQUE_WORK_ITEM_IDS",
    severity: "error",
    check(proposal) {
      const ids = proposal.workItems.map(wi => wi.id);
      const dupes = [...new Set(findDuplicates(ids))];
      return dupes.length === 0 ? null : `Duplicate work item IDs: ${dupes.join(", ")}`;
    }
  },
  {
    id: "EDGES_REFERENCE_DECLARED_NODES",
    severity: "error",
    check(proposal) {
      const nodeIds = new Set(proposal.architecture.nodes.map(n => n.id));
      const bad = (proposal.architecture.edges ?? []).filter(e => !nodeIds.has(e.from) || !nodeIds.has(e.to));
      return bad.length === 0 ? null : `Edges reference undeclared nodes: ${bad.map(e => `${e.from}->${e.to}`).join(", ")}`;
    }
  },
  {
    id: "DAG_IS_ACYCLIC",
    severity: "error",
    check(proposal) {
      const cycle = detectCycle(proposal.workItems);
      return cycle ? `Work item dependency cycle detected: ${cycle.join(" → ")}` : null;
    }
  },
  {
    id: "CONTRACTS_REFERENCED_EXIST",
    severity: "error",
    check(proposal) {
      const contractIds = new Set((proposal.contracts ?? []).map(c => c.contractId));
      const allRefs = [
        ...(proposal.architecture.edges ?? []).map(e => e.contractId),
        ...(proposal.workItems ?? []).flatMap(wi => wi.contractIds ?? []),
        ...(proposal.responsibilityUnits ?? []).flatMap(ru => [...(ru.mustProvideContracts ?? []), ...(ru.mayUseContracts ?? [])])
      ].filter(Boolean);
      const missing = [...new Set(allRefs.filter(id => !contractIds.has(id)))];
      return missing.length === 0 ? null : `Undeclared contracts: ${missing.join(", ")}`;
    }
  },
  {
    id: "NO_OVERLAPPING_OWNERSHIP",
    severity: "error",
    check(proposal) {
      const units = proposal.responsibilityUnits ?? [];
      const overlaps = [];
      for (let i = 0; i < units.length; i++) {
        for (let j = i + 1; j < units.length; j++) {
          for (const pathA of (units[i].owns ?? [])) {
            for (const pathB of (units[j].owns ?? [])) {
              if (patternsOverlap(pathA, pathB)) {
                overlaps.push(`${units[i].id}(${pathA}) ↔ ${units[j].id}(${pathB})`);
              }
            }
          }
        }
      }
      return overlaps.length === 0 ? null : `Overlapping ownership: ${overlaps.join(", ")}`;
    }
  },
  {
    id: "WORK_ITEMS_WITHIN_RU_PATHS",
    severity: "error",
    check(proposal) {
      const ruPathsMap = new Map();
      for (const ru of (proposal.responsibilityUnits ?? [])) {
        ruPathsMap.set(ru.id, ru.owns ?? []);
      }
      const violations = [];
      for (const wi of (proposal.workItems ?? [])) {
        const ruPaths = ruPathsMap.get(wi.responsibilityUnitId);
        if (!ruPaths) {
          violations.push(`${wi.id} references unknown RU ${wi.responsibilityUnitId}`);
          continue;
        }
        for (const wiPath of (wi.allowedPaths ?? [])) {
          const covered = ruPaths.some(ruPath => patternsOverlap(wiPath, ruPath));
          if (!covered) {
            violations.push(`${wi.id} path "${wiPath}" not within RU ${wi.responsibilityUnitId} ownership`);
          }
        }
      }
      return violations.length === 0 ? null : `Work item paths outside RU ownership: ${violations.join("; ")}`;
    }
  },
  {
    id: "ALLOWED_PATHS_ARE_VALID",
    severity: "error",
    check(proposal) {
      const invalid = [];
      for (const ru of (proposal.responsibilityUnits ?? [])) {
        for (const p of (ru.owns ?? [])) {
          if (invalidAllowedPathPattern(p)) {
            invalid.push(`RU ${ru.id}: ${p}`);
          }
        }
      }
      for (const wi of (proposal.workItems ?? [])) {
        for (const p of (wi.allowedPaths ?? [])) {
          if (invalidAllowedPathPattern(p)) {
            invalid.push(`WI ${wi.id}: ${p}`);
          }
        }
      }
      return invalid.length === 0 ? null : `Invalid allowed paths: ${invalid.join(", ")}`;
    }
  },
  {
    id: "EVERY_RU_HAS_WORK_ITEMS",
    severity: "warning",
    check(proposal) {
      const coveredRUs = new Set((proposal.workItems ?? []).map(wi => wi.responsibilityUnitId));
      const uncovered = (proposal.responsibilityUnits ?? []).filter(ru => !coveredRUs.has(ru.id));
      return uncovered.length === 0 ? null : `RUs without work items: ${uncovered.map(ru => ru.id).join(", ")}`;
    }
  },
  {
    id: "EVERY_CONTRACT_HAS_PROVIDER_WORK_ITEM",
    severity: "warning",
    check(proposal) {
      const implementedContracts = new Set(
        (proposal.workItems ?? []).flatMap(wi => wi.contractIds ?? [])
      );
      const uncovered = (proposal.contracts ?? []).filter(c => !implementedContracts.has(c.contractId));
      return uncovered.length === 0 ? null : `Contracts without work items: ${uncovered.map(c => c.contractId).join(", ")}`;
    }
  },
  {
    id: "ACCEPTANCE_CRITERIA_COVERED",
    severity: "warning",
    check(proposal) {
      const covered = new Set(
        (proposal.workItems ?? []).flatMap(wi => wi.acceptanceCriteriaIds ?? [])
      );
      const uncovered = (proposal.intent?.acceptanceCriteria ?? []).filter(ac => !covered.has(ac.id));
      return uncovered.length === 0 ? null : `Uncovered AC: ${uncovered.map(ac => ac.id).join(", ")}`;
    }
  },
  {
    id: "VERIFICATION_COMMANDS_PARSE",
    severity: "error",
    check(proposal) {
      const invalid = [];
      for (const wi of (proposal.workItems ?? [])) {
        for (const vc of (wi.verificationCommands ?? [])) {
          if (vc.command && typeof vc.command === "string") {
            // String command — convert to structured for validation
            continue; // String commands are handled by normalizer
          }
          if (vc.command && typeof vc.command === "object") {
            const result = normalizeVerificationCommand(vc.command);
            if (!result.ok) {
              invalid.push(`${wi.id}: ${result.reason}`);
            }
          }
        }
      }
      return invalid.length === 0 ? null : `Invalid verification commands: ${invalid.join("; ")}`;
    }
  },
  {
    id: "WORK_ITEM_COUNT_WITHIN_LIMITS",
    severity: "error",
    check(proposal) {
      return (proposal.workItems ?? []).length <= 12
        ? null
        : `Too many work items: ${proposal.workItems.length} (max 12)`;
    }
  },
  {
    id: "DEPENDENCY_DEPTH_WITHIN_LIMITS",
    severity: "warning",
    check(proposal) {
      const depth = longestPathDepth(proposal.workItems ?? []);
      return depth <= 5
        ? null
        : `Dependency chain too deep: ${depth} (recommended max 5)`;
    }
  }
];

/**
 * Validate a BlueprintProposal.
 * @param {object} proposal - The BlueprintProposal from Claude
 * @returns {{ ok: boolean, errors: Array<{code: string, reason: string}>, warnings: Array<{code: string, reason: string}> }}
 */
export function validateBlueprintProposal(proposal) {
  if (!proposal || typeof proposal !== "object") {
    return {
      ok: false,
      errors: [{ code: "INVALID_PROPOSAL", reason: "Proposal must be a non-null object" }],
      warnings: []
    };
  }

  // Check required top-level fields
  const requiredFields = ["intent", "architecture", "responsibilityUnits", "contracts", "workItems"];
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
      if (rule.severity === "error") {
        errors.push({ code: rule.id, reason });
      } else {
        warnings.push({ code: rule.id, reason });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
