import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { invalidAllowedPathPattern } from "../domain/path-policy.mjs";
import { normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { renderDesignPreview } from "../preview/render-preview.mjs";
import { writeCurrentRunState } from "../project/run-state.mjs";
import { runGates } from "../gates/index.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { approvalErrorsOnly, seedBlueprintReview } from "../blueprint/review.mjs";
import { LANES } from "../kanban/lanes.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";

export function slugifyTask(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "work";
}

function titleFromRequest(request) {
  const normalized = String(request ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Make It Real planned work";
  }
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function isApiLike(request, explicitKind) {
  if (explicitKind) {
    return explicitKind === "openapi";
  }
  return /\b(api|apis|endpoint|route|http|rest|openapi|swagger)\b/i.test(request);
}

function defaultAllowedPaths(slug) {
  return [`modules/${slug}/**`];
}

function defaultVerificationCommands() {
  return [];
}

function detectedResponsibilityDomains(request) {
  const text = String(request).toLowerCase();
  const domains = [];
  if (/\b(frontend|front-end|fe|ui|client|web)\b/.test(text)) {
    domains.push("frontend");
  }
  if (/\b(backend|back-end|be|server|api|endpoint|worker|service)\b/.test(text)) {
    domains.push("backend");
  }
  if (/\b(database|db|sql|postgres|mysql|redis|schema|migration)\b/.test(text)) {
    domains.push("data");
  }
  return domains;
}

function openApiDocument({ title, slug }) {
  return {
    openapi: "3.1.0",
    info: {
      title: `${title} Contract`,
      version: "0.1.0"
    },
    paths: {
      [`/${slug}`]: {
        post: {
          operationId: slug.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase()),
          responses: {
            200: {
              description: "Successful response"
            }
          }
        }
      }
    }
  };
}

function trustPolicyFor({ runnerMode, runId }) {
  if (runnerMode === "claude-code") {
    return {
      schemaVersion: "1.0",
      runnerMode: "claude-code",
      realAgentLaunch: "enabled",
      approvalPolicy: "never",
      sandbox: "workspace-only",
      commandExecution: "structured-command-only",
      userInputRequired: "fail-fast",
      unsupportedToolCall: "fail-fast",
      source: "makeitreal:plan",
      runId
    };
  }

  return {
    schemaVersion: "1.0",
    runnerMode: "scripted-simulator",
    realAgentLaunch: "disabled",
    approvalPolicy: "never",
    sandbox: "workspace-only",
    commandExecution: "trusted-fixture-only",
    userInputRequired: "fail-fast",
    unsupportedToolCall: "fail-fast",
    source: "makeitreal:plan",
    runId
  };
}

async function materializeLaunchBoard({ runDir, runId, slug, workItem, runnerMode }) {
  const board = {
    schemaVersion: "1.0",
    boardId: `board.${slug}`,
    blueprintRunDir: ".",
    lanes: LANES,
    workItems: [workItem]
  };
  await writeJsonFile(path.join(runDir, "board.json"), board);
  await writeJsonFile(path.join(runDir, "trust-policy.json"), trustPolicyFor({ runnerMode, runId }));
  const runtimeState = await loadRuntimeState(runDir);
  return {
    ok: true,
    boardPath: path.join(runDir, "board.json"),
    trustPolicyPath: path.join(runDir, "trust-policy.json"),
    runtimeStatePath: path.join(runDir, "runtime-state.json"),
    runtimeState,
    errors: []
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
  if (domains.length > 1) {
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
        code: "HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS",
        reason: `Request appears to span multiple responsibility domains (${domains.join(", ")}). This generator cannot safely collapse them into one owner.`,
        evidence: ["--request", "--allowed-path"],
        recoverable: true
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
  const owns = allowedPaths.length > 0 ? allowedPaths : defaultAllowedPaths(slug);
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
  const usesOpenApi = isApiLike(request, apiKind);

  const prd = {
    schemaVersion: "1.0",
    id: `prd.${slug}`,
    title,
    goals: [
      `Deliver the requested capability: ${title}`
    ],
    userVisibleBehavior: [
      "The implemented behavior matches the PRD acceptance criteria and exposes only declared public surfaces."
    ],
    acceptanceCriteria: [
      {
        id: "AC-001",
        statement: "Implementation traces to this PRD and its generated design pack."
      },
      {
        id: "AC-002",
        statement: "Exactly one responsibility unit owns the executable work item."
      },
      {
        id: "AC-003",
        statement: "Cross-boundary communication uses only the declared contract IDs."
      },
      {
        id: "AC-004",
        statement: "Ready gate passes before implementation starts."
      }
    ],
    nonGoals: [
      "Generate production implementation code during planning.",
      "Infer undeclared fallback behavior for external SDKs or APIs."
    ],
    request: String(request).trim()
  };

  const apiSpec = usesOpenApi
    ? { kind: "openapi", contractId, path: `contracts/${slug}.openapi.json` }
    : {
        kind: "none",
        contractId,
        reason: "Non-API work: the boundary contract is enforced through declared ownership, allowed paths, and planned static/AST checks."
      };

  const designPack = {
    schemaVersion: "1.0",
    runId: resolvedRunId,
    workItemId,
    prdId: prd.id,
    architecture: {
      nodes: [
        { id: "prd", label: "PRD Source", responsibilityUnitId },
        { id: "implementation-unit", label: "Implementation Responsibility Unit", responsibilityUnitId }
      ],
      edges: [
        { from: "prd", to: "implementation-unit", contractId }
      ]
    },
    stateFlow: {
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen", "Ready", "Claimed", "Running", "Verifying", "Human Review", "Done"],
      transitions: [
        { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
        { from: "Human Review", to: "Done", gate: "wiki" }
      ]
    },
    apiSpecs: [apiSpec],
    responsibilityBoundaries: [
      { responsibilityUnitId, owns, mayUseContracts: [contractId] }
    ],
    callStacks: [
      { entrypoint: `${workItemId}.start`, calls: ["read PRD", "load design pack", "execute owned responsibility unit"] }
    ],
    sequences: [
      {
        title: "Plan to implementation handoff",
        participants: ["User", "Make It Real", "Implementation Responsibility Unit"],
        messages: [
          { from: "User", to: "Make It Real", label: "request planned work" },
          { from: "Make It Real", to: "Implementation Responsibility Unit", label: `assign ${workItemId} via ${contractId}` }
        ]
      }
    ]
  };

  const responsibilityUnits = {
    schemaVersion: "1.0",
    units: [
      {
        id: responsibilityUnitId,
        owner,
        owns,
        publicSurfaces: [contractId],
        mayUseContracts: [contractId]
      }
    ]
  };

  const workItem = {
    schemaVersion: "1.0",
    id: workItemId,
    title,
    prdId: prd.id,
    lane: "Contract Frozen",
    responsibilityUnitId,
    contractIds: [contractId],
    dependsOn: [],
    allowedPaths: owns,
    prdTrace: {
      acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003", "AC-004"]
    },
    doneEvidence: [
      { kind: "verification", path: `evidence/${workItemId}.verification.json` },
      { kind: "wiki-sync", path: `evidence/${workItemId}.wiki-sync.json` }
    ],
    verificationCommands: commands
  };

  await writeJsonFile(path.join(runDir, "prd.json"), prd);
  await writeJsonFile(path.join(runDir, "design-pack.json"), designPack);
  await writeJsonFile(path.join(runDir, "responsibility-units.json"), responsibilityUnits);
  await writeJsonFile(path.join(runDir, "work-items", `${workItemId}.json`), workItem);
  if (usesOpenApi) {
    await writeJsonFile(path.join(runDir, "contracts", `${slug}.openapi.json`), openApiDocument({ title, slug }));
  }
  const launchBoard = await materializeLaunchBoard({ runDir, runId: resolvedRunId, slug, workItem, runnerMode });

  const blueprintReview = await seedBlueprintReview({ runDir, now });
  const preview = await renderDesignPreview({ runDir });
  const readyGate = await runGates({ runDir, target: "Ready" });
  const readyErrorsAreApprovalOnly = approvalErrorsOnly(readyGate.errors);
  const planOk = blueprintReview.ok && preview.ok && (readyGate.ok || readyErrorsAreApprovalOnly);
  const currentRun = planOk
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
