function unitIndex(responsibilityUnits) {
  return new Map((responsibilityUnits?.units ?? []).map((unit) => [unit.id, unit]));
}

function normalizeSurface(surface) {
  return {
    name: surface.name,
    kind: surface.kind,
    description: surface.description ?? "",
    contractIds: surface.contractIds,
    consumers: surface.consumers ?? [],
    signature: surface.signature
  };
}

export function modelContracts(apiSpecs = []) {
  return apiSpecs.map((spec) => ({
    kind: spec.kind,
    contractId: spec.contractId ?? null,
    path: spec.path ?? null,
    reason: spec.reason ?? null
  }));
}

export function modelBoundaries(boundaries = []) {
  return boundaries.map((boundary) => ({
    responsibilityUnitId: boundary.responsibilityUnitId,
    owns: boundary.owns ?? [],
    mayUseContracts: boundary.mayUseContracts ?? []
  }));
}

export function modelModuleInterfaces({ designPack, responsibilityUnits }) {
  const units = unitIndex(responsibilityUnits);
  return (designPack.moduleInterfaces ?? []).map((moduleInterface) => {
    const unit = units.get(moduleInterface.responsibilityUnitId) ?? {};
    return {
      responsibilityUnitId: moduleInterface.responsibilityUnitId,
      owner: moduleInterface.owner ?? unit.owner ?? null,
      moduleName: moduleInterface.moduleName ?? moduleInterface.responsibilityUnitId,
      purpose: moduleInterface.purpose ?? null,
      owns: moduleInterface.owns ?? unit.owns ?? [],
      publicSurfaces: (moduleInterface.publicSurfaces ?? []).map(normalizeSurface),
      imports: moduleInterface.imports ?? []
    };
  });
}

function uniqueText(values = []) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

function contractIndex(contracts = []) {
  return new Map(contracts.map((contract) => [contract.contractId, contract]).filter(([contractId]) => Boolean(contractId)));
}

function contractSummary(contract, fallbackReason = "Declared boundary contract.") {
  if (!contract) {
    return fallbackReason;
  }
  if (contract.kind === "none") {
    return contract.reason ?? fallbackReason;
  }
  return `${contract.kind} contract at ${contract.path}`;
}

function architectureNodeFor(nodes = [], id) {
  return nodes.find((candidate) => candidate.id === id || candidate.responsibilityUnitId === id) ?? null;
}

function traceabilityNode(node) {
  return node?.id === "prd" || node?.label === "PRD Source";
}

function architectureEndpointModule({ nodes = [], moduleByResponsibilityUnit, id }) {
  const node = nodes.find((candidate) => candidate.id === id || candidate.responsibilityUnitId === id);
  if (node?.responsibilityUnitId && moduleByResponsibilityUnit.has(node.responsibilityUnitId)) {
    return moduleByResponsibilityUnit.get(node.responsibilityUnitId);
  }
  if (moduleByResponsibilityUnit.has(id)) {
    return moduleByResponsibilityUnit.get(id);
  }
  return null;
}

function softwareArchitectureEdges({ designPack, moduleInterfaces }) {
  const architecture = designPack.architecture ?? {};
  const nodes = architecture.nodes ?? [];
  const moduleByResponsibilityUnit = new Map(moduleInterfaces.map((moduleInterface) => [moduleInterface.responsibilityUnitId, moduleInterface]));
  return (architecture.edges ?? [])
    .map((edge) => {
      const fromNode = architectureNodeFor(nodes, edge.from);
      const toNode = architectureNodeFor(nodes, edge.to);
      if (traceabilityNode(fromNode) || traceabilityNode(toNode)) {
        return null;
      }
      const fromModule = architectureEndpointModule({ nodes, moduleByResponsibilityUnit, id: edge.from });
      const toModule = architectureEndpointModule({ nodes, moduleByResponsibilityUnit, id: edge.to });
      if (!fromModule || !toModule || fromModule.responsibilityUnitId === toModule.responsibilityUnitId) {
        return null;
      }
      return { edge, fromModule, toModule };
    })
    .filter(Boolean);
}

function modulesForArchitectureEndpoint({ contractId, endpoint, designPack, moduleInterfaces }) {
  return uniqueText(softwareArchitectureEdges({ designPack, moduleInterfaces })
    .filter(({ edge }) => edge.contractId === contractId)
    .map(({ fromModule, toModule }) => endpoint === "from" ? fromModule.moduleName : toModule.moduleName)
    .filter(Boolean));
}

function modelDependencyEdges({ designPack, contracts }) {
  const contractsById = contractIndex(contracts);
  const moduleInterfaces = designPack.moduleInterfaces ?? [];
  const moduleByResponsibilityUnit = new Map(moduleInterfaces.map((moduleInterface) => [moduleInterface.responsibilityUnitId, moduleInterface]));
  const architectureEdges = softwareArchitectureEdges({ designPack, moduleInterfaces }).map(({ edge, fromModule, toModule }) => ({
    from: fromModule.responsibilityUnitId,
    fromLabel: fromModule.moduleName,
    to: toModule.responsibilityUnitId,
    toLabel: toModule.moduleName,
    contractId: edge.contractId ?? null,
    contractKind: contractsById.get(edge.contractId)?.kind ?? "contract",
    allowedUse: contractSummary(contractsById.get(edge.contractId), "Architecture dependency.")
  }));

  const importEdges = moduleInterfaces.flatMap((moduleInterface) =>
    (moduleInterface.imports ?? []).map((dependency) => {
      const provider = moduleByResponsibilityUnit.get(dependency.providerResponsibilityUnitId);
      return {
      from: moduleInterface.responsibilityUnitId,
      fromLabel: moduleInterface.moduleName ?? moduleInterface.responsibilityUnitId,
      to: provider.responsibilityUnitId,
      toLabel: provider.moduleName,
      surface: dependency.surface ?? null,
      contractId: dependency.contractId ?? null,
      contractKind: contractsById.get(dependency.contractId)?.kind ?? "import",
      allowedUse: dependency.allowedUse ?? contractSummary(contractsById.get(dependency.contractId), "Declared module import.")
    };
  })
  );

  const seen = new Set();
  return [...importEdges, ...architectureEdges].filter((edge) => {
    const key = `${edge.from}|${edge.to}|${edge.contractId}|${edge.allowedUse}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function surfaceProvidersForContract({ contractId, moduleInterfaces }) {
  return moduleInterfaces
    .filter((moduleInterface) => {
      const providesSurface = (moduleInterface.publicSurfaces ?? []).some((surface) => (surface.contractIds ?? []).includes(contractId));
      const importsContract = (moduleInterface.imports ?? []).some((dependency) => dependency.contractId === contractId);
      return providesSurface && !importsContract;
    })
    .map((moduleInterface) => moduleInterface.moduleName);
}

function consumersForContract({ contractId, designPack, moduleInterfaces }) {
  const importConsumers = moduleInterfaces
    .filter((moduleInterface) => (moduleInterface.imports ?? []).some((dependency) => dependency.contractId === contractId))
    .map((moduleInterface) => moduleInterface.moduleName);
  const edgeConsumers = modulesForArchitectureEndpoint({ contractId, endpoint: "from", designPack, moduleInterfaces });
  return uniqueText([...importConsumers, ...edgeConsumers]);
}

function providersForContract({ contractId, designPack, moduleInterfaces }) {
  const edgeProviders = modulesForArchitectureEndpoint({ contractId, endpoint: "to", designPack, moduleInterfaces });
  const surfaceProviders = surfaceProvidersForContract({ contractId, moduleInterfaces });
  return uniqueText([...edgeProviders, ...surfaceProviders]);
}

function modelContractMatrix({ designPack, contracts, moduleInterfaces }) {
  return contracts.map((contract) => {
    const contractId = contract.contractId ?? contract.kind;
    return {
      contractId,
      kind: contract.kind,
      path: contract.path ?? null,
      summary: contractSummary(contract),
      providers: providersForContract({ contractId, designPack, moduleInterfaces }),
      consumers: consumersForContract({ contractId, designPack, moduleInterfaces })
    };
  });
}

export function buildSystemDossier({ prd, designPack, responsibilityUnits }) {
  const contracts = modelContracts(designPack.apiSpecs ?? []);
  const moduleInterfaces = modelModuleInterfaces({ designPack, responsibilityUnits });
  return {
    title: prd.title,
    summary: prd.userVisibleBehavior ?? [],
    goals: prd.goals ?? [],
    modules: moduleInterfaces.map((moduleInterface) => ({
      responsibilityUnitId: moduleInterface.responsibilityUnitId,
      moduleName: moduleInterface.moduleName,
      owner: moduleInterface.owner,
      purpose: moduleInterface.purpose,
      owns: moduleInterface.owns,
      publicSurfaces: moduleInterface.publicSurfaces,
      imports: moduleInterface.imports
    })),
    dependencyEdges: modelDependencyEdges({ designPack, contracts }),
    contractMatrix: modelContractMatrix({ designPack, contracts, moduleInterfaces }),
    signalFlows: designPack.sequences ?? [],
    callStacks: designPack.callStacks ?? [],
    stateTransitions: designPack.stateFlow?.transitions ?? [],
    deliveryScope: {
      ownedPaths: uniqueText((designPack.responsibilityBoundaries ?? []).flatMap((boundary) => boundary.owns ?? [])),
      responsibilityUnitIds: uniqueText((designPack.responsibilityBoundaries ?? []).map((boundary) => boundary.responsibilityUnitId)),
      acceptanceCriteriaIds: (prd.acceptanceCriteria ?? []).map((criterion) => criterion.id ?? "AC")
    },
    designPatterns: [
      {
        name: "Contract-first responsibility boundary",
        rationale: "Adjacent modules may rely only on declared public surfaces and contract IDs."
      },
      {
        name: "Fail-fast contract mismatch",
        rationale: "Undeclared IO, imports, or fallback behavior must revise the Blueprint instead of being hidden in implementation."
      }
    ]
  };
}
