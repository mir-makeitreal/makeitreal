function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function pathMatches(pattern, pathPattern) {
  return pathPattern.test(pattern.replaceAll("\\", "/"));
}

function selectPaths(paths, pathPattern, testPattern) {
  return paths.filter((candidate) => pathMatches(candidate, pathPattern) || pathMatches(candidate, testPattern));
}

function resourceFromPaths(paths, domainPattern) {
  for (const candidate of paths) {
    const normalized = candidate.replaceAll("\\", "/");
    const match = normalized.match(domainPattern);
    if (match?.[1]) {
      return match[1].replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    }
  }
  return "resource";
}

function evidenceFor(workItemId, originalEvidence = []) {
  const kinds = uniqueValues(originalEvidence.map((item) => item.kind));
  const plannedKinds = kinds.length > 0 ? kinds : ["verification", "wiki-sync"];
  return plannedKinds.map((kind) => ({
    kind,
    path: `evidence/${workItemId}.${kind}.json`
  }));
}

function unitFrom({ id, owner, owns, publicSurfaces, mayUseContracts, mustProvideContracts }) {
  return {
    id,
    owner,
    owns,
    publicSurfaces,
    mayUseContracts,
    mustProvideContracts
  };
}

function oneNodeDecomposition({ slug, owner, owns, contractId, moduleInterface, workItem }) {
  return {
    responsibilityUnits: [
      unitFrom({
        id: workItem.responsibilityUnitId,
        owner,
        owns,
        publicSurfaces: moduleInterface.publicSurfaces.map((surface) => surface.name),
        mayUseContracts: workItem.contractIds ?? [contractId],
        mustProvideContracts: [contractId]
      })
    ],
    moduleInterfaces: [moduleInterface],
    workItems: [workItem],
    primaryWorkItemId: workItem.id,
    workItemDag: {
      schemaVersion: "1.0",
      runId: `feature-${slug}`,
      nodes: [{
        id: workItem.id,
        kind: "implementation",
        responsibilityUnitId: workItem.responsibilityUnitId,
        requiredForDone: true
      }],
      edges: []
    },
    additionalApiSpecs: [],
    architectureNodes: [],
    architectureEdges: []
  };
}

function repositoryInterface({ resource, owner, owns, persistenceContractId }) {
  const resourceLabel = resource
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
  return {
    responsibilityUnitId: `ru.${resource}-repository`,
    owner,
    moduleName: `${resourceLabel} Repository`,
    purpose: `Own ${resourceLabel.toLowerCase()} persistence behind the declared repository contract.`,
    owns,
    publicSurfaces: [{
      name: `${resourceLabel.replace(/\s+/g, "")}Repository.create`,
      kind: "module",
      description: `Persistence contract for ${resourceLabel.toLowerCase()} records.`,
      contractIds: [persistenceContractId],
      consumers: [`${resourceLabel} API responsibility unit`],
      signature: {
        inputs: [{
          name: "recordDraft",
          type: "object",
          required: true,
          description: "Validated record draft accepted by the persistence contract."
        }],
        outputs: [{
          name: "record",
          type: "object",
          description: "Persisted record returned by the repository contract."
        }],
        errors: [{
          code: "PERSISTENCE_CONTRACT_REJECTED",
          when: "The repository cannot satisfy the declared persistence contract.",
          handling: "Fail fast and return the declared error evidence to the owning API unit."
        }]
      }
    }],
    imports: []
  };
}

export function decomposeResponsibilities({
  slug,
  owner,
  owns,
  contractId,
  moduleInterface,
  workItem,
  allowedPaths
}) {
  const paths = uniqueValues(allowedPaths ?? owns);
  const apiPaths = selectPaths(paths, /(^|\/)(api|routes?)\/[^*]+/i, /^test\/(api|routes?)\//i);
  const dataPaths = selectPaths(paths, /(^|\/)(data|db|repositories?|persistence)\/[^*]+/i, /^test\/(data|db|repositories?|persistence)\//i);
  if (apiPaths.length === 0 || dataPaths.length === 0) {
    return oneNodeDecomposition({ slug, owner, owns, contractId, moduleInterface, workItem });
  }

  const resource = resourceFromPaths(apiPaths, /(?:^|\/)(?:api|routes?)\/([^/*]+)/i);
  const apiUnitId = `ru.${resource}-api`;
  const repositoryUnitId = `ru.${resource}-repository`;
  const apiWorkItemId = `work.${resource}-api`;
  const repositoryWorkItemId = `work.${resource}-repository`;
  const persistenceContractId = `contract.${resource}.persistence`;
  const repositoryModule = repositoryInterface({
    resource,
    owner,
    owns: dataPaths,
    persistenceContractId
  });
  const repositorySurface = repositoryModule.publicSurfaces[0].name;
  const apiModule = {
    ...moduleInterface,
    responsibilityUnitId: apiUnitId,
    owns: apiPaths,
    imports: [
      ...(moduleInterface.imports ?? []),
      {
        contractId: persistenceContractId,
        providerResponsibilityUnitId: repositoryUnitId,
        surface: repositorySurface,
        allowedUse: "Use the repository contract only; do not read persistence implementation internals."
      }
    ]
  };
  const apiWorkItem = {
    ...workItem,
    id: apiWorkItemId,
    responsibilityUnitId: apiUnitId,
    allowedPaths: apiPaths,
    contractIds: uniqueValues([contractId, persistenceContractId]),
    dependencyContracts: [
      ...(workItem.dependencyContracts ?? []),
      {
        contractId: persistenceContractId,
        providerResponsibilityUnitId: repositoryUnitId,
        surface: repositorySurface,
        allowedUse: "Use the repository contract only; do not read persistence implementation internals."
      }
    ],
    dependsOn: [repositoryWorkItemId],
    doneEvidence: evidenceFor(apiWorkItemId, workItem.doneEvidence)
  };
  const repositoryWorkItem = {
    ...workItem,
    id: repositoryWorkItemId,
    title: `Implement ${resource} repository contract`,
    responsibilityUnitId: repositoryUnitId,
    allowedPaths: dataPaths,
    contractIds: [persistenceContractId],
    dependencyContracts: [],
    dependsOn: [],
    doneEvidence: evidenceFor(repositoryWorkItemId, workItem.doneEvidence)
      .filter((item) => item.kind !== "openapi-conformance")
  };

  return {
    responsibilityUnits: [
      unitFrom({
        id: repositoryUnitId,
        owner,
        owns: dataPaths,
        publicSurfaces: repositoryModule.publicSurfaces.map((surface) => surface.name),
        mayUseContracts: [persistenceContractId],
        mustProvideContracts: [persistenceContractId]
      }),
      unitFrom({
        id: apiUnitId,
        owner,
        owns: apiPaths,
        publicSurfaces: apiModule.publicSurfaces.map((surface) => surface.name),
        mayUseContracts: uniqueValues([contractId, persistenceContractId]),
        mustProvideContracts: [contractId]
      })
    ],
    moduleInterfaces: [repositoryModule, apiModule],
    workItems: [repositoryWorkItem, apiWorkItem],
    primaryWorkItemId: apiWorkItemId,
    workItemDag: {
      schemaVersion: "1.0",
      runId: `feature-${slug}`,
      nodes: [
        {
          id: repositoryWorkItemId,
          kind: "implementation",
          responsibilityUnitId: repositoryUnitId,
          requiredForDone: true
        },
        {
          id: apiWorkItemId,
          kind: "implementation",
          responsibilityUnitId: apiUnitId,
          requiredForDone: true
        }
      ],
      edges: [{
        from: repositoryWorkItemId,
        to: apiWorkItemId,
        contractId: persistenceContractId
      }]
    },
    additionalApiSpecs: [{
      kind: "none",
      contractId: persistenceContractId,
      reason: "Internal repository contract declared for cross-responsibility persistence calls."
    }],
    architectureNodes: [
      { id: `${resource}-repository`, label: repositoryModule.moduleName, responsibilityUnitId: repositoryUnitId },
      { id: `${resource}-api`, label: apiModule.moduleName, responsibilityUnitId: apiUnitId }
    ],
    architectureEdges: [
      { from: `${resource}-repository`, to: `${resource}-api`, contractId: persistenceContractId }
    ]
  };
}
