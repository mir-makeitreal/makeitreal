import path from "node:path";
import { appendBoardEvent, loadBoard, saveBoard } from "../board/board-store.mjs";
import { claimWorkItemUnlocked, listClaims, releaseClaimUnlocked } from "../board/claim-store.mjs";
import { withBoardLock } from "../io/file-lock.mjs";
import { getReadyWorkItems, validateDependencyGraph } from "../board/dependency-graph.mjs";
import { validateChangedPaths } from "../board/responsibility-boundaries.mjs";
import { resolveBlueprintRunDir } from "../blueprint/review.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { runGates } from "../gates/index.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";
import { canTransition } from "../kanban/state-engine.mjs";
import { createRunAttempt, readRunAttempt, updateRunAttempt } from "./attempt-store.mjs";
import { MAX_RETRY_ATTEMPTS, nextBackoffMs } from "./retry-policy.mjs";
import { runScriptedAttempt } from "./runner-simulator.mjs";
import {
  clearClaimed,
  clearRunning,
  clearRetry,
  loadRuntimeState,
  recordClaimed,
  recordRetry,
  recordRunning,
  saveRuntimeState,
  updateRunningEvent
} from "./runtime-state.mjs";
import { extractAgentReport, validateAgentReports } from "./dynamic-role-handoff.mjs";
import { defaultNativeRoleMapping, validateNativeRoleMapping } from "./native-role-mapping.mjs";
import { extractReviewReports } from "./review-evidence.mjs";
import { validateRunnerPolicy } from "./trust-policy.mjs";
import { resolveProjectRootForRun, resolveWorkspace } from "./workspace-manager.mjs";

// Infrastructure validation only. Doctrine: requiredReviewRoles is NOT declared
// here — it comes from workItem.requiredReviewRoles. The engine validates and
// saves; it does not decide which reviewers a work item needs.
const COMPLETION_POLICIES = Object.freeze({
  "implementation": {
    reportRole: "implementation-worker",
    reportKeys: ["makeitrealReport", "agentReport"],
    requiresChangedFiles: true,
    requiresVerificationCommands: true
  },
  "domain-pm": {
    reportRole: "domain-pm",
    reportKeys: ["makeitrealPmReport", "pmReport"],
    requiresChangedFiles: false,
    requiresVerificationCommands: false
  },
  "integration-evidence": {
    reportRole: "integration-evidence",
    reportKeys: ["makeitrealEvidenceReport", "evidenceReport"],
    requiresChangedFiles: false,
    requiresVerificationCommands: true
  }
});

const APPROVED_REVIEW_STATUSES = new Set(["APPROVED", "APPROVED_WITH_NOTES"]);

// Runtime values the engine is allowed to interpolate into an LLM-authored
// prompt. The blueprint owns the prompt text; the engine only substitutes
// these placeholders ({{boardDir}}, {{projectRoot}}, {{attemptId}}, {{workItemId}}).
function interpolateRuntimeValues(template, { boardDir, projectRoot, attemptId, workItemId }) {
  const values = {
    boardDir: boardDir ?? "",
    projectRoot: projectRoot ?? "(unknown)",
    attemptId: attemptId ?? "",
    workItemId: workItemId ?? ""
  };
  return template.replace(
    /\{\{\s*(boardDir|projectRoot|attemptId|workItemId)\s*\}\}/g,
    (_match, key) => values[key]
  );
}

// Doctrine: the blueprint (LLM) decides which review roles a work item needs.
// The engine only validates and saves. When a work item omits the declaration,
// require no reviewers — the LLM must declare requiredReviewRoles explicitly.
function resolveRequiredReviewRoles({ workItem }) {
  if (Array.isArray(workItem?.requiredReviewRoles)) {
    return workItem.requiredReviewRoles;
  }
  process.stderr.write("[make-it-real] workItem missing requiredReviewRoles — no reviewers required. Declare requiredReviewRoles in your blueprint.\n");
  return [];
}

function mappingForEvidenceRole(mapping, role) {
  return (mapping?.mappings ?? []).find((entry) => entry.evidenceRole === role) ?? null;
}

async function resolveNativeRoleMapping({ boardDir, projectRoot }) {
  const candidates = [
    path.join(boardDir, "native-role-mapping.json"),
    projectRoot ? path.join(projectRoot, ".makeitreal", "native-role-mapping.json") : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!await fileExists(candidate)) {
      continue;
    }
    const mapping = await readJsonFile(candidate);
    const validation = validateNativeRoleMapping(mapping);
    if (!validation.ok) {
      return { ok: false, mapping: null, mappingPath: candidate, errors: validation.errors };
    }
    return { ok: true, mapping, mappingPath: candidate, errors: [] };
  }
  const mapping = defaultNativeRoleMapping();
  return { ok: true, mapping, mappingPath: null, errors: [] };
}

function transitionLane(board, workItemId, lane, context = { gates: {} }, extra = {}) {
  const workItem = board.workItems.find((item) => item.id === workItemId);
  const transition = canTransition({ from: workItem.lane, to: lane, context });
  if (!transition.ok) {
    return transition;
  }
  Object.assign(workItem, { lane }, extra);
  return { ok: true, errors: [] };
}

async function nodeKindForWorkItem({ runDir, workItemId }) {
  const artifacts = await loadRunArtifacts(runDir);
  return artifacts.workItemDag.nodes?.find((node) => node.id === workItemId)?.kind ?? "implementation";
}

function reportArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (typeof item === "string") {
      return item.trim();
    }
    if (item && typeof item === "object") {
      return JSON.stringify(item);
    }
    return String(item ?? "").trim();
  }).filter(Boolean);
}

function reportCandidate(record, keys) {
  if (!record || typeof record !== "object") {
    return null;
  }
  for (const key of keys) {
    const direct = record[key] ?? record.payload?.[key] ?? null;
    if (direct) {
      return direct;
    }
  }
  return null;
}

function extractPolicyReport({ record, policy, workItem, workerId, attemptId, now }) {
  const candidate = reportCandidate(record, policy.reportKeys);
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  return {
    schemaVersion: "1.0",
    role: String(candidate.role ?? policy.reportRole),
    status: String(candidate.status ?? ""),
    summary: String(candidate.summary ?? ""),
    changedFiles: reportArray(candidate.changedFiles),
    tested: reportArray(candidate.tested),
    concerns: reportArray(candidate.concerns),
    needsContext: reportArray(candidate.needsContext),
    blockers: reportArray(candidate.blockers),
    childWorkProposal: candidate.childWorkProposal ?? null,
    workItemId: String(candidate.workItemId ?? workItem.id),
    workerId,
    attemptId: String(candidate.attemptId ?? attemptId),
    reportedAt: now.toISOString()
  };
}

function validateNativeCompletionPolicy({ nodeKind, policyReport, agentReports, reviewReports, changedFiles, workItem, attemptId }) {
  const policy = COMPLETION_POLICIES[nodeKind] ?? COMPLETION_POLICIES.implementation;
  const errors = [];
  const report = policyReport ?? agentReports.find((candidate) => candidate.role === policy.reportRole) ?? null;

  if (!report) {
    errors.push(createHarnessError({
      code: "HARNESS_AGENT_REPORT_MISSING",
      reason: `${nodeKind} node requires a ${policy.reportRole} report before verification.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: ["runner.stdout"],
      recoverable: true
    }));
  } else if (report.status !== "DONE") {
    const codes = {
      DONE_WITH_CONCERNS: "HARNESS_AGENT_DONE_WITH_CONCERNS",
      NEEDS_CONTEXT: "HARNESS_AGENT_NEEDS_CONTEXT",
      BLOCKED: "HARNESS_AGENT_BLOCKED"
    };
    errors.push(createHarnessError({
      code: codes[report.status] ?? "HARNESS_AGENT_STATUS_INVALID",
      reason: `${policy.reportRole} reported ${report.status || "(missing)"}.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: ["runner.stdout", `attempts/${attemptId}.json`],
      recoverable: true
    }));
  }

  if (policy.requiresChangedFiles && changedFiles.length === 0) {
    errors.push(createHarnessError({
      code: "HARNESS_AGENT_CHANGED_FILES_MISSING",
      reason: `${nodeKind} node requires at least one changed file in the native task report.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: ["runner.stdout"],
      recoverable: true
    }));
  }

  const requiredReviewRoles = resolveRequiredReviewRoles({ workItem });
  const latestByRole = new Map(reviewReports.map((report) => [report.role, report]));
  const missing = requiredReviewRoles.filter((role) => !latestByRole.has(role));
  if (missing.length > 0) {
    errors.push(createHarnessError({
      code: "HARNESS_REVIEW_EVIDENCE_MISSING",
      reason: `${nodeKind} node requires approved review evidence for: ${missing.join(", ")}.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: [`attempts/${attemptId}.json`],
      recoverable: true
    }));
  }

  const rejected = requiredReviewRoles
    .map((role) => latestByRole.get(role))
    .find((report) => report && !APPROVED_REVIEW_STATUSES.has(report.status));
  if (rejected) {
    errors.push(createHarnessError({
      code: "HARNESS_REVIEW_REJECTED",
      reason: `${rejected.role} reported ${rejected.status}.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: [`attempts/${attemptId}.json`],
      recoverable: true
    }));
  }

  const workspaceChangedFile = changedFiles.find((filePath) =>
    filePath.replaceAll("\\", "/").includes(".makeitreal/runs/")
    && filePath.replaceAll("\\", "/").includes("/workspaces/")
  );
  if (workspaceChangedFile) {
    errors.push(createHarnessError({
      code: "HARNESS_NATIVE_WORKSPACE_EDIT_INVALID",
      reason: `Native Claude work must edit the project root, not legacy workspace path: ${workspaceChangedFile}`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: [workspaceChangedFile],
      recoverable: true
    }));
  }

  return { ok: errors.length === 0, errors };
}

function validateNativeFinishInput({ record, policy, nodeKind, workItem }) {
  const report = reportCandidate(record, policy.reportKeys);
  if (
    report
    && typeof report === "object"
    && !Array.isArray(report)
    && typeof report.status === "string"
    && report.status.trim()
  ) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: [createHarnessError({
      code: "HARNESS_NATIVE_REPORT_INVALID",
      reason: `orchestrator native finish requires a structured ${policy.reportRole} JSON report with a non-empty status for ${nodeKind} work before it can change board state.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: ["--result-stdin", policy.reportKeys[0], `${policy.reportKeys[0]}.status`],
      recoverable: true
    })]
  };
}

async function promoteReadyGateApprovedWork({ boardDir, board, now }) {
  const frozen = (board.workItems ?? []).filter((item) => item.lane === "Contract Frozen");
  if (frozen.length === 0) {
    return { ok: true, board, promotedWorkItemIds: [], errors: [] };
  }

  const resolved = await resolveBlueprintRunDir({ boardDir });
  if (!resolved.ok) {
    return { ok: false, board, promotedWorkItemIds: [], errors: resolved.errors };
  }

  let graphNodeIds = null;
  try {
    const artifacts = await loadRunArtifacts(resolved.runDir);
    graphNodeIds = new Set((artifacts.workItemDag.nodes ?? []).map((node) => node.id));
  } catch (cause) {
    return {
      ok: false,
      board,
      promotedWorkItemIds: [],
      errors: [createHarnessError({
        code: "HARNESS_READY_PROMOTION_INVALID",
        reason: cause instanceof Error ? cause.message : String(cause),
        evidence: ["work-item-dag.json", "work-items"]
      })]
    };
  }

  const candidates = frozen.filter((item) => graphNodeIds.has(item.id));
  if (candidates.length === 0) {
    return { ok: true, board, promotedWorkItemIds: [], errors: [] };
  }

  const readyGate = await runGates({ runDir: resolved.runDir, target: "Ready" });
  if (!readyGate.ok) {
    return { ok: false, board, promotedWorkItemIds: [], errors: readyGate.errors };
  }

  const promotedWorkItemIds = [];
  for (const candidate of candidates) {
    const transition = transitionLane(board, candidate.id, "Ready", {
      gates: {
        design: true,
        contract: true,
        responsibility: true,
        blueprintApproval: true
      }
    });
    if (!transition.ok) {
      return { ok: false, board, promotedWorkItemIds, errors: transition.errors };
    }
    promotedWorkItemIds.push(candidate.id);
  }

  await saveBoard(boardDir, board);
  for (const workItemId of promotedWorkItemIds) {
    const event = await appendBoardEvent(boardDir, {
      event: "work_ready",
      timestamp: now.toISOString(),
      workItemId,
      payload: { source: "Ready gate" }
    });
    if (!event.ok) {
      return { ok: false, board, promotedWorkItemIds, errors: event.errors };
    }
  }
  return { ok: true, board, promotedWorkItemIds, errors: [] };
}

export async function orchestratorTick(args) {
  return withBoardLock(args.boardDir, () => orchestratorTickInner(args));
}

async function orchestratorTickInner({ boardDir, workerId, concurrency, now, runnerScript, runnerMode = "scripted-simulator" }) {
  if (runnerMode !== "scripted-simulator") {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_MODE_UNSUPPORTED",
        reason: "orchestrator tick only supports the scripted simulator. Use orchestrator native start/finish for Claude Code native subagents.",
        evidence: ["--runner"],
        recoverable: true,
        nextAction: "orchestrator native start <runDir>"
      })],
      dispatchedWorkItemIds: [],
      retryWorkItemIds: [],
      promotedWorkItemIds: []
    };
  }
  const policy = await validateRunnerPolicy(boardDir, { runnerMode });
  if (!policy.ok) {
    return { ok: false, errors: policy.errors, dispatchedWorkItemIds: [], retryWorkItemIds: [], promotedWorkItemIds: [] };
  }

  let board = await loadBoard(boardDir);
  const graph = validateDependencyGraph(board);
  if (!graph.ok) {
    return { ok: false, errors: graph.errors, dispatchedWorkItemIds: [], retryWorkItemIds: [], promotedWorkItemIds: [] };
  }

  const readyPromotion = await promoteReadyGateApprovedWork({ boardDir, board, now });
  if (!readyPromotion.ok) {
    return { ok: false, errors: readyPromotion.errors, dispatchedWorkItemIds: [], retryWorkItemIds: [], promotedWorkItemIds: readyPromotion.promotedWorkItemIds };
  }
  board = readyPromotion.board;

  const candidates = getReadyWorkItems(board).slice(0, concurrency);
  const dispatchedWorkItemIds = [];
  const retryWorkItemIds = [];
  const promotedWorkItemIds = readyPromotion.promotedWorkItemIds;
  const dispatchErrors = [];
  let runtimeState = null;

  for (const workItem of candidates) {
    const workspace = resolveWorkspace({ boardDir, workItemId: workItem.id });
    if (!workspace.ok) {
      dispatchErrors.push(...workspace.errors);
      continue;
    }

    const claim = await claimWorkItemUnlocked({ boardDir, workItemId: workItem.id, workerId, now, leaseMs: 60000 });
    if (!claim.ok) {
      dispatchErrors.push(...claim.errors);
      continue;
    }
    runtimeState ??= await loadRuntimeState(boardDir);
    recordClaimed(runtimeState, claim.claim);
    await saveRuntimeState(boardDir, runtimeState);

    const claimedBoard = await loadBoard(boardDir);
    const running = transitionLane(claimedBoard, workItem.id, "Running");
    if (!running.ok) {
      await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
      return { ok: false, errors: running.errors, dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
    }
    await saveBoard(boardDir, claimedBoard);
    await appendBoardEvent(boardDir, {
      event: "work_started",
      timestamp: now.toISOString(),
      workItemId: workItem.id,
      workerId
    });

    const activeWorkItem = claimedBoard.workItems.find((item) => item.id === workItem.id);
    const result = await runScriptedAttempt({ boardDir, workItem: activeWorkItem, workerId, script: runnerScript, now });
    recordRunning(runtimeState, {
      workItemId: workItem.id,
      workerId,
      attemptId: result.attemptId,
      startedAt: now.toISOString(),
      lastEventAt: now.toISOString()
    });
    for (const event of result.events ?? runnerScript) {
      updateRunningEvent(runtimeState, { workItemId: workItem.id, event, timestamp: now.toISOString() });
    }
    const latestBoard = await loadBoard(boardDir);
    if (result.ok) {
      const verifying = transitionLane(latestBoard, workItem.id, "Verifying");
      if (!verifying.ok) {
        await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
        return { ok: false, errors: verifying.errors, dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
      }
      dispatchedWorkItemIds.push(workItem.id);
      clearRunning(runtimeState, workItem.id);
      clearClaimed(runtimeState, workItem.id);
      clearRetry(runtimeState, workItem.id);
    } else {
      const attemptNumber = (workItem.attemptNumber ?? 0) + 1;
      const dueAt = new Date(now.getTime() + nextBackoffMs(attemptNumber)).toISOString();
      const failedFast = transitionLane(latestBoard, workItem.id, "Failed Fast", { gates: {} }, {
        attemptNumber,
        nextRetryAt: dueAt,
        errorCode: result.failure?.code ?? result.errors[0]?.code ?? "HARNESS_RUNNER_FAILED",
        errorCategory: result.failure?.category ?? null,
        errorReason: result.failure?.reason ?? result.errors[0]?.reason ?? null,
        errorNextAction: result.failure?.nextAction ?? null,
        latestAttemptId: result.attemptId ?? null
      });
      if (!failedFast.ok) {
        await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
        return { ok: false, errors: failedFast.errors, dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
      }
      retryWorkItemIds.push(workItem.id);
      recordRetry(runtimeState, {
        workItemId: workItem.id,
        attemptNumber,
        dueAt,
        errorCode: result.failure?.code ?? result.errors[0]?.code ?? "HARNESS_RUNNER_FAILED",
        errorCategory: result.failure?.category ?? null,
        errorReason: result.failure?.reason ?? result.errors[0]?.reason ?? null,
        latestAttemptId: result.attemptId ?? null
      });
      clearRunning(runtimeState, workItem.id);
      clearClaimed(runtimeState, workItem.id);
      if (result.errors.length > 0) {
        await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
        await saveBoard(boardDir, latestBoard);
        await saveRuntimeState(boardDir, runtimeState);
        return { ok: false, errors: result.errors, failure: result.failure ?? null, dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
      }
    }

    await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
    await saveBoard(boardDir, latestBoard);
    await saveRuntimeState(boardDir, runtimeState);
  }

  return {
    ok: dispatchErrors.length === 0,
    errors: dispatchErrors,
    dispatchedWorkItemIds,
    retryWorkItemIds,
    promotedWorkItemIds
  };
}

function renderNativeTaskPrompt({ boardDir, workItem, attemptId, projectRoot, nodeKind = "implementation" }) {
  // Doctrine: the LLM (blueprint) authors what the worker believes its job is.
  // If the work item declares its own implementation prompt, use it verbatim and
  // only interpolate engine-owned runtime values.
  if (typeof workItem.implementationPrompt === "string" && workItem.implementationPrompt.trim().length > 0) {
    return interpolateRuntimeValues(workItem.implementationPrompt, {
      boardDir,
      projectRoot,
      attemptId,
      workItemId: workItem.id
    });
  }
  process.stderr.write("[make-it-real] workItem missing implementationPrompt — falling back to engine-generated prompt. Declare implementationPrompt in your blueprint.\n");

  return `Work item: ${workItem.id}
Run directory: ${boardDir}
Project root: ${projectRoot ?? "(unknown)"}

NOTE: implementationPrompt not declared in blueprint. Declare it for proper guidance.

Allowed paths: ${(workItem.allowedPaths ?? []).join(", ")}
Contracts: ${(workItem.contractIds ?? []).join(", ")}
Verification: ${JSON.stringify(workItem.verificationCommands ?? [])}
Attempt: ${attemptId}
`;
}

function renderNativeReviewerPrompt({
  role,
  boardDir,
  workItem,
  attemptId,
  projectRoot,
  nodeKind = "implementation",
  nativeSubagentType = "general-purpose",
  mappingSource = "builtin-default"
}) {
  // Doctrine: the LLM (blueprint) authors the reviewer's brief. If the work item
  // declares a prompt for this reviewer role, use it verbatim and only interpolate
  // engine-owned runtime values.
  const declaredReviewerPrompt = workItem.reviewerPrompts?.[role];
  if (typeof declaredReviewerPrompt === "string" && declaredReviewerPrompt.trim().length > 0) {
    return interpolateRuntimeValues(declaredReviewerPrompt, {
      boardDir,
      projectRoot,
      attemptId,
      workItemId: workItem.id
    });
  }
  process.stderr.write(`[make-it-real] workItem missing reviewerPrompts.${role} — falling back to engine-generated reviewer prompt. Declare reviewerPrompts in your blueprint.\n`);

  return `Reviewer role: ${role}
Work item: ${workItem.id}
NOTE: reviewerPrompts[${role}] not declared in blueprint. Declare it for proper guidance.
`;
}

export async function startNativeClaudeTask(args) {
  return withBoardLock(args.boardDir, () => startNativeClaudeTaskInner(args));
}

async function startNativeClaudeTaskInner({ boardDir, workerId = "claude-code.parent", concurrency = 1, now }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return {
      ok: false,
      command: "orchestrator native start",
      nativeTasks: [],
      errors: [createHarnessError({
        code: "HARNESS_NATIVE_CONCURRENCY_INVALID",
        reason: "Native Claude Task concurrency must be a positive integer.",
        evidence: ["--concurrency"],
        recoverable: true
      })]
    };
  }

  const policy = await validateRunnerPolicy(boardDir, { runnerMode: "claude-code" });
  if (!policy.ok) {
    return { ok: false, command: "orchestrator native start", nativeTasks: [], errors: policy.errors };
  }

  let board = await loadBoard(boardDir);
  const graph = validateDependencyGraph(board);
  if (!graph.ok) {
    return { ok: false, command: "orchestrator native start", nativeTasks: [], errors: graph.errors };
  }

  const readyPromotion = await promoteReadyGateApprovedWork({ boardDir, board, now });
  if (!readyPromotion.ok) {
    return { ok: false, command: "orchestrator native start", nativeTasks: [], errors: readyPromotion.errors };
  }
  board = readyPromotion.board;

  const readyWorkItems = getReadyWorkItems(board).slice(0, concurrency);
  if (readyWorkItems.length === 0) {
    return {
      ok: true,
      command: "orchestrator native start",
      nativeTasks: [],
      promotedWorkItemIds: readyPromotion.promotedWorkItemIds,
      errors: []
    };
  }

  const projectRoot = resolveProjectRootForRun({ runDir: boardDir });
  const roleMapping = await resolveNativeRoleMapping({ boardDir, projectRoot });
  if (!roleMapping.ok) {
    return { ok: false, command: "orchestrator native start", nativeTasks: [], errors: roleMapping.errors };
  }
  const implementationMapping = mappingForEvidenceRole(roleMapping.mapping, "implementation-worker");
  const nativeTasks = [];
  const dispatchErrors = [];
  const runtimeState = await loadRuntimeState(boardDir);
  for (const workItem of readyWorkItems) {
    const claim = await claimWorkItemUnlocked({ boardDir, workItemId: workItem.id, workerId, now, leaseMs: 60 * 60 * 1000 });
    if (!claim.ok) {
      dispatchErrors.push(...claim.errors);
      continue;
    }

    const claimedBoard = await loadBoard(boardDir);
    const running = transitionLane(claimedBoard, workItem.id, "Running");
    if (!running.ok) {
      await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
      dispatchErrors.push(...running.errors);
      continue;
    }
    await saveBoard(boardDir, claimedBoard);

    const activeWorkItem = claimedBoard.workItems.find((item) => item.id === workItem.id);
    const attempt = await createRunAttempt({ boardDir, workItem: activeWorkItem, workerId, now });
    const nodeKind = await nodeKindForWorkItem({ runDir: boardDir, workItemId: activeWorkItem.id });
    const implementationPrompt = renderNativeTaskPrompt({
      boardDir,
      workItem: activeWorkItem,
      attemptId: attempt.attemptId,
      projectRoot,
      nodeKind
    });
    const reviewerPrompts = resolveRequiredReviewRoles({ workItem: activeWorkItem }).map((role) => {
      const roleEntry = mappingForEvidenceRole(roleMapping.mapping, role);
      return {
        role,
        evidenceRole: role,
        nativeSubagentType: roleEntry?.nativeSubagentType ?? "general-purpose",
        mappingSource: roleEntry?.mappingSource ?? "builtin-default",
        mappingPath: roleMapping.mappingPath,
        prompt: renderNativeReviewerPrompt({
          role,
          boardDir,
          workItem: activeWorkItem,
          attemptId: attempt.attemptId,
          projectRoot,
          nodeKind,
          nativeSubagentType: roleEntry?.nativeSubagentType ?? "general-purpose",
          mappingSource: roleEntry?.mappingSource ?? "builtin-default"
        })
      };
    });

    recordClaimed(runtimeState, claim.claim);
    recordRunning(runtimeState, {
      workItemId: activeWorkItem.id,
      workerId,
      attemptId: attempt.attemptId,
      startedAt: now.toISOString(),
      lastEventAt: now.toISOString()
    });
    updateRunningEvent(runtimeState, { workItemId: activeWorkItem.id, event: "session_started", timestamp: now.toISOString() });
    await saveRuntimeState(boardDir, runtimeState);

    await updateRunAttempt({
      boardDir,
      attemptId: attempt.attemptId,
      patch: {
        events: ["session_started"],
        runner: {
          mode: "claude-code",
          channel: "parent-native-task",
          nodeKind,
          projectRoot,
          implementationSubagentType: implementationMapping?.nativeSubagentType ?? "general-purpose",
          implementationMappingSource: implementationMapping?.mappingSource ?? "builtin-default",
          nativeRoleMappingPath: roleMapping.mappingPath,
          implementationPrompt,
          reviewerPrompts
        }
      }
    });
    await appendBoardEvent(boardDir, {
      event: "work_started",
      timestamp: now.toISOString(),
      workItemId: activeWorkItem.id,
      workerId,
      attemptId: attempt.attemptId,
      payload: { runnerMode: "claude-code", channel: "parent-native-task" }
    });
    await appendBoardEvent(boardDir, {
      event: "session_started",
      timestamp: now.toISOString(),
      workItemId: activeWorkItem.id,
      workerId,
      attemptId: attempt.attemptId,
      payload: { runnerMode: "claude-code", channel: "parent-native-task" }
    });

    nativeTasks.push({
      workItemId: activeWorkItem.id,
      attemptId: attempt.attemptId,
      workerId,
      projectRoot,
      nodeKind,
      nativeSubagentType: implementationMapping?.nativeSubagentType ?? "general-purpose",
      mappingSource: implementationMapping?.mappingSource ?? "builtin-default",
      mappingPath: roleMapping.mappingPath,
      implementationPrompt,
      reviewerPrompts
    });
  }

  return {
    ok: dispatchErrors.length === 0,
    command: "orchestrator native start",
    promotedWorkItemIds: readyPromotion.promotedWorkItemIds,
    nativeTasks,
    errors: dispatchErrors
  };
}

function parseNativeResultRecord(resultText) {
  const text = String(resultText ?? "").trim();
  if (!text) {
    return { result: "" };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { result: text };
  }
}

function enrichReviewReportsWithDispatch({ reports, attempt }) {
  const byRole = new Map((attempt?.runner?.reviewerPrompts ?? []).map((prompt) => [prompt.role, prompt]));
  return (reports ?? []).map((report) => {
    const dispatch = byRole.get(report.role);
    return {
      ...report,
      nativeSubagentType: report.nativeSubagentType ?? dispatch?.nativeSubagentType ?? null,
      mappingSource: report.mappingSource ?? dispatch?.mappingSource ?? null,
      mappingPath: report.mappingPath ?? dispatch?.mappingPath ?? null
    };
  });
}

export async function finishNativeClaudeTask(args) {
  return withBoardLock(args.boardDir, () => finishNativeClaudeTaskInner(args));
}

async function finishNativeClaudeTaskInner({ boardDir, workItemId, attemptId, workerId = "claude-code.parent", resultText, now }) {
  const board = await loadBoard(boardDir);
  const workItem = board.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem) {
    return {
      ok: false,
      command: "orchestrator native finish",
      errors: [createHarnessError({
        code: "HARNESS_WORK_ITEM_UNKNOWN",
        reason: `Unknown work item: ${workItemId}.`,
        evidence: ["board.json"]
      })]
    };
  }
  if (workItem.lane !== "Running") {
    return {
      ok: false,
      command: "orchestrator native finish",
      errors: [createHarnessError({
        code: "HARNESS_WORK_NOT_RUNNING",
        reason: `${workItemId} must be Running before native task finish.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["board.json"],
        recoverable: true
      })]
    };
  }

  const attempt = await readRunAttempt({ boardDir, attemptId });
  const record = parseNativeResultRecord(resultText);
  const nodeKind = await nodeKindForWorkItem({ runDir: boardDir, workItemId: workItem.id });
  const policy = COMPLETION_POLICIES[nodeKind] ?? COMPLETION_POLICIES.implementation;
  const finishInput = validateNativeFinishInput({ record, policy, nodeKind, workItem });
  if (!finishInput.ok) {
    return {
      ok: false,
      command: "orchestrator native finish",
      workItemId,
      attemptId,
      errors: finishInput.errors
    };
  }
  const agent = extractAgentReport({ record, workItem, workerId, attemptId, now });
  const policyReport = extractPolicyReport({ record, policy, workItem, workerId, attemptId, now });
  const reviews = extractReviewReports({ record, workItem, workerId, attemptId, now });

  // Handle NEEDS_DECOMPOSE status
  if (policyReport?.status === "NEEDS_DECOMPOSE") {
    const proposal = policyReport.childWorkProposal;
    if (!proposal) {
      return {
        ok: false,
        command: "orchestrator native finish",
        workItemId,
        attemptId,
        errors: [createHarnessError({
          code: "HARNESS_DECOMPOSE_PROPOSAL_MISSING",
          reason: "NEEDS_DECOMPOSE status requires a childWorkProposal object.",
          evidence: ["--result-stdin"],
          recoverable: true
        })]
      };
    }

    const { materializeChildWorkItems } = await import("../board/board-mutator.mjs");
    const result = await materializeChildWorkItems({
      boardDir,
      parentWorkItemId: workItemId,
      proposal,
      now
    });

    if (!result.ok) {
      // Proposal validation failed — move to Failed Fast
      const attemptNumber = (workItem.attemptNumber ?? 0) + 1;
      const dueAt = new Date(now.getTime() + nextBackoffMs(attemptNumber)).toISOString();
      transitionLane(board, workItem.id, "Failed Fast", { gates: {} }, {
        attemptNumber,
        nextRetryAt: dueAt,
        errorCode: result.errors[0]?.code ?? "HARNESS_DECOMPOSE_FAILED",
        errorReason: result.errors[0]?.reason ?? "Decomposition proposal validation failed."
      });
      await saveBoard(boardDir, board);
      await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
      return {
        ok: false,
        command: "orchestrator native finish",
        workItemId,
        attemptId,
        errors: result.errors
      };
    }

    // Update attempt record
    await updateRunAttempt({
      boardDir,
      attemptId,
      patch: {
        status: "decomposed",
        completedAt: now.toISOString(),
        events: [...new Set([...(attempt?.events ?? []), "work_decomposed"])],
        runner: {
          ...(attempt?.runner ?? {}),
          decomposition: {
            childWorkItemIds: result.childWorkItemIds,
            reason: proposal.reason
          }
        }
      }
    });

    const runtimeState = await loadRuntimeState(boardDir);
    clearRunning(runtimeState, workItem.id);
    clearClaimed(runtimeState, workItem.id);
    await saveRuntimeState(boardDir, runtimeState);
    await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });

    return {
      ok: true,
      command: "orchestrator native finish",
      workItemId,
      attemptId,
      decomposed: true,
      childWorkItemIds: result.childWorkItemIds,
      events: ["work_decomposed"],
      errors: []
    };
  }

  const reviewReports = enrichReviewReportsWithDispatch({ reports: reviews.reports ?? [], attempt });
  const agentReports = [agent.report, policyReport]
    .filter(Boolean)
    .filter((report, index, reports) => reports.findIndex((candidate) => candidate.role === report.role) === index);
  const agentValidation = validateAgentReports({ reports: agentReports, workItem });
  const changedFiles = policyReport?.changedFiles ?? agent.report?.changedFiles ?? [];
  const boundary = validateChangedPaths({ workItem, changedPaths: changedFiles });
  const policyValidation = validateNativeCompletionPolicy({
    nodeKind,
    policyReport,
    agentReports,
    reviewReports,
    changedFiles,
    workItem,
    attemptId
  });
  const errors = [
    ...(agent.errors ?? []),
    ...(reviews.errors ?? []),
    ...agentValidation.errors,
    ...boundary.errors,
    ...policyValidation.errors
  ];
  const ok = errors.length === 0;
  const runtimeState = await loadRuntimeState(boardDir);

  if (ok) {
    const verifying = transitionLane(board, workItem.id, "Verifying");
    if (!verifying.ok) {
      await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
      return { ok: false, command: "orchestrator native finish", errors: verifying.errors };
    }
    clearRunning(runtimeState, workItem.id);
    clearClaimed(runtimeState, workItem.id);
    clearRetry(runtimeState, workItem.id);
  } else {
    const attemptNumber = (workItem.attemptNumber ?? 0) + 1;
    const dueAt = new Date(now.getTime() + nextBackoffMs(attemptNumber)).toISOString();
    const failedFast = transitionLane(board, workItem.id, "Failed Fast", { gates: {} }, {
      attemptNumber,
      nextRetryAt: dueAt,
      errorCode: errors[0]?.code ?? "HARNESS_NATIVE_TASK_FAILED",
      errorCategory: null,
      errorReason: errors[0]?.reason ?? null,
      errorNextAction: null,
      latestAttemptId: attemptId
    });
    if (!failedFast.ok) {
      await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });
      return { ok: false, command: "orchestrator native finish", errors: failedFast.errors };
    }
    recordRetry(runtimeState, {
      workItemId: workItem.id,
      attemptNumber,
      dueAt,
      errorCode: errors[0]?.code ?? "HARNESS_NATIVE_TASK_FAILED",
      errorCategory: null,
      errorReason: errors[0]?.reason ?? null,
      latestAttemptId: attemptId
    });
    clearRunning(runtimeState, workItem.id);
    clearClaimed(runtimeState, workItem.id);
  }

  await updateRunAttempt({
    boardDir,
    attemptId,
    patch: {
      status: ok ? "completed" : "failed",
      completedAt: now.toISOString(),
      events: [...new Set([...(attempt.events ?? []), ok ? "turn_completed" : "turn_failed"])],
      runner: {
        ...(attempt.runner ?? {}),
        mode: "claude-code",
        channel: "parent-native-task",
        nodeKind,
        agentReports,
        reviewReports,
        resultText: String(resultText ?? "")
      }
    }
  });
  await appendBoardEvent(boardDir, {
    event: ok ? "turn_completed" : "turn_failed",
    timestamp: now.toISOString(),
    workItemId: workItem.id,
    workerId,
    attemptId,
    payload: { channel: "parent-native-task" }
  });
  await saveBoard(boardDir, board);
  await saveRuntimeState(boardDir, runtimeState);
  await releaseClaimUnlocked({ boardDir, workItemId: workItem.id, workerId });

  return {
    ok,
    command: "orchestrator native finish",
    workItemId,
    attemptId,
    events: [ok ? "turn_completed" : "turn_failed"],
    errors
  };
}

export async function reconcileBoard(args) {
  return withBoardLock(args.boardDir, () => reconcileBoardInner(args));
}

async function reconcileBoardInner({ boardDir, now }) {
  const board = await loadBoard(boardDir);
  const runtimeState = await loadRuntimeState(boardDir);
  const releasedClaimWorkItemIds = [];
  const retryReadyWorkItemIds = [];
  const expiredLeaseWorkItemIds = [];
  const blockedRetryExhaustedWorkItemIds = [];
  const terminalLanes = new Set(["Done", "Cancelled"]);

  for (const claim of await listClaims({ boardDir, now })) {
    const workItem = board.workItems.find((item) => item.id === claim.workItemId);
    if (!workItem || terminalLanes.has(workItem.lane)) {
      await releaseClaimUnlocked({ boardDir, workItemId: claim.workItemId, workerId: claim.workerId });
      clearClaimed(runtimeState, claim.workItemId);
      clearRunning(runtimeState, claim.workItemId);
      releasedClaimWorkItemIds.push(claim.workItemId);
    }
  }

  const activeClaimIds = new Set((await listClaims({ boardDir, now })).map((claim) => claim.workItemId));
  for (const workItem of board.workItems) {
    if (
      (workItem.lane === "Claimed" || workItem.lane === "Running")
      && !activeClaimIds.has(workItem.id)
    ) {
      const expired = canTransition({
        from: workItem.lane,
        to: "Ready",
        context: { gates: { leaseExpired: true } }
      });
      if (!expired.ok) {
        return { ok: false, errors: expired.errors, releasedClaimWorkItemIds, retryReadyWorkItemIds };
      }
      workItem.lane = "Ready";
      clearClaimed(runtimeState, workItem.id);
      clearRunning(runtimeState, workItem.id);
      expiredLeaseWorkItemIds.push(workItem.id);
      await appendBoardEvent(boardDir, {
        event: "claim_expired",
        workItemId: workItem.id,
        timestamp: now.toISOString(),
        payload: { source: "reconcileBoard" }
      });
    }
  }

  for (const workItem of board.workItems) {
    if (
      workItem.lane === "Failed Fast" &&
      workItem.nextRetryAt &&
      new Date(workItem.nextRetryAt).getTime() <= now.getTime()
    ) {
      const attempts = workItem.attemptNumber ?? 0;
      if (attempts >= MAX_RETRY_ATTEMPTS) {
        const blocked = canTransition({ from: workItem.lane, to: "Blocked", context: { gates: {} } });
        if (!blocked.ok) {
          return { ok: false, errors: blocked.errors, releasedClaimWorkItemIds, retryReadyWorkItemIds };
        }
        workItem.lane = "Blocked";
        workItem.blockedReason = "max retry attempts exceeded";
        delete workItem.nextRetryAt;
        clearRetry(runtimeState, workItem.id);
        blockedRetryExhaustedWorkItemIds.push(workItem.id);
        await appendBoardEvent(boardDir, {
          event: "work_blocked",
          workItemId: workItem.id,
          timestamp: now.toISOString(),
          payload: { reason: "max retry attempts exceeded", attemptNumber: attempts }
        });
        continue;
      }
      const retry = canTransition({ from: workItem.lane, to: "Ready", context: { gates: { retry: true } } });
      if (!retry.ok) {
        return { ok: false, errors: retry.errors, releasedClaimWorkItemIds, retryReadyWorkItemIds };
      }
      workItem.lane = "Ready";
      delete workItem.nextRetryAt;
      delete workItem.errorCode;
      delete workItem.errorCategory;
      delete workItem.errorReason;
      delete workItem.errorNextAction;
      delete workItem.latestAttemptId;
      clearRetry(runtimeState, workItem.id);
      retryReadyWorkItemIds.push(workItem.id);
    }
  }

  await saveBoard(boardDir, board);
  await saveRuntimeState(boardDir, runtimeState);

  // Check if any decomposing parents can be promoted
  const decomposingParentIds = [];
  for (const workItem of board.workItems) {
    if (workItem.lane === "Decomposing" && (workItem.childWorkItemIds ?? []).length > 0) {
      const { completeParentWhenChildrenDone } = await import("../board/board-mutator.mjs");
      const parentResult = await completeParentWhenChildrenDone({ boardDir, parentWorkItemId: workItem.id, now });
      if (parentResult.transitioned) {
        decomposingParentIds.push(workItem.id);
      }
    }
  }

  return {
    ok: true,
    errors: [],
    releasedClaimWorkItemIds,
    retryReadyWorkItemIds,
    decomposingParentIds,
    expiredLeaseWorkItemIds,
    blockedRetryExhaustedWorkItemIds
  };
}
