import { appendBoardEvent, loadBoard, saveBoard } from "../board/board-store.mjs";
import { claimWorkItem, listClaims, releaseClaim } from "../board/claim-store.mjs";
import { getReadyWorkItems, validateDependencyGraph } from "../board/dependency-graph.mjs";
import { validateChangedPaths } from "../board/responsibility-boundaries.mjs";
import { resolveBlueprintRunDir } from "../blueprint/review.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { runGates } from "../gates/index.mjs";
import { canTransition } from "../kanban/state-engine.mjs";
import { createRunAttempt, readRunAttempt, updateRunAttempt } from "./attempt-store.mjs";
import { nextBackoffMs } from "./retry-policy.mjs";
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
import { extractReviewReports } from "./review-evidence.mjs";
import { validateRunnerPolicy } from "./trust-policy.mjs";
import { resolveProjectRootForRun, resolveWorkspace } from "./workspace-manager.mjs";

const COMPLETION_POLICIES = Object.freeze({
  "implementation": {
    reportRole: "implementation-worker",
    reportKeys: ["makeitrealReport", "agentReport"],
    requiresChangedFiles: true,
    requiredReviewRoles: ["spec-reviewer", "quality-reviewer", "verification-reviewer"]
  },
  "domain-pm": {
    reportRole: "domain-pm",
    reportKeys: ["makeitrealPmReport", "pmReport"],
    requiresChangedFiles: false,
    requiredReviewRoles: ["spec-reviewer"]
  },
  "integration-evidence": {
    reportRole: "integration-evidence",
    reportKeys: ["makeitrealEvidenceReport", "evidenceReport"],
    requiresChangedFiles: false,
    requiredReviewRoles: ["verification-reviewer"]
  }
});

const APPROVED_REVIEW_STATUSES = new Set(["APPROVED", "APPROVED_WITH_NOTES"]);

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
  return value.map((item) => String(item)).filter(Boolean);
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

  const latestByRole = new Map(reviewReports.map((report) => [report.role, report]));
  const missing = policy.requiredReviewRoles.filter((role) => !latestByRole.has(role));
  if (missing.length > 0) {
    errors.push(createHarnessError({
      code: "HARNESS_REVIEW_EVIDENCE_MISSING",
      reason: `${nodeKind} node requires approved review evidence for: ${missing.join(", ")}.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: [`attempts/${attemptId}.json`],
      recoverable: true
    }));
  }

  const rejected = policy.requiredReviewRoles
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

export async function orchestratorTick({ boardDir, workerId, concurrency, now, runnerScript, runnerMode = "scripted-simulator" }) {
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
  let runtimeState = null;

  for (const workItem of candidates) {
    const workspace = resolveWorkspace({ boardDir, workItemId: workItem.id });
    if (!workspace.ok) {
      return { ok: false, errors: workspace.errors, dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
    }

    const claim = await claimWorkItem({ boardDir, workItemId: workItem.id, workerId, now, leaseMs: 60000 });
    if (!claim.ok) {
      return { ok: false, errors: claim.errors, dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
    }
    runtimeState ??= await loadRuntimeState(boardDir);
    recordClaimed(runtimeState, claim.claim);
    await saveRuntimeState(boardDir, runtimeState);

    const claimedBoard = await loadBoard(boardDir);
    const running = transitionLane(claimedBoard, workItem.id, "Running");
    if (!running.ok) {
      await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
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
        await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
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
        await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
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
        await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
        await saveBoard(boardDir, latestBoard);
        await saveRuntimeState(boardDir, runtimeState);
        return { ok: false, errors: result.errors, failure: result.failure ?? null, dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
      }
    }

    await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
    await saveBoard(boardDir, latestBoard);
    await saveRuntimeState(boardDir, runtimeState);
  }

  return { ok: true, errors: [], dispatchedWorkItemIds, retryWorkItemIds, promotedWorkItemIds };
}

function renderNativeTaskPrompt({ boardDir, workItem, attemptId, projectRoot }) {
  return `You are a Make It Real scoped implementation worker running inside the parent Claude Code session.

Use Claude Code native tools in this session. Do not spawn a separate claude CLI process.

Run directory:
- ${boardDir}

Project root:
- ${projectRoot ?? "(unknown)"}

Work item:
- ${workItem.id}

Responsibility unit:
- ${workItem.responsibilityUnitId ?? "(missing)"}

Allowed edit paths:
${(workItem.allowedPaths ?? []).map((item) => `- ${item}`).join("\n")}

Contracts:
${(workItem.contractIds ?? []).map((item) => `- ${item}`).join("\n")}

Dependency contracts:
${(workItem.dependencyContracts ?? []).length > 0
    ? workItem.dependencyContracts.map((item) => `- ${item.contractId}: ${item.surface} (${item.allowedUse})`).join("\n")
    : "- none"}

Verification commands:
${(workItem.verificationCommands ?? []).map((item) => `- ${JSON.stringify(item)}`).join("\n")}

Rules:
- Read PRD, design-pack, board, responsibility-units, blueprint-review, and contract files from the run directory before editing.
- Edit only files covered by the allowed edit paths.
- Do not add fallback behavior outside declared contracts.
- If the approved Blueprint is insufficient or the contract is wrong, stop and report NEEDS_CONTEXT or BLOCKED instead of guessing.
- The parent session will run spec-reviewer, quality-reviewer, and verification-reviewer Task subagents after your implementation turn.
- Prefer a normal concise final response. The parent session can record the result with orchestrator native finish --summary ... --changed-file ... --tested ... --review role=APPROVED.
- If you emit JSON directly, use this shape:
\`\`\`json
{
  "makeitrealReport": {
    "role": "implementation-worker",
    "status": "DONE",
    "summary": "What changed and why.",
    "changedFiles": [],
    "tested": [],
    "concerns": [],
    "needsContext": [],
    "blockers": [],
    "workItemId": "${workItem.id}",
    "attemptId": "${attemptId}"
  }
}
\`\`\`
`;
}

function renderNativeReviewerPrompt({ role, boardDir, workItem, attemptId, projectRoot }) {
  const focus = {
    "spec-reviewer": "Verify the implementation satisfies the PRD, Blueprint, declared contracts, and responsibility boundary.",
    "quality-reviewer": "Review code quality, maintainability, naming, unnecessary fallback behavior, and clean-code fit.",
    "verification-reviewer": "Review verification evidence and whether the declared verification commands prove the work item."
  }[role];
  return `You are the Make It Real ${role} for a parent-session native Claude Code launch.

${focus}

Run directory:
- ${boardDir}

Project root:
- ${projectRoot ?? "(unknown)"}

Work item:
- ${workItem.id}

Allowed edit paths:
${(workItem.allowedPaths ?? []).map((item) => `- ${item}`).join("\n")}

Review only this work item. Do not edit files. Return JSON:
\`\`\`json
{
  "makeitrealReview": {
    "role": "${role}",
    "status": "APPROVED",
    "summary": "Review result.",
    "findings": [],
    "evidence": [],
    "workItemId": "${workItem.id}",
    "attemptId": "${attemptId}"
  }
}
\`\`\`
`;
}

export async function startNativeClaudeTask({ boardDir, workerId = "claude-code.parent", concurrency = 1, now }) {
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

  const nativeTasks = [];
  for (const workItem of readyWorkItems) {
    const claim = await claimWorkItem({ boardDir, workItemId: workItem.id, workerId, now, leaseMs: 60 * 60 * 1000 });
    if (!claim.ok) {
      return { ok: false, command: "orchestrator native start", nativeTasks, errors: claim.errors };
    }

    const claimedBoard = await loadBoard(boardDir);
    const running = transitionLane(claimedBoard, workItem.id, "Running");
    if (!running.ok) {
      await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
      return { ok: false, command: "orchestrator native start", nativeTasks, errors: running.errors };
    }
    await saveBoard(boardDir, claimedBoard);

    const activeWorkItem = claimedBoard.workItems.find((item) => item.id === workItem.id);
    const attempt = await createRunAttempt({ boardDir, workItem: activeWorkItem, workerId, now });
    const projectRoot = resolveProjectRootForRun({ runDir: boardDir });
    const implementationPrompt = renderNativeTaskPrompt({
      boardDir,
      workItem: activeWorkItem,
      attemptId: attempt.attemptId,
      projectRoot
    });
    const reviewerPrompts = ["spec-reviewer", "quality-reviewer", "verification-reviewer"].map((role) => ({
      role,
      prompt: renderNativeReviewerPrompt({ role, boardDir, workItem: activeWorkItem, attemptId: attempt.attemptId, projectRoot })
    }));

    const runtimeState = await loadRuntimeState(boardDir);
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
          projectRoot,
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
      implementationPrompt,
      reviewerPrompts
    });
  }

  return {
    ok: true,
    command: "orchestrator native start",
    promotedWorkItemIds: readyPromotion.promotedWorkItemIds,
    nativeTasks,
    errors: []
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

export async function finishNativeClaudeTask({ boardDir, workItemId, attemptId, workerId = "claude-code.parent", resultText, now }) {
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
  const agent = extractAgentReport({ record, workItem, workerId, attemptId, now });
  const policyReport = extractPolicyReport({ record, policy, workItem, workerId, attemptId, now });
  const reviews = extractReviewReports({ record, workItem, workerId, attemptId, now });
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
    reviewReports: reviews.reports ?? [],
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
      await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
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
      await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
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
        reviewReports: reviews.reports ?? [],
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
  await releaseClaim({ boardDir, workItemId: workItem.id, workerId });
  await saveBoard(boardDir, board);
  await saveRuntimeState(boardDir, runtimeState);

  return {
    ok,
    command: "orchestrator native finish",
    workItemId,
    attemptId,
    events: [ok ? "turn_completed" : "turn_failed"],
    errors
  };
}

export async function reconcileBoard({ boardDir, now }) {
  const board = await loadBoard(boardDir);
  const runtimeState = await loadRuntimeState(boardDir);
  const releasedClaimWorkItemIds = [];
  const retryReadyWorkItemIds = [];
  const terminalLanes = new Set(["Done", "Cancelled"]);

  for (const claim of await listClaims({ boardDir, now })) {
    const workItem = board.workItems.find((item) => item.id === claim.workItemId);
    if (!workItem || terminalLanes.has(workItem.lane)) {
      await releaseClaim({ boardDir, workItemId: claim.workItemId, workerId: claim.workerId });
      clearClaimed(runtimeState, claim.workItemId);
      clearRunning(runtimeState, claim.workItemId);
      releasedClaimWorkItemIds.push(claim.workItemId);
    }
  }

  for (const workItem of board.workItems) {
    if (
      workItem.lane === "Failed Fast" &&
      workItem.nextRetryAt &&
      new Date(workItem.nextRetryAt).getTime() <= now.getTime()
    ) {
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
  return { ok: true, errors: [], releasedClaimWorkItemIds, retryReadyWorkItemIds };
}
