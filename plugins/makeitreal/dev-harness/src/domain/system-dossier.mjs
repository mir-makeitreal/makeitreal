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

function modelDependencyEdges({ designPack, contracts }) {
  const contractsById = contractIndex(contracts);
  const moduleInterfaces = designPack.moduleInterfaces ?? [];
  const moduleByResponsibilityUnit = new Map(moduleInterfaces.map((moduleInterface) => [moduleInterface.responsibilityUnitId, moduleInterface]));
  const architectureEdges = softwareArchitectureEdges({ designPack, moduleInterfaces }).map(({ edge, fromModule, toModule }) => {
    const contractId = edge.contractId ?? null;
    const fromImportsTo = (fromModule.imports ?? []).some((dependency) =>
      dependency.providerResponsibilityUnitId === toModule.responsibilityUnitId
      && (!contractId || dependency.contractId === contractId)
    );
    const toImportsFrom = (toModule.imports ?? []).some((dependency) =>
      dependency.providerResponsibilityUnitId === fromModule.responsibilityUnitId
      && (!contractId || dependency.contractId === contractId)
    );
    return {
      from: fromModule.responsibilityUnitId,
      fromLabel: fromModule.moduleName,
      to: toModule.responsibilityUnitId,
      toLabel: toModule.moduleName,
      contractId,
      contractKind: contractsById.get(edge.contractId)?.kind ?? "contract",
      allowedUse: contractSummary(contractsById.get(edge.contractId), "Architecture dependency."),
      relation: fromImportsTo ? "consumer-to-provider" : toImportsFrom ? "provider-to-consumer" : "architecture-placement"
    };
  });

  const importEdges = moduleInterfaces.flatMap((moduleInterface) =>
    (moduleInterface.imports ?? []).map((dependency) => {
      const provider = moduleByResponsibilityUnit.get(dependency.providerResponsibilityUnitId);
      if (!provider) return null;
      return {
      from: moduleInterface.responsibilityUnitId,
      fromLabel: moduleInterface.moduleName ?? moduleInterface.responsibilityUnitId,
      to: provider.responsibilityUnitId,
      toLabel: provider.moduleName,
      surface: dependency.surface ?? null,
      contractId: dependency.contractId ?? null,
      contractKind: contractsById.get(dependency.contractId)?.kind ?? "import",
      allowedUse: dependency.allowedUse ?? contractSummary(contractsById.get(dependency.contractId), "Declared module import."),
      relation: "consumer-to-provider"
    };
  }).filter(Boolean)
  );

  const seen = new Set();
  return [...importEdges, ...architectureEdges].filter((edge) => {
    const key = `${edge.from}|${edge.to}|${edge.contractId}|${edge.relation}`;
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
  return uniqueText(importConsumers);
}

function providersForContract({ contractId, designPack, moduleInterfaces }) {
  const surfaceProviders = surfaceProvidersForContract({ contractId, moduleInterfaces });
  return uniqueText(surfaceProviders);
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
  const missingIds = requiredIds.filter((id) => !workItemsById.has(id));
  const requiredItems = requiredIds.map((id) => workItemsById.get(id)).filter(Boolean);
  const diagnosticWarnings = missingIds.map((id) => `DAG node "${id}" references a missing work item.`);
  return {
    blueprintFingerprint: blueprintFingerprint ?? null,
    requiredWorkItems: requiredIds,
    authorizedPaths: uniqueText(requiredItems.flatMap((workItem) => workItem.allowedPaths ?? [])),
    requiredContracts: uniqueText(requiredItems.flatMap((workItem) => workItem.contractIds ?? [])),
    diagnosticWarnings
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
  const moduleNames = uniqueText(moduleInterfaces.map((moduleInterface) => moduleInterface.moduleName));
  let summary = (prd.userVisibleBehavior ?? [])[0] ?? "";
  if (moduleInterfaces.length > 1 && dependencyEdges.length === 0) {
    summary = `${moduleInterfaces.length} responsibility units (${moduleNames.join(", ")}) are declared as separate modules with no cross-module imports.`;
  }
  if (moduleInterfaces.length > 1 && dependencyEdges.length > 0) {
    const edgeLabel = dependencyEdges.length === 1 ? "declared contract edge" : "declared contract edges";
    summary = `${moduleInterfaces.length} responsibility units (${moduleNames.join(", ")}) communicate only through ${dependencyEdges.length} ${edgeLabel}.`;
  }

  return {
    title: prd.title,
    summary,
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

function surfaceScenarioId(surface, index) {
  return `scenario-${String(surface?.name ?? `surface-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `surface-${index + 1}`}`;
}

function derivedScenariosFromModuleGraph(moduleInterfaces = []) {
  const moduleByResponsibilityUnit = new Map(moduleInterfaces.map((moduleInterface) => [moduleInterface.responsibilityUnitId, moduleInterface]));
  const moduleOrder = [...moduleInterfaces]
    .filter((candidate) => (candidate.publicSurfaces ?? []).length > 0)
    .sort((left, right) => Number((right.imports ?? []).length > 0) - Number((left.imports ?? []).length > 0));

  return moduleOrder.flatMap((moduleInterface, moduleIndex) =>
    (moduleInterface.publicSurfaces ?? []).map((surface, surfaceIndex) => {
      const outputNames = (surface.signature?.outputs ?? []).map((output) => output.name).join(", ") || "declared output";
      const errorNames = (surface.signature?.errors ?? []).map((error) => error.code).join(" | ") || "declared error";
      const dependencyMessages = (moduleInterface.imports ?? []).flatMap((dependency) => {
        const provider = moduleByResponsibilityUnit.get(dependency.providerResponsibilityUnitId);
        if (!provider) {
          return [];
        }
        const providerSurface = dependency.surface ?? provider.publicSurfaces?.[0]?.name ?? dependency.contractId;
        const providerOutput = (provider.publicSurfaces?.[0]?.signature?.outputs ?? []).map((output) => output.name).join(", ") || "declared output";
        const providerErrors = (provider.publicSurfaces?.[0]?.signature?.errors ?? []).map((error) => error.code).join(" | ") || "declared error";
        return [
          { from: moduleInterface.moduleName, to: provider.moduleName, label: `${providerSurface} via ${dependency.contractId}` },
          { from: provider.moduleName, to: moduleInterface.moduleName, label: `${providerOutput} or ${providerErrors}` }
        ];
      });
      return {
        id: surfaceScenarioId(surface, `${moduleIndex}-${surfaceIndex}`),
        title: `${surface.name} contract call`,
        participants: uniqueText(["Caller", moduleInterface.moduleName, ...(moduleInterface.imports ?? []).map((dependency) => moduleByResponsibilityUnit.get(dependency.providerResponsibilityUnitId)?.moduleName).filter(Boolean)]),
        messages: [
          { from: "Caller", to: moduleInterface.moduleName, label: surface.name },
          ...dependencyMessages,
          { from: moduleInterface.moduleName, to: "Caller", label: `${outputNames} or ${errorNames}` }
        ]
      };
    })
  );
}

function softwareScenarios({ designPack, moduleInterfaces }) {
  const declared = (designPack.sequences ?? []).filter((sequence) => !harnessSequence(sequence));
  if (declared.length > 0) {
    return declared;
  }
  return derivedScenariosFromModuleGraph(moduleInterfaces);
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

function reviewDecisionSummary(blueprintReview) {
  if (!blueprintReview?.status) {
    return [];
  }
  const reviewedBy = blueprintReview.reviewedBy ? ` by ${blueprintReview.reviewedBy}` : "";
  const reviewedAt = blueprintReview.reviewedAt ? ` at ${blueprintReview.reviewedAt}` : "";
  const note = blueprintReview.decisionNote ? `: ${blueprintReview.decisionNote}` : ".";
  return [`Blueprint review is ${blueprintReview.status}${reviewedBy}${reviewedAt}${note}`];
}

function modelReviewDecisions({ moduleInterfaces, dependencyEdges, contracts, blueprintReview }) {
  const responsibilityDecisions = moduleInterfaces.map((moduleInterface) =>
    `${moduleInterface.moduleName} owns ${uniqueText(moduleInterface.owns).join(", ") || "no declared paths"} and exposes ${(moduleInterface.publicSurfaces ?? []).map((surface) => surface.name).join(", ") || "no public surfaces"}.`
  );
  const dependencyDecisions = dependencyEdges.map((edge) =>
    edge.relation === "consumer-to-provider"
      ? `${edge.fromLabel} may call ${edge.toLabel} only through ${edge.contractId ?? edge.surface ?? "a declared contract"}.`
      : edge.relation === "provider-to-consumer"
        ? `${edge.fromLabel} provides ${edge.contractId ?? edge.surface ?? "a declared contract"} to ${edge.toLabel}; consumers must not inspect provider implementation internals.`
        : `${edge.fromLabel} is connected to ${edge.toLabel} through ${edge.contractId ?? edge.surface ?? "a declared contract"}.`
  );
  const contractDecisions = contracts.map((contract) =>
    `${contract.contractId ?? contract.kind} is reviewed from ${contract.path ?? contract.reason ?? "the boundary declaration"}.`
  );
  return uniqueText([...reviewDecisionSummary(blueprintReview), ...responsibilityDecisions, ...dependencyDecisions, ...contractDecisions]);
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

function textMentionsSurface(text, surface) {
  const haystack = String(text ?? "").toLowerCase();
  if (haystack.includes(String(surface.name ?? "").toLowerCase())) {
    return true;
  }
  return (surface.contractIds ?? []).some((contractId) => haystack.includes(String(contractId).toLowerCase()));
}

function traceCallStacksForSurface({ surface, callStacks }) {
  return (callStacks ?? [])
    .filter((stack) => textMentionsSurface(stack.entrypoint, surface)
      || (stack.calls ?? []).some((call) => textMentionsSurface(call, surface)))
    .map((stack) => stack.entrypoint);
}

function traceScenariosForSurface({ surface, scenarioDetails }) {
  return (scenarioDetails ?? [])
    .filter((scenario) => (scenario.messages ?? []).some((message) =>
      textMentionsSurface(message.label, surface)
      || textMentionsSurface(message.from, surface)
      || textMentionsSurface(message.to, surface)
    ))
    .map((scenario) => scenario.title);
}

function modelSurfaceTraceReference({ moduleInterfaces, dependencyEdges, workItems, callStacks, scenarioDetails }) {
  const workItemsByResponsibilityUnit = new Map();
  for (const workItem of workItems ?? []) {
    const current = workItemsByResponsibilityUnit.get(workItem.responsibilityUnitId) ?? [];
    current.push(workItem.id);
    workItemsByResponsibilityUnit.set(workItem.responsibilityUnitId, current);
  }

  return moduleInterfaces.flatMap((moduleInterface) =>
    (moduleInterface.publicSurfaces ?? []).map((surface) => {
      const consumerEdges = (dependencyEdges ?? []).filter((edge) =>
        edge.to === moduleInterface.responsibilityUnitId
        && (edge.surface === surface.name || (surface.contractIds ?? []).includes(edge.contractId))
      );
      const declaredConsumers = (surface.consumers ?? []).map((consumer) => ({ consumer, allowedUse: "Declared surface consumer." }));
      return {
        moduleName: moduleInterface.moduleName,
        responsibilityUnitId: moduleInterface.responsibilityUnitId,
        owner: moduleInterface.owner,
        surfaceName: surface.name,
        surfaceKind: surface.kind,
        contractIds: surface.contractIds ?? [],
        providerWorkItems: workItemsByResponsibilityUnit.get(moduleInterface.responsibilityUnitId) ?? [],
        consumers: uniqueText([
          ...consumerEdges.map((edge) => edge.fromLabel ?? edge.from),
          ...declaredConsumers.map((entry) => entry.consumer)
        ]),
        allowedUses: uniqueText([
          ...consumerEdges.map((edge) => edge.allowedUse),
          ...declaredConsumers.map((entry) => entry.allowedUse)
        ]),
        callStacks: traceCallStacksForSurface({ surface, callStacks }),
        scenarios: traceScenariosForSurface({ surface, scenarioDetails })
      };
    })
  );
}

function deriveDesignPatterns({ moduleInterfaces, dependencyEdges, scenarioDetails }) {
  const patterns = [];
  const moduleNames = moduleInterfaces.map((m) => m.moduleName ?? m.responsibilityUnitId);

  // Client-Server / Request-Reply pattern — when modules have consumer-to-provider imports
  const consumerEdges = dependencyEdges.filter((e) => e.relation === "consumer-to-provider");
  if (consumerEdges.length > 0) {
    const diagramLines = ["sequenceDiagram"];
    for (const edge of consumerEdges) {
      diagramLines.push(`  participant ${edge.fromLabel}`);
    }
    const providerNames = new Set();
    for (const edge of consumerEdges) {
      providerNames.add(edge.toLabel);
    }
    for (const name of providerNames) {
      diagramLines.push(`  participant ${name}`);
    }
    for (const edge of consumerEdges) {
      const label = edge.contractId ?? edge.surface ?? "request";
      diagramLines.push(`  ${edge.fromLabel}->>+${edge.toLabel}: ${label}`);
      diagramLines.push(`  ${edge.toLabel}-->>-${edge.fromLabel}: response`);
    }
    patterns.push({
      name: "Client-Server (Request-Reply)",
      rationale: `${consumerEdges.length} consumer-to-provider ${consumerEdges.length === 1 ? "edge" : "edges"}: clients call servers through declared contracts only.`,
      mermaid: diagramLines.join("\n")
    });
  }

  // Observer / Event-Driven pattern — when surfaces are async or event-driven
  const asyncSurfaces = moduleInterfaces.flatMap((m) =>
    (m.publicSurfaces ?? [])
      .filter((s) => {
        const kind = String(s.kind ?? "").toLowerCase();
        return kind.includes("async") || kind.includes("event") || kind.includes("hook") || kind.includes("callback");
      })
      .map((s) => ({ moduleName: m.moduleName, surface: s }))
  );
  if (asyncSurfaces.length > 0) {
    const diagramLines = ["flowchart LR"];
    for (const [i, entry] of asyncSurfaces.entries()) {
      const pubId = `pub_${i}`;
      const subId = `sub_${i}`;
      diagramLines.push(`  ${pubId}["${entry.moduleName}"]`);
      const consumers = entry.surface.consumers ?? [];
      if (consumers.length > 0) {
        for (const [j, consumer] of consumers.entries()) {
          const cId = `${subId}_${j}`;
          diagramLines.push(`  ${cId}["${consumer}"]`);
          diagramLines.push(`  ${pubId} -.->|"${entry.surface.name}"| ${cId}`);
        }
      } else {
        diagramLines.push(`  ${subId}(["Subscribers"])`);
        diagramLines.push(`  ${pubId} -.->|"${entry.surface.name}"| ${subId}`);
      }
    }
    patterns.push({
      name: "Observer / Event-Driven",
      rationale: `${asyncSurfaces.length} async or event-driven ${asyncSurfaces.length === 1 ? "surface" : "surfaces"} decouple producers from consumers via declared events.`,
      mermaid: diagramLines.join("\n")
    });
  }

  // Contract-First Design — when contracts are declared between modules
  const contractIds = uniqueText(dependencyEdges.map((e) => e.contractId).filter(Boolean));
  if (contractIds.length > 0) {
    const diagramLines = ["flowchart TB"];
    for (const [i, contractId] of contractIds.entries()) {
      const cId = `contract_${i}`;
      diagramLines.push(`  ${cId}{{"${contractId}"}}`);
      const providers = dependencyEdges.filter((e) => e.contractId === contractId && e.relation !== "consumer-to-provider");
      const consumers = dependencyEdges.filter((e) => e.contractId === contractId && e.relation === "consumer-to-provider");
      const providerModules = [...new Set([...providers.map((e) => e.fromLabel), ...consumers.map((e) => e.toLabel)])];
      const consumerModules = [...new Set(consumers.map((e) => e.fromLabel))];
      for (const [j, name] of providerModules.entries()) {
        const pId = `cprov_${i}_${j}`;
        diagramLines.push(`  ${pId}["${name}"] --> ${cId}`);
      }
      for (const [j, name] of consumerModules.entries()) {
        const uId = `ccons_${i}_${j}`;
        diagramLines.push(`  ${cId} --> ${uId}["${name}"]`);
      }
    }
    patterns.push({
      name: "Contract-First Design",
      rationale: `${contractIds.length} declared ${contractIds.length === 1 ? "contract" : "contracts"} (${contractIds.join(", ")}) govern module boundaries — implementation must conform to the contract, not the reverse.`,
      mermaid: diagramLines.join("\n")
    });
  }

  // Bounded Context (DDD) — when modules have strict ownership paths
  if (moduleInterfaces.length > 1) {
    const modulesWithOwnership = moduleInterfaces.filter((m) => (m.owns ?? []).length > 0);
    if (modulesWithOwnership.length > 1) {
      const diagramLines = ["flowchart TB"];
      for (const [i, m] of modulesWithOwnership.entries()) {
        const mId = `bc_${i}`;
        const ownsLabel = (m.owns ?? []).slice(0, 3).join(", ");
        diagramLines.push(`  subgraph ${mId}["${m.moduleName ?? m.responsibilityUnitId}"]`);
        diagramLines.push(`    ${mId}_paths["${ownsLabel}"]`);
        diagramLines.push(`  end`);
      }
      // Show contract edges between bounded contexts
      for (const edge of dependencyEdges.slice(0, 5)) {
        const fromIdx = modulesWithOwnership.findIndex((m) => m.moduleName === edge.fromLabel || m.responsibilityUnitId === edge.from);
        const toIdx = modulesWithOwnership.findIndex((m) => m.moduleName === edge.toLabel || m.responsibilityUnitId === edge.to);
        if (fromIdx >= 0 && toIdx >= 0) {
          diagramLines.push(`  bc_${fromIdx} -->|"${edge.contractId ?? "contract"}"| bc_${toIdx}`);
        }
      }
      patterns.push({
        name: "Bounded Context (Domain-Driven Design)",
        rationale: `${modulesWithOwnership.length} modules enforce strict file ownership boundaries — cross-context access requires a declared contract.`,
        mermaid: diagramLines.join("\n")
      });
    }
  }

  // Responsibility Decomposition — for 3+ modules
  if (moduleInterfaces.length > 2) {
    patterns.push({
      name: "Responsibility Decomposition",
      rationale: `System is decomposed into ${moduleInterfaces.length} focused responsibility units (${moduleNames.join(", ")}) to limit blast radius and simplify reasoning.`
    });
  }

  // Fail-Fast Contract Mismatch — always present
  patterns.push({
    name: "Fail-Fast Contract Mismatch",
    rationale: "Undeclared IO, imports, or fallback behavior must revise the Blueprint instead of being hidden in implementation."
  });

  return patterns;
}

export function buildSystemDossier({
  prd,
  designPack,
  responsibilityUnits,
  workItems = [],
  workItemDag = { nodes: [], edges: [] },
  blueprintFingerprint = null,
  blueprintReview = null
}) {
  const contracts = modelContracts(designPack.apiSpecs ?? []);
  const moduleInterfaces = modelModuleInterfaces({ designPack, responsibilityUnits });
  const dependencyEdges = modelDependencyEdges({ designPack, contracts });
  const taskDag = modelTaskDag({ workItemDag, workItems, moduleInterfaces });
  const scenarioDetails = modelScenarioDetails({ designPack, moduleInterfaces });
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
    surfaceTraceReference: modelSurfaceTraceReference({
      moduleInterfaces,
      dependencyEdges,
      workItems,
      callStacks: designPack.callStacks ?? [],
      scenarioDetails
    }),
    systemPlacement: modelSystemPlacement({ prd, moduleInterfaces, dependencyEdges }),
    scenarioIndex: modelScenarioIndex({ designPack, moduleInterfaces }),
    scenarioDetails,
    reviewDecisions: modelReviewDecisions({ moduleInterfaces, dependencyEdges, contracts, blueprintReview }),
    sources: modelSources({ designPack, workItems }),
    signalFlows: designPack.sequences ?? [],
    callStacks: designPack.callStacks ?? [],
    stateTransitions: designPack.stateFlow?.transitions ?? [],
    deliveryScope: {
      ownedPaths: uniqueText((designPack.responsibilityBoundaries ?? []).flatMap((boundary) => boundary.owns ?? [])),
      responsibilityUnitIds: uniqueText((designPack.responsibilityBoundaries ?? []).map((boundary) => boundary.responsibilityUnitId)),
      acceptanceCriteriaIds: (prd.acceptanceCriteria ?? []).map((criterion) => criterion.id ?? "AC")
    },
    designPatterns: deriveDesignPatterns({ moduleInterfaces, dependencyEdges, scenarioDetails }),
    workItems: (workItems ?? []).map((workItem) => ({
      id: workItem.id,
      title: workItem.title ?? workItem.id,
      responsibilityUnitId: workItem.responsibilityUnitId ?? null,
      prdTrace: workItem.prdTrace ?? {},
      verificationCommands: (workItem.verificationCommands ?? []).map((cmd) =>
        typeof cmd === "string" ? cmd : `${cmd.file ?? ""}${(cmd.args ?? []).length > 0 ? " " + cmd.args.join(" ") : ""}`
      )
    }))
  };
}
