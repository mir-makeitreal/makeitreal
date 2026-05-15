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

function fileTreeFromPaths(paths = []) {
  const root = { name: "root", type: "folder", children: [] };
  for (const pathValue of uniqueText(paths)) {
    const parts = pathValue.split("/").filter(Boolean);
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      const type = index === parts.length - 1 && !part.endsWith("**") ? "file" : "folder";
      let child = cursor.children.find((candidate) => candidate.name === part);
      if (!child) {
        child = { name: part, type, children: [] };
        cursor.children.push(child);
      }
      cursor = child;
    }
  }
  return root.children.length === 1 ? root.children[0] : root;
}

function workItemIndex(workItems = []) {
  return new Map(workItems.map((workItem) => [workItem.id, workItem]));
}

function moduleInterfaceIndex(moduleInterfaces = []) {
  return new Map(moduleInterfaces.map((moduleInterface) => [moduleInterface.responsibilityUnitId, moduleInterface]));
}

function requiredWorkItemIds({ workItemDag, workItems }) {
  const dagIds = (workItemDag.nodes ?? [])
    .filter((node) => node.requiredForDone !== false)
    .map((node) => node.id);
  if (dagIds.length > 0) {
    return dagIds;
  }
  return workItems.map((workItem) => workItem.id);
}

function modelApprovalScope({ workItemDag, workItems, blueprintFingerprint }) {
  const workItemsById = workItemIndex(workItems);
  const requiredIds = requiredWorkItemIds({ workItemDag, workItems });
  const requiredItems = requiredIds.map((id) => workItemsById.get(id)).filter(Boolean);
  return {
    blueprintFingerprint: blueprintFingerprint ?? null,
    requiredWorkItems: requiredIds,
    authorizedPaths: uniqueText(requiredItems.flatMap((workItem) => workItem.allowedPaths ?? [])),
    requiredContracts: uniqueText(requiredItems.flatMap((workItem) => workItem.contractIds ?? []))
  };
}

function modelTaskDag({ workItemDag, workItems, moduleInterfaces }) {
  const workItemsById = workItemIndex(workItems);
  const modulesByResponsibilityUnit = moduleInterfaceIndex(moduleInterfaces);
  return {
    nodes: (workItemDag.nodes ?? []).map((node) => {
      const workItem = workItemsById.get(node.id);
      const moduleInterface = modulesByResponsibilityUnit.get(node.responsibilityUnitId);
      return {
        id: node.id,
        kind: node.kind,
        requiredForDone: node.requiredForDone !== false,
        responsibilityUnitId: node.responsibilityUnitId,
        moduleName: moduleInterface?.moduleName ?? node.responsibilityUnitId,
        owner: moduleInterface?.owner ?? null,
        title: workItem?.title ?? node.id,
        lane: workItem?.lane ?? null,
        allowedPaths: workItem?.allowedPaths ?? [],
        contractIds: workItem?.contractIds ?? []
      };
    }),
    edges: (workItemDag.edges ?? []).map((edge) => {
      const fromWorkItem = workItemsById.get(edge.from);
      const toWorkItem = workItemsById.get(edge.to);
      return {
        from: edge.from,
        to: edge.to,
        contractId: edge.contractId ?? null,
        fromLabel: fromWorkItem?.title ?? edge.from,
        toLabel: toWorkItem?.title ?? edge.to
      };
    })
  };
}

function evidenceRoleForNodeKind(kind) {
  if (kind === "domain-pm") {
    return "domain-pm";
  }
  if (kind === "integration-evidence") {
    return "integration-evidence-reviewer";
  }
  return "implementation-worker";
}

function modelWorkerTopology({ taskDag, moduleInterfaces }) {
  const modulesByResponsibilityUnit = moduleInterfaceIndex(moduleInterfaces);
  return {
    assignments: taskDag.nodes.map((node) => {
      const moduleInterface = modulesByResponsibilityUnit.get(node.responsibilityUnitId);
      return {
        workItemId: node.id,
        evidenceRole: evidenceRoleForNodeKind(node.kind),
        responsibilityUnitId: node.responsibilityUnitId,
        moduleName: node.moduleName,
        owner: node.owner ?? moduleInterface?.owner ?? null,
        contractIds: node.contractIds,
        allowedPaths: node.allowedPaths,
        handoff: "Native Claude Code Task receives this work item packet and may edit only the authorized paths."
      };
    }),
    reviewRoles: ["spec-reviewer", "quality-reviewer", "verification-reviewer"]
  };
}

function modelSystemPlacement({ prd, moduleInterfaces, dependencyEdges }) {
  return {
    title: prd.title,
    summary: (prd.userVisibleBehavior ?? [])[0] ?? "",
    modules: moduleInterfaces.map((moduleInterface) => ({
      responsibilityUnitId: moduleInterface.responsibilityUnitId,
      moduleName: moduleInterface.moduleName,
      purpose: moduleInterface.purpose ?? "",
      owner: moduleInterface.owner ?? null
    })),
    edges: dependencyEdges.map((edge) => ({
      from: edge.from,
      fromLabel: edge.fromLabel,
      to: edge.to,
      toLabel: edge.toLabel,
      contractId: edge.contractId,
      surface: edge.surface ?? null
    }))
  };
}

function scenarioVisualizationKind(sequence = {}) {
  const messageCount = (sequence.messages ?? []).length;
  if (messageCount > 0 && messageCount <= 8) {
    return "mermaid";
  }
  if (messageCount > 8) {
    return "workflow";
  }
  return "text";
}

function harnessSequence(sequence = {}) {
  const text = [
    ...(sequence.participants ?? []),
    ...(sequence.messages ?? []).flatMap((message) => [message.from, message.to, message.label])
  ].join(" ").toLowerCase();
  return text.includes("make it real")
    || text.includes("implementation responsibility unit")
    || text.includes("request planned work")
    || text.includes("assign work")
    || text.includes("plan to implementation handoff");
}

function derivedScenarioFromFirstSurface(moduleInterfaces = []) {
  const moduleInterface = moduleInterfaces.find((candidate) => (candidate.publicSurfaces ?? []).length > 0);
  const surface = moduleInterface?.publicSurfaces?.[0];
  if (!moduleInterface || !surface) {
    return null;
  }
  const outputNames = (surface.signature?.outputs ?? []).map((output) => output.name).join(", ") || "declared output";
  const errorNames = (surface.signature?.errors ?? []).map((error) => error.code).join(" | ") || "declared error";
  return {
    id: "scenario-declared-surface-call",
    title: `${surface.name} contract call`,
    participants: ["Caller", moduleInterface.moduleName],
    messages: [
      { from: "Caller", to: moduleInterface.moduleName, label: surface.name },
      { from: moduleInterface.moduleName, to: "Caller", label: `${outputNames} or ${errorNames}` }
    ]
  };
}

function softwareScenarios({ designPack, moduleInterfaces }) {
  const declared = (designPack.sequences ?? []).filter((sequence) => !harnessSequence(sequence));
  if (declared.length > 0) {
    return declared;
  }
  const derived = derivedScenarioFromFirstSurface(moduleInterfaces);
  return derived ? [derived] : [];
}

function modelScenarioIndex({ designPack, moduleInterfaces }) {
  return softwareScenarios({ designPack, moduleInterfaces }).map((sequence, index) => ({
    id: sequence.id ?? `scenario-${index + 1}`,
    title: sequence.title ?? `Scenario ${index + 1}`,
    participantCount: uniqueText(sequence.participants ?? []).length,
    stepCount: (sequence.messages ?? []).length,
    visualizationKind: scenarioVisualizationKind(sequence)
  }));
}

function modelScenarioDetails({ designPack, moduleInterfaces }) {
  return softwareScenarios({ designPack, moduleInterfaces }).map((sequence, index) => ({
    id: sequence.id ?? `scenario-${index + 1}`,
    title: sequence.title ?? `Scenario ${index + 1}`,
    participants: uniqueText(sequence.participants ?? []),
    messages: sequence.messages ?? [],
    visualizationKind: scenarioVisualizationKind(sequence)
  }));
}

function modelReviewDecisions({ moduleInterfaces, dependencyEdges, contracts }) {
  const responsibilityDecisions = moduleInterfaces.map((moduleInterface) =>
    `${moduleInterface.moduleName} owns ${uniqueText(moduleInterface.owns).join(", ") || "no declared paths"} and exposes ${(moduleInterface.publicSurfaces ?? []).map((surface) => surface.name).join(", ") || "no public surfaces"}.`
  );
  const dependencyDecisions = dependencyEdges.map((edge) =>
    `${edge.fromLabel} may call ${edge.toLabel} only through ${edge.contractId ?? edge.surface ?? "a declared contract"}.`
  );
  const contractDecisions = contracts.map((contract) =>
    `${contract.contractId ?? contract.kind} is reviewed from ${contract.path ?? contract.reason ?? "the boundary declaration"}.`
  );
  return uniqueText([...responsibilityDecisions, ...dependencyDecisions, ...contractDecisions]);
}

function modelSources({ designPack, workItems = [] }) {
  const contractSources = (designPack.apiSpecs ?? [])
    .filter((spec) => spec.path)
    .map((spec) => ({
      label: spec.contractId ?? spec.kind,
      path: spec.path,
      kind: "contract"
    }));
  return [
    { label: "PRD", path: "prd.json", kind: "prd" },
    { label: "Design Pack", path: "design-pack.json", kind: "design-pack" },
    { label: "Responsibility Units", path: "responsibility-units.json", kind: "responsibility-units" },
    { label: "Work Item DAG", path: "work-item-dag.json", kind: "work-item-dag" },
    ...workItems.map((workItem) => ({
      label: workItem.id,
      path: `work-items/${workItem.id}.json`,
      kind: "work-item"
    })),
    ...contractSources
  ];
}

function modelContractSurfaces({ moduleInterfaces }) {
  return moduleInterfaces.flatMap((moduleInterface) =>
    (moduleInterface.publicSurfaces ?? []).map((surface) => ({
      responsibilityUnitId: moduleInterface.responsibilityUnitId,
      moduleName: moduleInterface.moduleName,
      owner: moduleInterface.owner,
      name: surface.name,
      kind: surface.kind,
      description: surface.description,
      contractIds: surface.contractIds ?? [],
      consumers: surface.consumers ?? [],
      signature: surface.signature
    }))
  );
}

export function buildSystemDossier({
  prd,
  designPack,
  responsibilityUnits,
  workItems = [],
  workItemDag = { nodes: [], edges: [] },
  blueprintFingerprint = null
}) {
  const contracts = modelContracts(designPack.apiSpecs ?? []);
  const moduleInterfaces = modelModuleInterfaces({ designPack, responsibilityUnits });
  const dependencyEdges = modelDependencyEdges({ designPack, contracts });
  const taskDag = modelTaskDag({ workItemDag, workItems, moduleInterfaces });
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
      ownedFileTree: fileTreeFromPaths(moduleInterface.owns),
      publicSurfaces: moduleInterface.publicSurfaces,
      imports: moduleInterface.imports
    })),
    approvalScope: modelApprovalScope({ workItemDag, workItems, blueprintFingerprint }),
    taskDag,
    workerTopology: modelWorkerTopology({ taskDag, moduleInterfaces }),
    dependencyEdges,
    contractMatrix: modelContractMatrix({ designPack, contracts, moduleInterfaces }),
    contractSurfaces: modelContractSurfaces({ moduleInterfaces }),
    systemPlacement: modelSystemPlacement({ prd, moduleInterfaces, dependencyEdges }),
    scenarioIndex: modelScenarioIndex({ designPack, moduleInterfaces }),
    scenarioDetails: modelScenarioDetails({ designPack, moduleInterfaces }),
    reviewDecisions: modelReviewDecisions({ moduleInterfaces, dependencyEdges, contracts }),
    sources: modelSources({ designPack, workItems }),
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
