import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern } from "../domain/path-policy.mjs";
import { normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { renderDesignPreview } from "../preview/render-preview.mjs";
import { ensureMakeItRealGitIgnore } from "../project/bootstrap.mjs";
import { writeCurrentRunState } from "../project/run-state.mjs";
import { runGates } from "../gates/index.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { approvalErrorsOnly, seedBlueprintReview } from "../blueprint/review.mjs";
import { decomposeResponsibilities } from "./responsibility-decomposer.mjs";

import {
  normalizedApiKind,
  isApiLike,
  hasApiOwnedPath,
  resolveOwnedPaths,
  explicitAllowedPathsFromRequest,
  detectedResponsibilityDomains,
  boundaryAmbiguityGuidance,
  componentProfileFromRequest,
  moduleProfileFromRequest,
  apiProfileFromRequest
} from "./classify-request.mjs";

import {
  acceptanceCriteriaFor,
  prdGoalsFor,
  userVisibleBehaviorFor,
  materializeLaunchBoard
} from "./artifact-assembly.mjs";

import { openApiDocument, componentContractDocument } from "./openapi-scaffold.mjs";
import { moduleInterfaceFor, dependencyModuleInterfaceFor, callStacksFor, sequencesFor } from "./module-signatures.mjs";

export function slugifyTask(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = normalized.length > 48
    ? normalized.slice(0, 48).replace(/-[^-]*$/, "")
    : normalized;
  const slug = truncated
    .replace(/-(with|for|and|or|to|of|a|an|the)$/g, "")
    .replace(/^-+|-+$/g, "");
  return slug || "work";
}

function titleFromRequest(request) {
  const normalized = String(request ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Make It Real planned work";
  }
  return normalized;
}

function defaultVerificationCommands() {
  return [];
}

async function packageTestScript(projectRoot) {
  try {
    const text = await readFile(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(text);
    return typeof parsed.scripts?.test === "string" ? parsed.scripts.test : null;
  } catch {
    return null;
  }
}

function commandIsNpmTest(command) {
  const normalized = normalizeVerificationCommand(command);
  if (!normalized.ok) {
    return false;
  }
  const executable = normalized.command.file.split(/[\\/]/).at(-1);
  return executable === "npm" && normalized.command.args[0] === "test";
}

function explicitNestedTestFiles(paths) {
  return paths
    .map((candidate) => String(candidate ?? "").replaceAll("\\", "/"))
    .filter((candidate) => /^tests?\//.test(candidate))
    .filter((candidate) => /\.[A-Za-z0-9._-]+$/.test(candidate))
    .filter((candidate) => candidate.split("/").length > 2);
}

function nodeTestScriptCoversPath(script, testPath) {
  const value = String(script ?? "");
  if (!/\bnode\s+--test\b/.test(value)) {
    return true;
  }
  if (value.includes(testPath)) {
    return true;
  }
  if (/\btests?\/\*\*/.test(value)) {
    return true;
  }
  if (/\btests?\/\*\.[^\s]+/.test(value) && testPath.split("/").length > 2) {
    return false;
  }
  return true;
}

async function validateVerificationPlanAgainstProject({ projectRoot, commands, owns }) {
  if (!commands.some(commandIsNpmTest) || owns.includes("package.json")) {
    return { ok: true, errors: [] };
  }
  const nestedTests = explicitNestedTestFiles(owns);
  if (nestedTests.length === 0) {
    return { ok: true, errors: [] };
  }
  const script = await packageTestScript(projectRoot);
  if (!script) {
    return { ok: true, errors: [] };
  }
  const uncovered = nestedTests.filter((testPath) => !nodeTestScriptCoversPath(script, testPath));
  if (uncovered.length === 0) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: [createHarnessError({
      code: "HARNESS_VERIFICATION_PLAN_UNPROVABLE",
      reason: `Declared npm test script does not discover nested test files: ${uncovered.join(", ")}.`,
      evidence: ["package.json:scripts.test", ...uncovered],
      recoverable: true,
      nextAction: "Revise the Blueprint to use a verification command that covers the declared test files, or explicitly include package.json in the ownership boundary."
    })]
  };
}

export async function generatePlanRun({
  projectRoot,
  request,
  runId,
  owner = "team.implementation",
  allowedPaths = [],
  apiKind = null,
  verificationCommands = null,
  runnerMode = "scripted-simulator",
  now = new Date()
}) {
  if (!projectRoot) {
    throw new Error("projectRoot is required.");
  }
  if (!request || !String(request).trim()) {
    throw new Error("plan requires a non-empty request.");
  }

  const domains = detectedResponsibilityDomains(request);
  if (domains.length > 1 && allowedPaths.length === 0) {
    const ambiguity = boundaryAmbiguityGuidance(domains);
    return {
      ok: false,
      command: "plan",
      projectRoot: path.resolve(projectRoot),
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      ...ambiguity,
      errors: [createHarnessError({
        code: "HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS",
        reason: `Request appears to span multiple responsibility domains (${domains.join(", ")}). This generator cannot safely collapse them into one owner.`,
        evidence: ["--request", "--allowed-path"],
        recoverable: true,
        ...ambiguity
      })]
    };
  }

  const unsafePath = allowedPaths.find(invalidAllowedPathPattern);
  if (unsafePath) {
    return {
      ok: false,
      command: "plan",
      projectRoot: path.resolve(projectRoot),
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      errors: [createHarnessError({
        code: "HARNESS_ALLOWED_PATH_INVALID",
        reason: `Allowed path must be a safe project-relative pattern: ${unsafePath}`,
        evidence: ["--allowed-path"],
        recoverable: true
      })]
    };
  }

  if (!["scripted-simulator", "claude-code"].includes(runnerMode)) {
    return {
      ok: false,
      command: "plan",
      projectRoot: path.resolve(projectRoot),
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_MODE_UNSUPPORTED",
        reason: `Unsupported plan runner mode: ${runnerMode}.`,
        evidence: ["--runner"],
        recoverable: true
      })]
    };
  }

  const slug = slugifyTask(runId ?? request);
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedRunId = runId ? slugifyTask(runId) : `feature-${slug}`;
  const runDir = path.join(resolvedProjectRoot, ".makeitreal", "runs", resolvedRunId);
  const title = titleFromRequest(request);
  const responsibilityUnitId = `ru.${slug}`;
  const contractId = `contract.${slug}.boundary`;
  const workItemId = `work.${slug}`;
  const requestAllowedPaths = explicitAllowedPathsFromRequest(request);
  const owns = resolveOwnedPaths({ allowedPaths, requestAllowedPaths, slug });
  const commands = verificationCommands ?? defaultVerificationCommands();
  const invalidCommand = commands.find((command) => !normalizeVerificationCommand(command).ok);
  if (invalidCommand) {
    return {
      ok: false,
      command: "plan",
      projectRoot: resolvedProjectRoot,
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      errors: [createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_INVALID",
        reason: normalizeVerificationCommand(invalidCommand).reason,
        evidence: ["--verify"],
        recoverable: true
      })]
    };
  }
  const verificationPlan = await validateVerificationPlanAgainstProject({
    projectRoot: resolvedProjectRoot,
    commands,
    owns
  });
  if (!verificationPlan.ok) {
    return {
      ok: false,
      command: "plan",
      projectRoot: resolvedProjectRoot,
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      preview: null,
      currentRun: null,
      readyGate: null,
      errors: verificationPlan.errors
    };
  }
  const apiKindMode = normalizedApiKind(apiKind);
  const usesOpenApi = apiKindMode === "none" ? false : isApiLike(request, apiKind) || hasApiOwnedPath(owns);
  const apiProfile = usesOpenApi ? apiProfileFromRequest({ request, slug }) : null;
  const componentProfile = usesOpenApi ? null : componentProfileFromRequest({ request, slug });
  const moduleProfile = usesOpenApi || componentProfile ? null : moduleProfileFromRequest({ request, slug });
  const acceptanceCriteria = acceptanceCriteriaFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile });
  const goals = prdGoalsFor({ title, usesOpenApi, apiProfile, componentProfile, moduleProfile, owns, verificationCommands: commands });
  const userVisibleBehavior = userVisibleBehaviorFor({ usesOpenApi, apiProfile, componentProfile, moduleProfile });
  await ensureMakeItRealGitIgnore({ projectRoot: resolvedProjectRoot });

  const prd = {
    schemaVersion: "1.0",
    id: `prd.${slug}`,
    title,
    goals,
    userVisibleBehavior,
    acceptanceCriteria,
    nonGoals: [
      "Generate production implementation code during planning.",
      "Infer undeclared fallback behavior for external SDKs or APIs."
    ],
    request: String(request).trim()
  };

  const dependencySpecs = apiProfile?.dependencies.map((dependency) => ({
    kind: "none",
    contractId: dependency.contractId,
    reason: `External dependency contract declared for ${dependency.surface}.`
  })) ?? [];
  const mayUseContracts = [contractId, ...dependencySpecs.map((spec) => spec.contractId)];
  const apiSpec = usesOpenApi
    ? { kind: "openapi", contractId, path: `contracts/${slug}.openapi.json` }
    : {
        kind: "none",
        contractId,
        reason: "Non-API work: the boundary contract is enforced through declared ownership, allowed paths, and planned static/AST checks."
      };
  const moduleInterface = moduleInterfaceFor({ responsibilityUnitId, owner, owns, contractId, title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile });
  const dependencyModuleInterfaces = apiProfile?.dependencies.map(dependencyModuleInterfaceFor) ?? [];
  const componentContracts = componentProfile
    ? [{ kind: "component", contractId, path: `contracts/${slug}.component-contract.json` }]
    : [];
  const apiSpecs = [apiSpec, ...dependencySpecs];
  const dependencyNodes = apiProfile?.dependencies.map((dependency) => ({
    id: dependency.providerResponsibilityUnitId.replace(/^ru\./, ""),
    label: dependency.surface,
    responsibilityUnitId: dependency.providerResponsibilityUnitId
  })) ?? [];
  const dependencyEdges = apiProfile?.dependencies.map((dependency) => ({
    from: "implementation-unit",
    to: dependency.providerResponsibilityUnitId.replace(/^ru\./, ""),
    contractId: dependency.contractId
  })) ?? [];

  const designPack = {
    schemaVersion: "1.0",
    runId: resolvedRunId,
    workItemId,
    prdId: prd.id,
    architecture: {
      nodes: [
        { id: "prd", label: "PRD Source", responsibilityUnitId },
        { id: "implementation-unit", label: "Implementation Responsibility Unit", responsibilityUnitId },
        ...dependencyNodes
      ],
      edges: [
        { from: "prd", to: "implementation-unit", contractId },
        ...dependencyEdges
      ]
    },
    stateFlow: {
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen", "Ready", "Claimed", "Running", "Verifying", "Human Review", "Done"],
      transitions: [
        { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
        { from: "Human Review", to: "Done", gate: "wiki" }
      ]
    },
    apiSpecs,
    componentContracts,
    responsibilityBoundaries: [
      { responsibilityUnitId, owns, mayUseContracts },
      ...dependencyModuleInterfaces.map((dependencyInterface) => ({
        responsibilityUnitId: dependencyInterface.responsibilityUnitId,
        owns: dependencyInterface.owns,
        mayUseContracts: []
      }))
    ],
    moduleInterfaces: [moduleInterface, ...dependencyModuleInterfaces],
    callStacks: callStacksFor({ moduleInterface, usesOpenApi, apiProfile, componentProfile, moduleProfile }),
    sequences: sequencesFor({ workItemId, contractId, usesOpenApi, apiProfile, componentProfile })
  };

  const doneEvidence = [
    { kind: "verification", path: `evidence/${workItemId}.verification.json` },
    { kind: "wiki-sync", path: `evidence/${workItemId}.wiki-sync.json` }
  ];
  if (usesOpenApi) {
    doneEvidence.splice(1, 0, { kind: "openapi-conformance", path: `evidence/${workItemId}.openapi-conformance.json` });
  }

  const workItem = {
    schemaVersion: "1.0",
    id: workItemId,
    title,
    prdId: prd.id,
    lane: "Contract Frozen",
    responsibilityUnitId,
    contractIds: mayUseContracts,
    dependencyContracts: apiProfile?.dependencies.map((dependency) => ({
      contractId: dependency.contractId,
      providerResponsibilityUnitId: dependency.providerResponsibilityUnitId,
      surface: dependency.surface,
      allowedUse: dependency.allowedUse
    })) ?? [],
    dependsOn: [],
    allowedPaths: owns,
    prdTrace: {
      acceptanceCriteriaIds: acceptanceCriteria.map((criterion) => criterion.id)
    },
    doneEvidence,
    verificationCommands: commands
  };
  const decomposition = decomposeResponsibilities({
    slug,
    owner,
    owns,
    contractId,
    moduleInterface,
    workItem,
    allowedPaths: owns,
    request
  });
  const declaredApiSpecs = [
    ...designPack.apiSpecs,
    ...decomposition.additionalApiSpecs
  ].filter((spec, index, specs) => specs.findIndex((candidate) => candidate.contractId === spec.contractId) === index);
  const dependencyInterfaceIds = new Set(dependencyModuleInterfaces.map((item) => item.responsibilityUnitId));
  const decomposedModuleIds = new Set(decomposition.moduleInterfaces.map((item) => item.responsibilityUnitId));
  designPack.workItemId = decomposition.primaryWorkItemId;
  designPack.apiSpecs = declaredApiSpecs;
  if (decomposition.workItems.length > 1) {
    const provideContractByUnit = new Map(decomposition.responsibilityUnits.map((unit) => [unit.id, unit.mustProvideContracts[0]]));
    designPack.architecture.nodes = [
      { id: "prd", label: "PRD Source" },
      ...decomposition.architectureNodes
    ];
    designPack.architecture.edges = [
      ...decomposition.architectureNodes.map((node) => ({
        from: "prd",
        to: node.id,
        contractId: provideContractByUnit.get(node.responsibilityUnitId)
      })),
      ...decomposition.architectureEdges
    ];
  } else {
    designPack.architecture.nodes = [
      ...designPack.architecture.nodes,
      ...decomposition.architectureNodes.filter((node) => !designPack.architecture.nodes.some((candidate) => candidate.id === node.id))
    ];
    designPack.architecture.edges = [
      ...designPack.architecture.edges,
      ...decomposition.architectureEdges
    ];
  }
  designPack.responsibilityBoundaries = [
    ...decomposition.responsibilityUnits.map((unit) => ({
      responsibilityUnitId: unit.id,
      owns: unit.owns,
      mayUseContracts: unit.mayUseContracts
    })),
    ...dependencyModuleInterfaces
      .filter((dependencyInterface) => !decomposedModuleIds.has(dependencyInterface.responsibilityUnitId))
      .map((dependencyInterface) => ({
        responsibilityUnitId: dependencyInterface.responsibilityUnitId,
        owns: dependencyInterface.owns,
        mayUseContracts: []
      }))
  ];
  designPack.moduleInterfaces = [
    ...decomposition.moduleInterfaces,
    ...dependencyModuleInterfaces.filter((dependencyInterface) => !decomposedModuleIds.has(dependencyInterface.responsibilityUnitId))
  ];
  designPack.callStacks = decomposition.moduleInterfaces.flatMap((item) => callStacksFor({
    moduleInterface: item,
    usesOpenApi: item.responsibilityUnitId.endsWith("-api") ? usesOpenApi : false,
    apiProfile,
    componentProfile: item.responsibilityUnitId === responsibilityUnitId ? componentProfile : null,
    moduleProfile: item.responsibilityUnitId === responsibilityUnitId ? moduleProfile : null
  }));

  const responsibilityUnits = {
    schemaVersion: "1.0",
    units: decomposition.responsibilityUnits.filter((unit) => !dependencyInterfaceIds.has(unit.id))
  };

  await writeJsonFile(path.join(runDir, "prd.json"), prd);
  await writeJsonFile(path.join(runDir, "design-pack.json"), designPack);
  await writeJsonFile(path.join(runDir, "responsibility-units.json"), responsibilityUnits);
  for (const item of decomposition.workItems) {
    await writeJsonFile(path.join(runDir, "work-items", `${item.id}.json`), item);
  }
  await writeJsonFile(path.join(runDir, "work-item-dag.json"), decomposition.workItemDag);
  if (usesOpenApi) {
    await writeJsonFile(path.join(runDir, "contracts", `${slug}.openapi.json`), openApiDocument({ title, slug, apiProfile }));
  }
  if (componentProfile) {
    await writeJsonFile(path.join(runDir, "contracts", `${slug}.component-contract.json`), componentContractDocument({ componentProfile, contractId, title }));
  }
  const launchBoard = await materializeLaunchBoard({
    runDir,
    runId: resolvedRunId,
    slug,
    workItems: decomposition.workItems,
    workItemDag: decomposition.workItemDag,
    runnerMode
  });

  const blueprintReview = await seedBlueprintReview({ runDir, now });
  const preview = await renderDesignPreview({ runDir, now });
  const readyGate = await runGates({ runDir, target: "Ready" });
  const readyErrorsAreApprovalOnly = approvalErrorsOnly(readyGate.errors);
  const generatedArtifactsOk = blueprintReview.ok && preview.ok;
  const readyGateHasRealErrors = !readyGate.ok && !readyErrorsAreApprovalOnly;
  const currentRunWriteOk = generatedArtifactsOk && !readyGateHasRealErrors;
  const planOk = currentRunWriteOk;
  const currentRun = currentRunWriteOk
    ? await writeCurrentRunState({
        projectRoot: resolvedProjectRoot,
        runDir,
        source: "makeitreal:plan",
        now
      })
    : null;
  const currentRunOk = currentRun?.ok ?? false;

  return {
    ok: planOk && currentRunOk,
    planOk,
    implementationReady: readyGate.ok,
    currentRunUpdated: currentRunOk,
    command: "plan",
    projectRoot: resolvedProjectRoot,
    runDir,
    runId: resolvedRunId,
    workItemId,
    contractId,
    launchBoard,
    blueprintReview,
    preview,
    currentRun,
    readyGate,
    errors: [
      ...(blueprintReview.errors ?? []),
      ...(preview.errors ?? []),
      ...(currentRun?.errors ?? []),
      ...(readyGate.errors ?? [])
    ]
  };
}
