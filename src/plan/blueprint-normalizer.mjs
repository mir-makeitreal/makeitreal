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

const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.+)$/i;

function parseHttpEndpoint(contractName) {
  const trimmed = String(contractName ?? "").trim();
  const match = trimmed.match(HTTP_METHOD_PATTERN);
  if (match) {
    const method = match[1].toLowerCase();
    const rawPath = match[2].trim();
    const path = rawPath.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, "{$1}");
    return { method, path };
  }
  // No silent default. Validation (CONTRACT_NAME_INVALID) must reject this
  // before normalization; reaching here means the validator was bypassed.
  throw new Error(`HTTP contract name must be in format "METHOD /path": ${JSON.stringify(contractName)}`);
}

function operationIdFor(method, urlPath) {
  const pathSlug = String(urlPath)
    .replace(/[{}]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return pathSlug ? `${method}-${pathSlug}` : method;
}

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
    name: input.name,
    type: input.type,
    ...(input.required !== undefined ? { required: input.required } : {})
  }));
  const outputs = (contract.outputs ?? []).map(output => ({
    name: output.name,
    type: output.type
  }));
  const errors = (contract.errors ?? []).map(err => ({
    code: err.code,
    when: err.when
  }));

  // No fabricated signature. An opaque contract with no inputs/outputs is valid.
  return { inputs, outputs, errors };
}

function ensureContracts(module) {
  // No default contract. Modules with no declared contracts get empty publicSurfaces.
  return (module.contracts ?? []).map(c => ({ ...c }));
}

function buildAcceptanceCriteria(proposal) {
  const raw = proposal.acceptanceCriteria ?? [];
  const criteria = raw.map((statement, index) => ({
    id: `AC-${String(index + 1).padStart(3, "0")}`,
    statement: String(statement)
  }));
  // No fabricated criteria. Validation (ACCEPTANCE_CRITERIA_REQUIRED) guarantees
  // at least one concrete criterion before normalization runs.
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
  // No fabricated goals/nonGoals. Use what the LLM provided, or empty arrays.
  const goals = proposal.goals ?? [];
  const userVisibleBehavior = proposal.userVisibleBehavior ?? goals;
  const nonGoals = proposal.nonGoals ?? [];

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
      kind: contract.surfaceKind ?? contract.type,
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
      owner: m.owner ?? null,
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

function buildDesignPack(proposal, modules, moduleContracts, acceptanceCriteria, runId, workItems) {
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
      owner: m.owner ?? null,
      purpose: m.purpose,
      owns: [...(m.ownedPaths ?? [])],
      mustProvideContracts: own.map(c => c.contractId),
      publicSurfaces: own.map(({ contract, contractId }) => ({
        name: contract.name,
        kind: contract.surfaceKind ?? contract.type,
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

  return {
    schemaVersion: "1.0",
    runId: runId ?? null,
    workItemId,
    prdId: `prd.${slug}`,
    architecture: { nodes, edges },
    stateFlow: proposal.stateFlow ?? null,
    apiSpecs,
    componentContracts,
    responsibilityBoundaries,
    moduleInterfaces,
    callStacks,
    sequences
  };
}

function parseVerifyCommand(verifyCommand) {
  // No silent default. Validation (VERIFY_COMMAND_REQUIRED) guarantees a concrete
  // command before normalization; missing/unparseable input returns null.
  if (!verifyCommand) {
    return null;
  }
  if (typeof verifyCommand === "string") {
    const parts = verifyCommand.trim().split(/\s+/);
    return { file: parts[0], args: parts.slice(1) };
  }
  if (typeof verifyCommand === "object" && verifyCommand.file) {
    return { file: verifyCommand.file, args: verifyCommand.args ?? [] };
  }
  return null;
}

function buildWorkItems(proposal, modules, moduleContracts, acceptanceCriteria, prd, warnings) {
  const allCriterionIds = acceptanceCriteria.map(ac => ac.id);
  const modulesByName = new Map(modules.map(m => [m.name, m]));

  return (proposal.workItems ?? []).map(wi => {
    const module = modulesByName.get(wi.module);
    if (!module) return null;

    const own = moduleContracts.get(module.name) ?? [];
    const ownIds = own.map(c => c.contractId);
    const dependencyContracts = (module.dependsOn ?? []).flatMap(dep => {
      const depContracts = moduleContracts.get(dep) ?? [];
      return depContracts.map(c => ({
        contractId: c.contractId,
        providerResponsibilityUnitId: ruIdFor(dep),
        surface: c.contract.name,
        allowedUse: dep.allowedUse ?? "consume"
      }));
    });
    const depIds = dependencyContracts.map(d => d.contractId);
    const contractIds = [...new Set([...ownIds, ...depIds])];

    const verifyCommand = parseVerifyCommand(wi.verifyCommand);
    const verificationCommands = verifyCommand ? [verifyCommand] : [];

    const rawDepsOn = wi.dependsOn ?? [];
    return {
      schemaVersion: "1.0",
      id: workIdFor(module.name),
      title: wi.title,
      prdId: prd.id,
      lane: wi.lane ?? "Contract Frozen",
      kind: wi.kind ?? "implementation",
      responsibilityUnitId: ruIdFor(module.name),
      contractIds,
      dependencyContracts,
      dependsOn: rawDepsOn.map(d => workIdFor(typeof d === "string" ? d : (d.module ?? d.name ?? d))),
      dependsOnEdgeKinds: Object.fromEntries(rawDepsOn.map(d => {
        const depId = workIdFor(typeof d === "string" ? d : (d.module ?? d.name ?? d));
        const kind = typeof d === "object" ? (d.edgeKind ?? d.kind ?? "contract-dependency") : "contract-dependency";
        return [depId, kind];
      })),
      allowedPaths: [...(module.ownedPaths ?? [])],
      prdTrace: { acceptanceCriteriaIds: [...allCriterionIds] },
      doneEvidence: (wi.doneEvidence ?? []).map(e => ({ kind: e.kind, path: e.path })),
      verificationCommands
    };
  }).filter(Boolean);
}

function buildWorkItemDag(workItems, modules, moduleContracts) {
  const moduleByWorkId = new Map();
  for (const m of modules) {
    moduleByWorkId.set(workIdFor(m.name), m.name);
  }

  return {
    schemaVersion: "1.0",
    nodes: workItems.map(wi => ({
      id: wi.id,
      kind: wi.kind ?? "implementation",
      responsibilityUnitId: wi.responsibilityUnitId,
      requiredForDone: true
    })),
    edges: workItems.flatMap(wi => {
      return (wi.dependsOn ?? []).map(depWorkId => {
        const providerModuleName = moduleByWorkId.get(depWorkId);
        const providerContracts = providerModuleName
          ? (moduleContracts.get(providerModuleName) ?? [])
          : [];
        const edge = {
          from: depWorkId,
          to: wi.id,
          kind: (wi.dependsOnEdgeKinds ?? {})[depWorkId] ?? "contract-dependency"
        };
        if (providerContracts.length > 0) {
          edge.contractId = providerContracts[0].contractId;
          edge.contractIds = providerContracts.map(c => c.contractId);
        }
        return edge;
      });
    })
  };
}

const NO_BODY_METHODS = new Set(["get", "head", "delete", "options"]);

function buildOpenApiDocument(contract, contractId) {
  const { method, path: urlPath } = parseHttpEndpoint(contract.name);
  const inputs = contract.inputs ?? [];
  const outputs = contract.outputs ?? [];
  const errors = contract.errors ?? [];
  const hasInputs = inputs.length > 0;
  const isNoBodyMethod = NO_BODY_METHODS.has(method);

  let requestBody = null;
  let parameters = null;
  if (isNoBodyMethod) {
    parameters = inputs.map((input) => ({
      name: input.name,
      in: "query",
      required: false,
      schema: { type: input.type ?? "string" }
    }));
  } else {
    requestBody = {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: inputs.reduce((acc, input) => {
              acc[input.name] = { type: input.type ?? "string" };
              return acc;
            }, {}),
            required: inputs.filter(input => input.required).map(input => input.name)
          }
        }
      }
    };
    if (hasInputs) requestBody.required = true;
  }

  const errorsByStatus = new Map();
  for (const err of errors) {
    const status = err.httpStatus ?? "400";
    if (!errorsByStatus.has(status)) errorsByStatus.set(status, []);
    errorsByStatus.get(status).push(err);
  }

  const responses = {
    "200": {
      description: "Success",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: outputs.reduce((acc, output) => {
              acc[output.name] = { type: output.type ?? "string" };
              return acc;
            }, {})
          }
        }
      }
    }
  };
  for (const [status, errs] of errorsByStatus) {
    const description = errs
      .map(e => `${e.code ?? "ERROR"}: ${e.when ?? "Error response"}`)
      .join("; ");
    responses[status] = { description };
  }

  const operation = {
    operationId: operationIdFor(method, urlPath),
    summary: contract.name,
    ...(isNoBodyMethod ? { parameters } : { requestBody }),
    responses
  };

  return {
    openapi: "3.0.3",
    info: { title: contract.name, version: "1.0.0" },
    paths: {
      [urlPath]: {
        [method]: operation
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

  const warnings = [];

  const prd = buildPrd(proposal, acceptanceCriteria);
  const responsibilityUnits = buildResponsibilityUnits(modules, moduleContracts);
  const workItems = buildWorkItems(proposal, modules, moduleContracts, acceptanceCriteria, prd, warnings);

  const designPack = buildDesignPack(proposal, modules, moduleContracts, acceptanceCriteria, null, workItems);
  const workItemDag = buildWorkItemDag(workItems, modules, moduleContracts);

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

  return { prd, designPack, responsibilityUnits, workItems, workItemDag, contracts, warnings };
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
