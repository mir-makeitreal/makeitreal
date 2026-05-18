function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function pathMatches(pattern, pathPattern) {
  return pathPattern.test(pattern.replaceAll("\\", "/"));
}

function selectPaths(paths, pathPattern, testPattern) {
  return paths.filter((candidate) => pathMatches(candidate, pathPattern) || pathMatches(candidate, testPattern));
}

function isGeneralTestPattern(candidate) {
  return /^tests?\/\*\*$/i.test(String(candidate ?? "").replaceAll("\\", "/"));
}

function testPathForSourcePath(candidate) {
  const normalized = String(candidate ?? "").replaceAll("\\", "/");
  if (!normalized.startsWith("src/")) {
    return null;
  }
  if (normalized.endsWith("/**")) {
    return `test/${normalized.slice("src/".length)}`;
  }
  const extension = normalized.match(/\.[A-Za-z0-9._-]+$/)?.[0];
  if (!extension) {
    return null;
  }
  const sourcePathWithoutExtension = normalized.slice(0, -extension.length);
  return `test/${sourcePathWithoutExtension.slice("src/".length)}.test${extension}`;
}

function expandGeneralTestOwnership(paths) {
  if (!paths.some(isGeneralTestPattern)) {
    return paths;
  }
  const ownedPaths = paths.filter((candidate) => !isGeneralTestPattern(candidate));
  const derivedTestPaths = ownedPaths.map(testPathForSourcePath).filter(Boolean);
  return uniqueValues([...ownedPaths, ...derivedTestPaths]);
}

function slugFrom(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unit";
}

function explicitPathsFromText(text) {
  const candidates = [];
  const tokenPattern = /(?:^|[\s("'`])([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:\/|\.[A-Za-z0-9._-]+)?)(?=$|[\s)"'`,.;:!?])/g;
  for (const match of String(text ?? "").matchAll(tokenPattern)) {
    const candidate = match[1].replace(/\/+$/, "").replace(/[.,;:!?]+$/, "");
    if (!candidate || candidate.startsWith("http/") || candidate.startsWith("https/")) {
      continue;
    }
    const root = candidate.split("/")[0];
    const hasFileExtension = /\.[A-Za-z0-9._-]+$/.test(candidate);
    const looksLikeGlob = candidate.endsWith("/**");
    const knownProjectRoot = [
      ".github", "app", "apps", "bin", "client", "components", "contracts",
      "db", "docs", "hooks", "lib", "migrations", "modules", "packages",
      "plugins", "scripts", "server", "services", "src", "test", "tests",
      "tools", "web"
    ].includes(root);
    if (!hasFileExtension && !looksLikeGlob && !knownProjectRoot) {
      continue;
    }
    candidates.push(candidate.includes(".") || candidate.endsWith("/**") ? candidate : `${candidate}/**`);
  }
  return uniqueValues(candidates);
}

function isTestPath(candidate) {
  return /(^|\/)tests?\//i.test(String(candidate ?? "").replaceAll("\\", "/"));
}

function fileStem(candidate) {
  const normalized = String(candidate ?? "").replaceAll("\\", "/");
  if (normalized.endsWith("/**") || !/\.[A-Za-z0-9._-]+$/.test(normalized)) {
    return null;
  }
  const basename = normalized.split("/").at(-1).replace(/\.[A-Za-z0-9._-]+$/, "");
  return basename.replace(/\.test$/i, "");
}

function explicitPathsForUnitSection({ sectionText, request }) {
  const sectionPaths = explicitPathsFromText(sectionText);
  const sourcePaths = sectionPaths.filter((candidate) => !isTestPath(candidate));
  const sourceStems = new Set(sourcePaths.map(fileStem).filter(Boolean));
  if (sourceStems.size === 0) {
    return sectionPaths;
  }
  const allPaths = explicitPathsFromText(request);
  const matchingTests = allPaths
    .filter(isTestPath)
    .filter((candidate) => sourceStems.has(fileStem(candidate)));
  const scopedSectionTests = sectionPaths
    .filter(isTestPath)
    .filter((candidate) => sourceStems.has(fileStem(candidate)));
  return uniqueValues([...sourcePaths, ...scopedSectionTests, ...matchingTests]);
}

function explicitUnitSections(request) {
  const text = String(request ?? "");
  const marker = String.raw`\bUnit\s+(\d+)(?:\s+owns\b|\s*[:\-]\s*)`;
  const matches = [...text.matchAll(new RegExp(`${marker}([\\s\\S]*?)(?=${marker}|$)`, "gi"))];
  if (matches.length < 2) {
    return [];
  }
  return matches.map((match) => ({
    unitNumber: Number(match[1]),
    text: match[2].trim()
  })).filter((section) => section.text && Number.isFinite(section.unitNumber));
}

function importedContractsForSection({ section, previousUnits }) {
  const text = String(section.text ?? "");
  return previousUnits
    .filter((unit) => {
      const unitReference = new RegExp(`\\bUnit\\s+${unit.unitNumber}\\b`, "i").test(text);
      const surfaceReference = unit.publicSurfaces.some((surface) => new RegExp(`\\b${surface.name}\\b`).test(text));
      return /\bmay\s+use\b/i.test(text) && (unitReference || surfaceReference);
    })
    .map((unit) => ({
      contractId: unit.contractId,
      providerResponsibilityUnitId: unit.responsibilityUnitId,
      providerWorkItemId: unit.workItemId,
      surface: unit.publicSurfaces[0]?.name ?? unit.contractId,
      allowedUse: "Use only the provider contract declared in the approved Blueprint; do not inspect provider implementation internals."
    }));
}

function explicitUnitDecomposition({ slug, owner, contractId, moduleInterface, workItem, request }) {
  const sections = explicitUnitSections(request);
  if (sections.length < 2) {
    return null;
  }

  const pmUnitId = `ru.${slug}-pm`;
  const pmWorkItemId = `work.${slug}-pm`;
  const integrationUnitId = `ru.${slug}-integration-evidence`;
  const integrationWorkItemId = `work.${slug}-integration-evidence`;
  const implementationUnits = [];

  for (const section of sections) {
    const paths = explicitPathsForUnitSection({ sectionText: section.text, request });
    const surfaces = functionReferences(section.text);
    const unitSlug = slugFrom(surfaces[0]?.name ?? `unit-${section.unitNumber}`);
    const unitContractId = `contract.${unitSlug}.boundary`;
    const responsibilityUnitId = `ru.${unitSlug}`;
    const workItemId = `work.${unitSlug}`;
    const publicSurfaces = surfaces.length > 0
      ? surfaces.map(({ name, args }) => surfaceFromFunction({
          name,
          args,
          contractId: unitContractId,
          description: `Declared public surface for Unit ${section.unitNumber}.`,
          source: section.text
        }))
      : moduleInterface.publicSurfaces.map((surface) => ({
          ...surface,
          contractIds: [unitContractId],
          description: `Declared public surface for Unit ${section.unitNumber}.`
        }));
    const dependencyContracts = importedContractsForSection({ section, previousUnits: implementationUnits });
    const dependsOn = uniqueValues([pmWorkItemId, ...dependencyContracts.map((dependency) => dependency.providerWorkItemId)]);
    const title = `Implement Unit ${section.unitNumber}: ${publicSurfaces.map((surface) => surface.name).join(", ")}`;
    const unitModule = {
      responsibilityUnitId,
      owner,
      moduleName: publicSurfaces.map((surface) => surface.name).join(", "),
      purpose: `Own Unit ${section.unitNumber} through its declared contract, owned files, and tests only.`,
      owns: paths,
      publicSurfaces,
      imports: dependencyContracts.map(({ providerWorkItemId, ...dependency }) => dependency)
    };
    const unitWorkItem = {
      ...workItem,
      id: workItemId,
      title,
      responsibilityUnitId,
      allowedPaths: paths,
      contractIds: uniqueValues([unitContractId, ...dependencyContracts.map((dependency) => dependency.contractId)]),
      dependencyContracts: dependencyContracts.map(({ providerWorkItemId, ...dependency }) => dependency),
      dependsOn,
      doneEvidence: evidenceFor(workItemId, workItem.doneEvidence)
    };
    implementationUnits.push({
      unitNumber: section.unitNumber,
      responsibilityUnitId,
      workItemId,
      contractId: unitContractId,
      moduleInterface: unitModule,
      workItem: unitWorkItem,
      publicSurfaces
    });
  }

  const pmWorkItem = {
    ...workItem,
    id: pmWorkItemId,
    title: `Coordinate ${slug} responsibility split`,
    responsibilityUnitId: pmUnitId,
    allowedPaths: [],
    contractIds: uniqueValues([contractId, ...implementationUnits.map((unit) => unit.contractId)]),
    dependencyContracts: [],
    dependsOn: [],
    verificationCommands: [],
    verificationExempt: {
      reason: "Domain PM coordination is proven by makeitrealPmReport plus spec-reviewer approval; implementation nodes own project verification."
    },
    doneEvidence: evidenceFor(pmWorkItemId, workItem.doneEvidence)
      .filter((item) => item.kind !== "openapi-conformance")
  };
  const integrationWorkItem = {
    ...workItem,
    id: integrationWorkItemId,
    title: `Verify ${slug} cross-boundary integration evidence`,
    responsibilityUnitId: integrationUnitId,
    allowedPaths: [],
    contractIds: uniqueValues([contractId, ...implementationUnits.map((unit) => unit.contractId)]),
    dependencyContracts: implementationUnits.map((unit) => ({
      contractId: unit.contractId,
      providerResponsibilityUnitId: unit.responsibilityUnitId,
      surface: unit.publicSurfaces[0]?.name ?? unit.contractId,
      allowedUse: "Exercise the provider contract as integration evidence; do not inspect implementation internals."
    })),
    dependsOn: implementationUnits.map((unit) => unit.workItemId),
    doneEvidence: evidenceFor(integrationWorkItemId, workItem.doneEvidence)
      .filter((item) => item.kind !== "openapi-conformance")
  };

  return {
    responsibilityUnits: [
      unitFrom({
        id: pmUnitId,
        owner: "team.domain-pm",
        owns: [],
        publicSurfaces: [`${slug}.responsibility-plan`],
        mayUseContracts: uniqueValues([contractId, ...implementationUnits.map((unit) => unit.contractId)]),
        mustProvideContracts: []
      }),
      ...implementationUnits.map((unit) => unitFrom({
        id: unit.responsibilityUnitId,
        owner,
        owns: unit.moduleInterface.owns,
        publicSurfaces: unit.publicSurfaces.map((surface) => surface.name),
        mayUseContracts: unit.workItem.contractIds,
        mustProvideContracts: [unit.contractId]
      })),
      unitFrom({
        id: integrationUnitId,
        owner: "team.integration",
        owns: [],
        publicSurfaces: [`${slug}.integration-evidence`],
        mayUseContracts: uniqueValues([contractId, ...implementationUnits.map((unit) => unit.contractId)]),
        mustProvideContracts: []
      })
    ],
    moduleInterfaces: implementationUnits.map((unit) => unit.moduleInterface),
    workItems: [pmWorkItem, ...implementationUnits.map((unit) => unit.workItem), integrationWorkItem],
    primaryWorkItemId: implementationUnits.at(-1)?.workItemId ?? workItem.id,
    workItemDag: {
      schemaVersion: "1.0",
      runId: `feature-${slug}`,
      nodes: [
        {
          id: pmWorkItemId,
          kind: "domain-pm",
          responsibilityUnitId: pmUnitId,
          requiredForDone: true
        },
        ...implementationUnits.map((unit) => ({
          id: unit.workItemId,
          kind: "implementation",
          responsibilityUnitId: unit.responsibilityUnitId,
          requiredForDone: true
        })),
        {
          id: integrationWorkItemId,
          kind: "integration-evidence",
          responsibilityUnitId: integrationUnitId,
          requiredForDone: true
        }
      ],
      edges: [
        ...implementationUnits.map((unit) => ({
          from: pmWorkItemId,
          to: unit.workItemId,
          kind: "coordination"
        })),
        ...implementationUnits.flatMap((unit) => (unit.workItem.dependencyContracts ?? []).map((dependency) => ({
          from: implementationUnits.find((candidate) => candidate.responsibilityUnitId === dependency.providerResponsibilityUnitId)?.workItemId,
          to: unit.workItemId,
          kind: "contract-dependency",
          contractId: dependency.contractId
        }))).filter((edge) => edge.from),
        ...implementationUnits.map((unit) => ({
          from: unit.workItemId,
          to: integrationWorkItemId,
          kind: "integration-proof",
          contractId: unit.contractId
        }))
      ]
    },
    additionalApiSpecs: implementationUnits.map((unit) => ({
      kind: "none",
      contractId: unit.contractId,
      reason: `Internal module contract declared for Unit ${unit.unitNumber}.`
    })),
    architectureNodes: implementationUnits.map((unit) => ({
      id: unit.responsibilityUnitId.replace(/^ru\./, ""),
      label: unit.moduleInterface.moduleName,
      responsibilityUnitId: unit.responsibilityUnitId
    })),
    architectureEdges: implementationUnits.flatMap((unit) => (unit.workItem.dependencyContracts ?? []).map((dependency) => ({
      from: dependency.providerResponsibilityUnitId.replace(/^ru\./, ""),
      to: unit.responsibilityUnitId.replace(/^ru\./, ""),
      contractId: dependency.contractId
    })))
  };
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

const SECTION_LABELS = [
  "repository",
  "persistence",
  "data",
  "api",
  "handler",
  "route",
  "endpoint",
  "frontend",
  "backend",
  "db"
];

function requestSection(request, labels) {
  const text = String(request ?? "");
  const labelPattern = labels.join("|");
  const boundaryPattern = SECTION_LABELS.filter((label) => !labels.includes(label)).join("|");
  const labelSuffix = "(?:\\s+(?:unit|responsibility\\s+unit|module|layer))?";
  const sectionSeparator = "(?:\\s*:\\s*|\\s+)";
  const nextSectionSeparator = "(?:\\s*:|\\s+)";
  const match = text.match(new RegExp(`\\b(?:${labelPattern})${labelSuffix}${sectionSeparator}([\\s\\S]*?)(?=\\b(?:${boundaryPattern})${labelSuffix}${nextSectionSeparator}|$)`, "i"));
  return match?.[1]?.trim() || null;
}

function functionArgs(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(source ?? "").match(new RegExp(`\\b${escaped}\\s*\\(([^)]*)\\)`));
  return match?.[1]
    ?.split(",")
    .map((arg) => arg.trim())
    .filter(Boolean) ?? [];
}

function functionReferences(source) {
  const text = String(source ?? "");
  const exportBlocks = [...text.matchAll(/\bexports?\s+([^.;]+)/gi)].map((match) => match[1]);
  const searchText = exportBlocks.length > 0 ? exportBlocks.join(", ") : text;
  return uniqueValues([...searchText.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]))
    .map((name) => ({ name, args: functionArgs(text, name) }));
}

function declaredErrorCodes(source) {
  return uniqueValues([...String(source ?? "").matchAll(/\bcode\s+([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]));
}

function bookFieldsFromText(source) {
  const text = String(source ?? "");
  const fields = [];
  if (/\btitle\b/i.test(text)) {
    fields.push({ name: "title", type: "string", required: true, description: "Book title after declared trimming rules." });
  }
  if (/\bauthor\b/i.test(text)) {
    fields.push({ name: "author", type: "string", required: true, description: "Book author after declared trimming rules." });
  }
  if (/\byear\b/i.test(text)) {
    const optionalYear = /\boptional\b[\s\S]{0,40}\byear\b|\byear\b[\s\S]{0,40}\boptional\b|\b(?:when|if)\s+year\s+exists\b/i.test(text);
    fields.push({ name: "year", type: "integer", required: !optionalYear, description: "Optional publication year when supplied by the caller." });
  }
  return fields;
}

function inputDescriptor({ arg, source, surfaceName }) {
  const text = String(source ?? "");
  const fields = bookFieldsFromText(text);
  if (fields.length >= 2 && /^(input|book)$/i.test(arg)) {
    const fieldTypes = fields.map((field) => `${field.name}${field.required === false ? "?" : ""}: ${field.type}`).join(", ");
    return {
      name: arg,
      type: `object { ${fieldTypes} }`,
      required: true,
      fields,
      description: `Declared ${arg} object for ${surfaceName}; consumers may rely on these fields without reading implementation internals.`
    };
  }
  if (new RegExp(`\\b${arg}\\b\\s+must\\s+be\\s+(?:a\\s+)?string`, "i").test(text)) {
    return {
      name: arg,
      type: "string",
      required: true,
      description: `Declared ${arg} string for ${surfaceName}.`
    };
  }
  return {
    name: arg,
    type: "declared input",
    required: true,
    description: `Declared ${arg} input for ${surfaceName}.`
  };
}

function outputDescriptor({ name, contractId, source }) {
  const text = String(source ?? "");
  if (/\bplain\s+object\s*\{\s*heading\s*,\s*byline\s*\}/i.test(text)) {
    return {
      name: "cardViewModel",
      type: "object { heading: string, byline: string }",
      description: "Plain object card view model returned to consumers."
    };
  }
  if (/\btext\s+card\b|\bcard\s+text\b|^render.*Card\b[\s\S]*\breturns?\s+(?:a\s+)?(?:single\s+)?string\b/i.test(`${name} ${text}`)) {
    return {
      name: "cardText",
      type: "string",
      description: "Plain text card returned to consumers."
    };
  }
  if (/^normalize/i.test(name) && bookFieldsFromText(text).length >= 2) {
    return {
      name: "normalizedBook",
      type: "object { title: string, author: string, year?: integer }",
      description: "Book object after declared normalization rules are applied."
    };
  }
  return {
    name: "result",
    type: "declared output",
    description: `Returned value defined by ${contractId}.`
  };
}

function errorDescriptors({ source }) {
  const declared = declaredErrorCodes(source).map((code) => ({
    code,
    when: /INVALID/i.test(code)
      ? "Input violates the declared module contract."
      : "The declared error condition is reached.",
    handling: `Throw the declared error with code ${code}; do not coerce invalid input through fallback behavior.`
  }));
  return [
    ...declared,
    {
      code: "BOUNDARY_CONTRACT_VIOLATION",
      when: "The implementation needs behavior outside the declared contract.",
      handling: "Fail fast and revise the Blueprint; do not add fallback behavior."
    }
  ];
}

function surfaceFromFunction({ name, args, contractId, description, source = "" }) {
  return {
    name,
    kind: "module",
    description,
    contractIds: [contractId],
    consumers: ["Declared downstream responsibility units and tests"],
    signature: {
      inputs: args.length > 0
        ? args.map((arg) => inputDescriptor({ arg, source, surfaceName: name }))
        : [{
            name: "none",
            type: "void",
            required: false,
            description: `${name} accepts no direct arguments.`
          }],
      outputs: [outputDescriptor({ name, contractId, source })],
      errors: errorDescriptors({ source })
    }
  };
}

function surfacesFromRequestSection({ request, labels, contractId, description }) {
  const section = requestSection(request, labels);
  if (!section) {
    return [];
  }
  return functionReferences(section).map(({ name, args }) =>
    surfaceFromFunction({ name, args, contractId, description, source: section })
  );
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

function repositoryInterface({ resource, owner, owns, persistenceContractId, publicSurfaces }) {
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
    publicSurfaces: publicSurfaces.length > 0 ? publicSurfaces : [{
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
  allowedPaths,
  request
}) {
  const paths = expandGeneralTestOwnership(uniqueValues(allowedPaths ?? owns));
  const explicit = explicitUnitDecomposition({ slug, owner, contractId, moduleInterface, workItem, request });
  if (explicit) {
    return explicit;
  }
  const apiPaths = selectPaths(paths, /(^|\/)(api|routes?)\/[^*]+/i, /^test\/(api|routes?)\//i);
  const dataPaths = selectPaths(paths, /(^|\/)(data|db|repositories?|persistence)\/[^*]+/i, /^test\/(data|db|repositories?|persistence)\//i);
  if (apiPaths.length === 0 || dataPaths.length === 0) {
    return oneNodeDecomposition({ slug, owner, owns, contractId, moduleInterface, workItem });
  }

  const resource = resourceFromPaths(apiPaths, /(?:^|\/)(?:api|routes?)\/([^/*]+)/i);
  const apiUnitId = `ru.${resource}-api`;
  const repositoryUnitId = `ru.${resource}-repository`;
  const pmUnitId = `ru.${resource}-pm`;
  const integrationUnitId = `ru.${resource}-integration-evidence`;
  const apiWorkItemId = `work.${resource}-api`;
  const repositoryWorkItemId = `work.${resource}-repository`;
  const pmWorkItemId = `work.${resource}-pm`;
  const integrationWorkItemId = `work.${resource}-integration-evidence`;
  const persistenceContractId = `contract.${resource}.persistence`;
  const repositorySurfaces = surfacesFromRequestSection({
    request,
    labels: ["repository", "persistence", "data"],
    contractId: persistenceContractId,
    description: `Persistence contract surface for ${resource} records.`
  });
  const repositoryModule = repositoryInterface({
    resource,
    owner,
    owns: dataPaths,
    persistenceContractId,
    publicSurfaces: repositorySurfaces
  });
  const repositorySurface = repositoryModule.publicSurfaces[0].name;
  const apiSurfaces = surfacesFromRequestSection({
    request,
    labels: ["api", "handler", "route", "endpoint"],
    contractId,
    description: `Boundary contract surface for ${resource} request handling.`
  });
  const apiModule = {
    ...moduleInterface,
    responsibilityUnitId: apiUnitId,
    owns: apiPaths,
    publicSurfaces: apiSurfaces.length > 0 ? apiSurfaces : moduleInterface.publicSurfaces,
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
    dependsOn: [pmWorkItemId],
    doneEvidence: evidenceFor(repositoryWorkItemId, workItem.doneEvidence)
      .filter((item) => item.kind !== "openapi-conformance")
  };
  const pmWorkItem = {
    ...workItem,
    id: pmWorkItemId,
    title: `Coordinate ${resource} responsibility split`,
    responsibilityUnitId: pmUnitId,
    allowedPaths: [],
    contractIds: uniqueValues([contractId, persistenceContractId]),
    dependencyContracts: [],
    dependsOn: [],
    verificationCommands: [],
    verificationExempt: {
      reason: "Domain PM coordination is proven by makeitrealPmReport plus spec-reviewer approval; project tests run after child implementation nodes."
    },
    doneEvidence: evidenceFor(pmWorkItemId, workItem.doneEvidence)
      .filter((item) => item.kind !== "openapi-conformance")
  };
  const integrationWorkItem = {
    ...workItem,
    id: integrationWorkItemId,
    title: `Verify ${resource} cross-boundary integration evidence`,
    responsibilityUnitId: integrationUnitId,
    allowedPaths: [],
    contractIds: uniqueValues([contractId, persistenceContractId]),
    dependencyContracts: [{
      contractId,
      providerResponsibilityUnitId: apiUnitId,
      surface: apiModule.publicSurfaces[0].name,
      allowedUse: "Exercise the public API contract as cross-boundary integration evidence; do not inspect implementation internals."
    }],
    dependsOn: [apiWorkItemId],
    doneEvidence: evidenceFor(integrationWorkItemId, workItem.doneEvidence)
      .filter((item) => item.kind !== "openapi-conformance")
  };

  return {
    responsibilityUnits: [
      unitFrom({
        id: pmUnitId,
        owner: "team.domain-pm",
        owns: [],
        publicSurfaces: [`${resource}.responsibility-plan`],
        mayUseContracts: uniqueValues([contractId, persistenceContractId]),
        mustProvideContracts: []
      }),
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
      }),
      unitFrom({
        id: integrationUnitId,
        owner: "team.integration",
        owns: [],
        publicSurfaces: [`${resource}.integration-evidence`],
        mayUseContracts: uniqueValues([contractId, persistenceContractId]),
        mustProvideContracts: []
      })
    ],
    moduleInterfaces: [repositoryModule, apiModule],
    workItems: [pmWorkItem, repositoryWorkItem, apiWorkItem, integrationWorkItem],
    primaryWorkItemId: apiWorkItemId,
    workItemDag: {
      schemaVersion: "1.0",
      runId: `feature-${slug}`,
      nodes: [
        {
          id: pmWorkItemId,
          kind: "domain-pm",
          responsibilityUnitId: pmUnitId,
          requiredForDone: true
        },
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
        },
        {
          id: integrationWorkItemId,
          kind: "integration-evidence",
          responsibilityUnitId: integrationUnitId,
          requiredForDone: true
        }
      ],
      edges: [
        {
          from: pmWorkItemId,
          to: repositoryWorkItemId,
          kind: "coordination"
        },
        {
          from: repositoryWorkItemId,
          to: apiWorkItemId,
          kind: "contract-dependency",
          contractId: persistenceContractId
        },
        {
          from: apiWorkItemId,
          to: integrationWorkItemId,
          kind: "integration-proof",
          contractId
        }
      ]
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
