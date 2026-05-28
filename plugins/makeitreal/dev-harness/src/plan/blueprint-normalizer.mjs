import path from "node:path";
import { writeJsonFile } from "../io/json.mjs";

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

const SURFACE_KIND_BY_TYPE = {
  http: "http",
  function: "module",
  event: "event",
  component: "component"
};

function ruIdFor(moduleName) {
  return `ru.${slugify(moduleName)}`;
}

function contractIdFor(moduleName, contractName) {
  return `contract.${slugify(moduleName)}.${slugify(contractName)}`;
}

function workIdFor(moduleName) {
  return `work.${slugify(moduleName)}`;
}

function defaultSignature(contract) {
  const inputs = (contract.inputs ?? []).map(input => ({
    name: input.name ?? "input",
    type: input.type ?? "object",
    ...(input.required !== undefined ? { required: input.required } : {})
  }));
  const outputs = (contract.outputs ?? []).map(output => ({
    name: output.name ?? "result",
    type: output.type ?? "object"
  }));
  const errors = (contract.errors ?? []).map(err => ({
    code: err.code ?? "INTERNAL_ERROR",
    when: err.when ?? "Unexpected failure"
  }));

  return {
    inputs: inputs.length > 0 ? inputs : [{ name: "input", type: "object" }],
    outputs: outputs.length > 0 ? outputs : [{ name: "result", type: "object" }],
    errors: errors.length > 0 ? errors : [{ code: "INTERNAL_ERROR", when: "Unexpected failure" }]
  };
}

function ensureContracts(module) {
  const contracts = (module.contracts ?? []).map(c => ({ ...c }));
  if (contracts.length === 0) {
    contracts.push({
      name: "default",
      type: "function",
      inputs: [],
      outputs: [],
      errors: []
    });
  }
  return contracts;
}

function buildAcceptanceCriteria(proposal) {
  const raw = proposal.acceptanceCriteria ?? [];
  const criteria = raw.map((statement, index) => ({
    id: `AC-${String(index + 1).padStart(3, "0")}`,
    statement: String(statement)
  }));
  if (criteria.length === 0) {
    criteria.push({ id: "AC-001", statement: `Deliver ${proposal.title}.` });
  }
  return criteria;
}

function moduleContractMaps(modules) {
  const moduleContracts = new Map();
  for (const m of modules) {
    const contracts = ensureContracts(m).map(c => ({
      contract: c,
      contractId: contractIdFor(m.name, c.name)
    }));
    moduleContracts.set(m.name, contracts);
  }
  return moduleContracts;
}

function buildPrd(proposal, acceptanceCriteria) {
  const slug = slugify(proposal.title);
  const goals = (proposal.goals ?? []).length > 0
    ? proposal.goals
    : [`Deliver ${proposal.title}.`];
  const userVisibleBehavior = goals;
  const nonGoals = (proposal.nonGoals ?? []).length > 0
    ? proposal.nonGoals
    : [`Out of scope items for ${proposal.title}.`];

  return {
    schemaVersion: "1.0",
    id: `prd.${slug}`,
    title: proposal.title,
    goals,
    userVisibleBehavior,
    acceptanceCriteria: acceptanceCriteria.map(ac => ({ id: ac.id, statement: ac.statement })),
    nonGoals,
    request: proposal.summary ?? ""
  };
}

function buildResponsibilityUnits(modules, moduleContracts) {
  const units = modules.map(m => {
    const own = moduleContracts.get(m.name) ?? [];
    const mustProvide = own.map(c => c.contractId);
    const mayUse = [
      ...mustProvide,
      ...((m.dependsOn ?? []).flatMap(dep =>
        (moduleContracts.get(dep) ?? []).map(c => c.contractId)
      ))
    ];

    const publicSurfaces = own.map(({ contract, contractId }) => ({
      name: contract.name,
      kind: SURFACE_KIND_BY_TYPE[contract.type] ?? "module",
      contractIds: [contractId],
      signature: defaultSignature(contract)
    }));

    const imports = (m.dependsOn ?? []).flatMap(dep => {
      const depContracts = moduleContracts.get(dep) ?? [];
      return depContracts.map(c => ({
        contractId: c.contractId,
        providerResponsibilityUnitId: ruIdFor(dep),
        surface: c.contract.name
      }));
    });

    return {
      id: ruIdFor(m.name),
      label: m.name,
      moduleName: m.name,
      owner: "team.implementation",
      owns: [...(m.ownedPaths ?? [])],
      mustProvideContracts: mustProvide,
      mayUseContracts: [...new Set(mayUse)],
      publicSurfaces,
      imports,
      purpose: m.purpose,
      responsibility: m.purpose
    };
  });

  return { schemaVersion: "1.0", units };
}

function apiSpecFor(contract, contractId) {
  if (contract.type === "http") {
    return {
      kind: "openapi",
      contractId,
      path: `contracts/${slugify(contract.name)}.openapi.json`
    };
  }
  return {
    kind: "none",
    contractId,
    reason: `${contract.name} (${contract.type}) is a non-HTTP contract.`
  };
}

function buildDesignPack(proposal, modules, moduleContracts, acceptanceCriteria, runId) {
  const slug = slugify(proposal.title);
  const firstModule = modules[0];
  const workItemId = workIdFor(firstModule?.name ?? "blueprint");

  const nodes = modules.map(m => ({
    id: ruIdFor(m.name),
    label: m.name,
    responsibilityUnitId: ruIdFor(m.name)
  }));

  const edges = [];
  for (const m of modules) {
    for (const dep of (m.dependsOn ?? [])) {
      const depContracts = moduleContracts.get(dep) ?? [];
      const firstContract = depContracts[0];
      const edge = {
        from: ruIdFor(dep),
        to: ruIdFor(m.name)
      };
      if (firstContract) edge.contractId = firstContract.contractId;
      edges.push(edge);
    }
  }

  const allContracts = [];
  for (const m of modules) {
    for (const entry of (moduleContracts.get(m.name) ?? [])) {
      allContracts.push({ ...entry, module: m });
    }
  }

  const apiSpecs = allContracts.map(({ contract, contractId }) => apiSpecFor(contract, contractId));

  const componentContracts = allContracts
    .filter(({ contract }) => contract.type === "component")
    .map(({ contract, contractId }) => ({
      kind: "component",
      contractId,
      path: `contracts/${slugify(contract.name)}.component-contract.json`
    }));

  const responsibilityBoundaries = modules.map(m => {
    const own = moduleContracts.get(m.name) ?? [];
    const mayUse = [
      ...own.map(c => c.contractId),
      ...((m.dependsOn ?? []).flatMap(dep =>
        (moduleContracts.get(dep) ?? []).map(c => c.contractId)
      ))
    ];
    return {
      responsibilityUnitId: ruIdFor(m.name),
      owns: [...(m.ownedPaths ?? [])],
      mayUseContracts: [...new Set(mayUse)]
    };
  });

  const moduleInterfaces = modules.map(m => {
    const own = moduleContracts.get(m.name) ?? [];
    return {
      responsibilityUnitId: ruIdFor(m.name),
      moduleName: m.name,
      owner: "team.implementation",
      purpose: m.purpose,
      owns: [...(m.ownedPaths ?? [])],
      mustProvideContracts: own.map(c => c.contractId),
      publicSurfaces: own.map(({ contract, contractId }) => ({
        name: contract.name,
        kind: SURFACE_KIND_BY_TYPE[contract.type] ?? "module",
        contractIds: [contractId],
        signature: defaultSignature(contract)
      })),
      imports: (m.dependsOn ?? []).flatMap(dep => {
        const depContracts = moduleContracts.get(dep) ?? [];
        return depContracts.map(c => ({
          contractId: c.contractId,
          providerResponsibilityUnitId: ruIdFor(dep),
          surface: c.contract.name
        }));
      }),
      responsibility: m.purpose
    };
  });

  const sequences = (proposal.scenarios ?? []).map(scenario => {
    const participants = [...new Set(
      (scenario.steps ?? []).flatMap(step => [step.from, step.to]).filter(Boolean)
    )];
    return {
      title: scenario.title,
      participants,
      messages: (scenario.steps ?? []).map(step => ({
        from: step.from,
        to: step.to,
        label: step.action
      }))
    };
  });

  const callStacks = (proposal.scenarios ?? []).map(scenario => ({
    entrypoint: scenario.title,
    calls: (scenario.steps ?? []).map(step => `${step.from} -> ${step.to}: ${step.action}`),
    label: scenario.title,
    frames: (scenario.steps ?? []).map(step => ({
      callee: step.to,
      caller: step.from,
      action: step.action
    }))
  }));

  if (callStacks.length === 0) {
    callStacks.push({
      entrypoint: proposal.title,
      calls: modules.map(m => `Caller -> ${m.name}: invoke`),
      label: proposal.title,
      frames: modules.map(m => ({ callee: m.name, caller: "Caller", action: "invoke" }))
    });
  }

  if (sequences.length === 0) {
    sequences.push({
      title: `${proposal.title} flow`,
      participants: ["Caller", ...modules.map(m => m.name)],
      messages: modules.map(m => ({ from: "Caller", to: m.name, label: "invoke" }))
    });
  }

  return {
    schemaVersion: "1.0",
    runId: runId ?? null,
    workItemId,
    prdId: `prd.${slug}`,
    architecture: { nodes, edges },
    stateFlow: { lanes: CANONICAL_LANES, transitions: CANONICAL_TRANSITIONS },
    apiSpecs,
    componentContracts,
    responsibilityBoundaries,
    moduleInterfaces,
    callStacks,
    sequences
  };
}

function parseVerifyCommand(verifyCommand) {
  if (!verifyCommand) {
    return { file: "node", args: ["--test"] };
  }
  if (typeof verifyCommand === "string") {
    const parts = verifyCommand.trim().split(/\s+/);
    return { file: parts[0], args: parts.slice(1) };
  }
  if (typeof verifyCommand === "object" && verifyCommand.file) {
    return { file: verifyCommand.file, args: verifyCommand.args ?? [] };
  }
  return { file: "node", args: ["--test"] };
}

function buildWorkItems(proposal, modules, moduleContracts, acceptanceCriteria, prd) {
  const allCriterionIds = acceptanceCriteria.map(ac => ac.id);
  const modulesByName = new Map(modules.map(m => [m.name, m]));

  return (proposal.workItems ?? []).map(wi => {
    const module = modulesByName.get(wi.module);
    if (!module) return null;

    const own = moduleContracts.get(module.name) ?? [];
    const ownIds = own.map(c => c.contractId);
    const depIds = (module.dependsOn ?? []).flatMap(dep =>
      (moduleContracts.get(dep) ?? []).map(c => c.contractId)
    );
    const contractIds = [...new Set([...ownIds, ...depIds])];

    const verifyCommand = parseVerifyCommand(wi.verifyCommand);
    const verificationCommands = [verifyCommand];

    const moduleHasHttp = own.some(({ contract }) => contract.type === "http");
    const doneEvidence = [
      { kind: "verification", path: `evidence/${workIdFor(module.name)}.verification.json` },
      { kind: "wiki-sync", path: `evidence/${workIdFor(module.name)}.wiki-sync.json` }
    ];
    if (moduleHasHttp) {
      doneEvidence.push({
        kind: "openapi-conformance",
        path: `evidence/${workIdFor(module.name)}.openapi-conformance.json`
      });
    }

    return {
      schemaVersion: "1.0",
      id: workIdFor(module.name),
      title: wi.title,
      prdId: prd.id,
      lane: "Contract Frozen",
      responsibilityUnitId: ruIdFor(module.name),
      contractIds,
      dependencyContracts: [],
      dependsOn: (wi.dependsOn ?? []).map(workIdFor),
      allowedPaths: [...(module.ownedPaths ?? [])],
      prdTrace: { acceptanceCriteriaIds: [...allCriterionIds] },
      doneEvidence,
      verificationCommands
    };
  }).filter(Boolean);
}

function buildWorkItemDag(workItems) {
  return {
    schemaVersion: "1.0",
    nodes: workItems.map(wi => ({
      id: wi.id,
      kind: "implementation",
      responsibilityUnitId: wi.responsibilityUnitId,
      requiredForDone: true
    })),
    edges: workItems.flatMap(wi =>
      (wi.dependsOn ?? []).map(dep => ({
        from: dep,
        to: wi.id,
        kind: "contract-dependency"
      }))
    )
  };
}

function buildOpenApiDocument(contract, contractId) {
  return {
    openapi: "3.0.3",
    info: { title: contract.name, version: "1.0.0" },
    paths: {
      [`/${slugify(contract.name)}`]: {
        post: {
          summary: contract.name,
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: (contract.inputs ?? []).reduce((acc, input) => {
                    acc[input.name] = { type: input.type ?? "string" };
                    return acc;
                  }, {}),
                  required: (contract.inputs ?? [])
                    .filter(input => input.required)
                    .map(input => input.name)
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Success",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: (contract.outputs ?? []).reduce((acc, output) => {
                      acc[output.name] = { type: output.type ?? "string" };
                      return acc;
                    }, {})
                  }
                }
              }
            },
            ...(contract.errors ?? []).reduce((acc, err) => {
              acc[err.code] = { description: err.when ?? `Error ${err.code}` };
              return acc;
            }, {})
          }
        }
      }
    }
  };
}

function buildComponentDocument(contract, contractId) {
  return {
    contractId,
    kind: "component",
    componentName: contract.name,
    props: (contract.inputs ?? []).map(input => ({
      name: input.name,
      type: input.type,
      required: input.required ?? false
    })),
    title: contract.name
  };
}

export function normalizeBlueprintProposal(proposal) {
  const modules = proposal.modules ?? [];
  const moduleContracts = moduleContractMaps(modules);
  const acceptanceCriteria = buildAcceptanceCriteria(proposal);

  const prd = buildPrd(proposal, acceptanceCriteria);
  const designPack = buildDesignPack(proposal, modules, moduleContracts, acceptanceCriteria, null);
  const responsibilityUnits = buildResponsibilityUnits(modules, moduleContracts);
  const workItems = buildWorkItems(proposal, modules, moduleContracts, acceptanceCriteria, prd);
  const workItemDag = buildWorkItemDag(workItems);

  const contracts = [];
  for (const m of modules) {
    for (const { contract, contractId } of (moduleContracts.get(m.name) ?? [])) {
      let document = null;
      if (contract.type === "http") document = buildOpenApiDocument(contract, contractId);
      else if (contract.type === "component") document = buildComponentDocument(contract, contractId);
      contracts.push({
        contract: { contractId, kind: contract.type === "http" ? "openapi" : contract.type, title: contract.name },
        document
      });
    }
  }

  return { prd, designPack, responsibilityUnits, workItems, workItemDag, contracts };
}

export async function writeBlueprintArtifacts(normalized, runDir, runId) {
  const { prd, designPack, responsibilityUnits, workItems, workItemDag, contracts } = normalized;

  if (runId) designPack.runId = runId;

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
