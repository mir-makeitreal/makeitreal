import path from "node:path";
import { writeJsonFile } from "../io/json.mjs";

/**
 * Slugify a string for use in IDs and file names.
 */
function slugify(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = normalized.length > 48
    ? normalized.slice(0, 48).replace(/-[^-]*$/, "")
    : normalized;
  return truncated || "blueprint";
}

const CANONICAL_LANES = [
  "Intake", "Discovery", "Scoped", "Blueprint Bound",
  "Contract Frozen", "Ready", "Claimed", "Running",
  "Verifying", "Human Review", "Done"
];

const CANONICAL_TRANSITIONS = [
  { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
  { from: "Human Review", to: "Done", gate: "wiki" }
];

function normalizePrd(intent) {
  const slug = slugify(intent.title);
  return {
    schemaVersion: "1.0",
    id: `prd.${slug}`,
    title: intent.title,
    goals: intent.goals ?? [],
    userVisibleBehavior: intent.userVisibleBehavior ?? [],
    acceptanceCriteria: (intent.acceptanceCriteria ?? []).map(ac => ({
      id: ac.id,
      statement: ac.statement
    })),
    nonGoals: intent.nonGoals ?? [],
    request: intent.summary ?? ""
  };
}

function normalizeDesignPack(proposal, runId) {
  const slug = slugify(proposal.intent.title);
  const workItemId = proposal.workItems[0]?.id ?? `wi.${slug}`;

  return {
    schemaVersion: "1.0",
    runId: runId ?? null,
    workItemId,
    prdId: `prd.${slug}`,
    architecture: {
      nodes: (proposal.architecture.nodes ?? []).map(n => ({
        id: n.id,
        label: n.label,
        responsibilityUnitId: n.responsibilityUnitId
      })),
      edges: (proposal.architecture.edges ?? []).map(e => ({
        from: e.from,
        to: e.to,
        contractId: e.contractId
      }))
    },
    stateFlow: {
      lanes: CANONICAL_LANES,
      transitions: CANONICAL_TRANSITIONS
    },
    apiSpecs: (proposal.contracts ?? [])
      .filter(c => c.kind === "openapi")
      .map(c => ({
        kind: "openapi",
        contractId: c.contractId,
        path: `contracts/${slugify(c.title)}.openapi.json`
      })),
    componentContracts: (proposal.contracts ?? [])
      .filter(c => c.kind === "component")
      .map(c => ({
        kind: "component",
        contractId: c.contractId,
        path: `contracts/${slugify(c.title)}.component-contract.json`
      })),
    responsibilityBoundaries: (proposal.responsibilityUnits ?? []).map(ru => ({
      responsibilityUnitId: ru.id,
      owns: ru.owns ?? [],
      mayUseContracts: ru.mayUseContracts ?? []
    })),
    moduleInterfaces: (proposal.responsibilityUnits ?? []).map(ru => ({
      responsibilityUnitId: ru.id,
      moduleName: ru.moduleName ?? ru.label ?? ru.id,
      owner: ru.owner ?? "team.implementation",
      owns: ru.owns ?? [],
      mustProvideContracts: ru.mustProvideContracts ?? [],
      publicSurfaces: ru.publicSurfaces ?? [],
      imports: ru.imports ?? [],
      responsibility: ru.responsibility ?? ""
    })),
    callStacks: buildCallStacks(proposal),
    sequences: normalizeSequences(proposal.sequences)
  };
}

function buildCallStacks(proposal) {
  const stacks = [];
  for (const seq of (proposal.sequences ?? [])) {
    if (!seq.steps || seq.steps.length === 0) continue;
    stacks.push({
      entrypoint: seq.title,
      calls: seq.steps.map(step => `${step.from} -> ${step.to}: ${step.action}`),
      label: seq.title,
      frames: seq.steps.map(step => ({
        callee: step.to,
        caller: step.from,
        action: step.action
      }))
    });
  }
  return stacks;
}

function normalizeSequences(sequences) {
  return (sequences ?? []).map(seq => ({
    title: seq.title,
    participants: seq.participants ?? [],
    messages: (seq.steps ?? []).map(step => ({
      from: step.from,
      to: step.to,
      label: step.action,
      ...(step.data ? { data: step.data } : {})
    }))
  }));
}

function normalizeResponsibilityUnits(units) {
  return {
    schemaVersion: "1.0",
    units: (units ?? []).map(ru => ({
      id: ru.id,
      label: ru.label ?? ru.id,
      owner: ru.owner ?? "team.implementation",
      owns: ru.owns ?? [],
      mustProvideContracts: ru.mustProvideContracts ?? [],
      mayUseContracts: ru.mayUseContracts ?? [],
      responsibility: ru.responsibility ?? ""
    }))
  };
}

function normalizeWorkItem(wi) {
  const doneEvidence = [
    { kind: "verification", path: `evidence/${wi.id}.verification.json` },
    { kind: "wiki-sync", path: `evidence/${wi.id}.wiki-sync.json` }
  ];

  // Normalize verification commands: convert string commands to structured format
  const verificationCommands = (wi.verificationCommands ?? []).map(vc => {
    if (typeof vc === "string") {
      const parts = vc.split(/\s+/);
      return { file: parts[0], args: parts.slice(1) };
    }
    if (vc.command && typeof vc.command === "string") {
      // { command: "npm test", purpose: "..." } → structured
      const parts = vc.command.split(/\s+/);
      return { file: parts[0], args: parts.slice(1) };
    }
    if (vc.command && typeof vc.command === "object") {
      return vc.command;
    }
    return vc;
  });

  return {
    schemaVersion: "1.0",
    id: wi.id,
    title: wi.title,
    prdId: null, // Set by caller
    lane: "Contract Frozen",
    responsibilityUnitId: wi.responsibilityUnitId,
    contractIds: wi.contractIds ?? [],
    dependencyContracts: [],
    dependsOn: wi.dependsOn ?? [],
    allowedPaths: wi.allowedPaths ?? [],
    prdTrace: {
      acceptanceCriteriaIds: wi.acceptanceCriteriaIds ?? []
    },
    doneEvidence,
    verificationCommands
  };
}

function normalizeWorkItemDag(workItems) {
  return {
    schemaVersion: "1.0",
    nodes: (workItems ?? []).map(wi => ({
      id: wi.id,
      kind: wi.kind ?? "implementation",
      responsibilityUnitId: wi.responsibilityUnitId,
      requiredForDone: (wi.kind ?? "implementation") !== "domain-pm"
    })),
    edges: (workItems ?? []).flatMap(wi =>
      (wi.dependsOn ?? []).map(dep => ({
        from: dep,
        to: wi.id,
        kind: "contract-dependency"
      }))
    )
  };
}

function normalizeOpenApiContract(contract) {
  const surface = contract.surface ?? {};
  return {
    openapi: "3.0.3",
    info: {
      title: contract.title,
      version: "1.0.0"
    },
    paths: surface.path ? {
      [surface.path]: {
        [String(surface.method ?? "GET").toLowerCase()]: {
          summary: contract.title,
          requestBody: surface.requestSchema ? {
            content: {
              "application/json": {
                schema: surface.requestSchema
              }
            }
          } : undefined,
          responses: {
            "200": {
              description: "Success",
              content: surface.responseSchema ? {
                "application/json": {
                  schema: surface.responseSchema
                }
              } : undefined
            },
            ...(surface.errorCodes ?? []).reduce((acc, code) => {
              acc[String(code)] = { description: `Error ${code}` };
              return acc;
            }, {})
          }
        }
      }
    } : {}
  };
}

function normalizeComponentContract(contract) {
  const surface = contract.surface ?? {};
  return {
    contractId: contract.contractId,
    kind: "component",
    componentName: surface.componentName ?? contract.title,
    props: surface.props ?? [],
    title: contract.title
  };
}

/**
 * Normalize a validated BlueprintProposal into canonical artifact objects.
 * Returns the artifact objects (does NOT write files).
 */
export function normalizeBlueprintProposal(proposal) {
  const prd = normalizePrd(proposal.intent);
  const slug = slugify(proposal.intent.title);

  const workItems = (proposal.workItems ?? []).map(wi => {
    const item = normalizeWorkItem(wi);
    item.prdId = prd.id;
    return item;
  });

  return {
    prd,
    designPack: normalizeDesignPack(proposal),
    responsibilityUnits: normalizeResponsibilityUnits(proposal.responsibilityUnits),
    workItems,
    workItemDag: normalizeWorkItemDag(proposal.workItems),
    contracts: (proposal.contracts ?? []).map(c => {
      if (c.kind === "openapi") return { contract: c, document: normalizeOpenApiContract(c) };
      if (c.kind === "component") return { contract: c, document: normalizeComponentContract(c) };
      return { contract: c, document: null };
    })
  };
}

/**
 * Write normalized blueprint artifacts to disk in the run directory.
 * @param {object} normalized - Output of normalizeBlueprintProposal()
 * @param {string} runDir - Absolute path to the run directory
 * @param {string} [runId] - Optional run ID to set on design pack
 */
export async function writeBlueprintArtifacts(normalized, runDir, runId) {
  const { prd, designPack, responsibilityUnits, workItems, workItemDag, contracts } = normalized;

  if (runId) {
    designPack.runId = runId;
  }

  await writeJsonFile(path.join(runDir, "prd.json"), prd);
  await writeJsonFile(path.join(runDir, "design-pack.json"), designPack);
  await writeJsonFile(path.join(runDir, "responsibility-units.json"), responsibilityUnits);

  for (const item of workItems) {
    await writeJsonFile(path.join(runDir, "work-items", `${item.id}.json`), item);
  }

  await writeJsonFile(path.join(runDir, "work-item-dag.json"), workItemDag);

  for (const { contract, document } of contracts) {
    if (!document) continue;
    const slug = slugify(contract.title);
    if (contract.kind === "openapi") {
      await writeJsonFile(path.join(runDir, "contracts", `${slug}.openapi.json`), document);
    } else if (contract.kind === "component") {
      await writeJsonFile(path.join(runDir, "contracts", `${slug}.component-contract.json`), document);
    }
  }

  return { ok: true, runDir };
}
