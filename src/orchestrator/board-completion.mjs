import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateOpenApiConformanceEvidence } from "../adapters/openapi-conformance.mjs";
import { appendBoardEvent, loadBoard, saveBoard } from "../board/board-store.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { BOARD_VERIFICATION_PRODUCER, formatVerificationCommand, hashCommand, normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { canTransition } from "../kanban/state-engine.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { liveWikiEnabled, resolveProjectConfigForRun } from "../config/project-config.mjs";
import { latestSuccessfulRunAttempt } from "./attempt-store.mjs";
import { loadRuntimeState, recordCompleted, saveRuntimeState } from "./runtime-state.mjs";
import { validateRunnerPolicy } from "./trust-policy.mjs";
import { resolveProjectRootForRun, resolveWorkspace } from "./workspace-manager.mjs";

const COMPLETION_POLICIES = Object.freeze({
  "implementation": {
    reportRole: "implementation-worker",
    requiresChangedFiles: true,
    requiredReviewRoles: ["spec-reviewer", "quality-reviewer", "verification-reviewer"]
  },
  "domain-pm": {
    reportRole: "domain-pm",
    requiresChangedFiles: false,
    requiredReviewRoles: ["spec-reviewer"]
  },
  "integration-evidence": {
    reportRole: "integration-evidence",
    requiresChangedFiles: false,
    requiredReviewRoles: ["verification-reviewer"]
  }
});

const APPROVED_REVIEW_STATUSES = new Set(["APPROVED", "APPROVED_WITH_NOTES"]);

function transitionWorkItem(workItem, to, context) {
  const transition = canTransition({ from: workItem.lane, to, context });
  if (!transition.ok) {
    return transition;
  }
  workItem.lane = to;
  return { ok: true, errors: [] };
}

async function nodeKindForWorkItem({ runDir, workItemId }) {
  const artifacts = await loadRunArtifacts(runDir);
  return artifacts.workItemDag.nodes?.find((node) => node.id === workItemId)?.kind ?? "implementation";
}

function validateCompletionReviewsForNode({ attempt, workItem, nodeKind }) {
  const policy = COMPLETION_POLICIES[nodeKind] ?? COMPLETION_POLICIES.implementation;
  const reports = attempt?.runner?.reviewReports ?? [];
  const latestByRole = new Map();
  for (const report of reports) {
    if (report?.workItemId === workItem.id && report?.attemptId === attempt.attemptId) {
      latestByRole.set(report.role, report);
    }
  }

  const missing = policy.requiredReviewRoles.filter((role) => !latestByRole.has(role));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_EVIDENCE_MISSING",
        reason: `Completion requires approved review evidence for: ${missing.join(", ")}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }

  const rejected = policy.requiredReviewRoles
    .map((role) => latestByRole.get(role))
    .find((report) => !APPROVED_REVIEW_STATUSES.has(report.status));
  if (rejected) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_REJECTED",
        reason: `${rejected.role} reported ${rejected.status}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }

  const latestReport = (attempt?.runner?.agentReports ?? [])
    .filter((report) => report?.workItemId === workItem.id && report?.attemptId === attempt.attemptId && report?.role === policy.reportRole)
    .at(-1);
  if (!latestReport) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_AGENT_REPORT_MISSING",
        reason: `Completion requires a ${policy.reportRole} report for ${nodeKind}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }
  if (latestReport.status !== "DONE") {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_AGENT_STATUS_INVALID",
        reason: `${latestReport.role} reported ${latestReport.status}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }
  if (policy.requiresChangedFiles && (latestReport.changedFiles ?? []).length === 0) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_AGENT_CHANGED_FILES_MISSING",
        reason: `Completion requires changed-file evidence for ${nodeKind}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }

  return { ok: true, errors: [] };
}

function renderBoardWiki({ board, workItem, evidence }) {
  return `# ${workItem.id}

Board: ${board.boardId}

Responsibility Unit: ${workItem.responsibilityUnitId}

Contracts:
${workItem.contractIds.map((contractId) => `- ${contractId}`).join("\n")}

Verification Evidence:
${evidence.commands.map((command) => `- ${formatVerificationCommand(command.command)} -> exit ${command.exitCode}`).join("\n")}

Final Lane:
- Verifying -> Human Review -> Done is owned by the orchestrator completion gate.
`;
}

export async function completeVerifiedWork({ boardDir, workItemId, now, runnerMode = null, refreshBeforeDone = null }) {
  const board = await loadBoard(boardDir);
  const workItem = board.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem) {
    return {
      ok: false,
      command: "orchestrator complete",
      errors: [createHarnessError({
        code: "HARNESS_WORK_ITEM_UNKNOWN",
        reason: `Unknown work item: ${workItemId}.`,
        evidence: ["board.json"]
      })]
    };
  }

  const retryingFromRework = workItem.lane === "Rework";
  if (!retryingFromRework && workItem.lane !== "Verifying") {
    return {
      ok: false,
      command: "orchestrator complete",
      errors: [createHarnessError({
        code: "HARNESS_WORK_NOT_VERIFYING",
        reason: `${workItemId} must be in Verifying or Rework before completion.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["board.json"]
      })]
    };
  }

  const attempt = await latestSuccessfulRunAttempt({ boardDir, workItemId });
  if (!attempt) {
    return {
      ok: false,
      command: "orchestrator complete",
      errors: [createHarnessError({
        code: "HARNESS_COMPLETION_ATTEMPT_MISSING",
        reason: `${workItemId} must have a successful runner attempt before completion.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["attempts"],
        recoverable: true
      })]
    };
  }

  const attemptRunnerMode = attempt.runner?.mode ?? null;
  if (!attemptRunnerMode || !attempt.events?.includes("turn_completed")) {
    return {
      ok: false,
      command: "orchestrator complete",
      errors: [createHarnessError({
        code: "HARNESS_COMPLETION_ATTEMPT_PROVENANCE_MISSING",
        reason: `${workItemId} latest successful attempt is missing runner provenance.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }

  if (attemptRunnerMode === "claude-code") {
    const parentNativeTask = attempt.runner?.channel === "parent-native-task";
    if (!parentNativeTask) {
      return {
        ok: false,
        command: "orchestrator complete",
        errors: [createHarnessError({
          code: "HARNESS_COMPLETION_ATTEMPT_PROVENANCE_MISSING",
          reason: `${workItemId} latest successful Claude attempt must come from the parent-session native Task path.`,
          ownerModule: workItem.responsibilityUnitId ?? null,
          evidence: [`attempts/${attempt.attemptId}.json`],
          recoverable: true
        })]
      };
    }

    const nodeKind = attempt.runner?.nodeKind ?? await nodeKindForWorkItem({ runDir: boardDir, workItemId });
    const reviews = validateCompletionReviewsForNode({ attempt, workItem, nodeKind });
    if (!reviews.ok) {
      const rework = transitionWorkItem(workItem, "Rework", { gates: {} });
      if (rework.ok) {
        workItem.errorCode = reviews.errors[0]?.code ?? "HARNESS_REVIEW_FAILED";
        workItem.errorReason = reviews.errors[0]?.reason ?? null;
        await saveBoard(boardDir, board);
      }
      return { ok: false, command: "orchestrator complete", errors: reviews.errors };
    }
  }

  if (runnerMode && runnerMode !== attemptRunnerMode) {
    return {
      ok: false,
      command: "orchestrator complete",
      errors: [createHarnessError({
        code: "HARNESS_COMPLETION_RUNNER_MISMATCH",
        reason: `Completion runner mode ${runnerMode} does not match latest successful attempt mode ${attemptRunnerMode}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }

  const policy = await validateRunnerPolicy(boardDir, { runnerMode: attemptRunnerMode });
  if (!policy.ok) {
    return { ok: false, command: "orchestrator complete", errors: policy.errors };
  }

  const workspace = resolveWorkspace({ boardDir, workItemId });
  if (!workspace.ok) {
    return { ok: false, command: "orchestrator complete", errors: workspace.errors };
  }
  await mkdir(workspace.workspace, { recursive: true });
  const projectRoot = attempt.runner?.projectRoot ?? resolveProjectRootForRun({ runDir: boardDir });
  const verificationCwd = (attempt.runner?.projectApply?.applied || attempt.runner?.channel === "parent-native-task") && projectRoot
    ? projectRoot
    : workspace.workspace;

  if (retryingFromRework) {
    const retryVerification = transitionWorkItem(workItem, "Verifying", { gates: { reworkResolved: true } });
    if (!retryVerification.ok) {
      return { ok: false, command: "orchestrator complete", errors: retryVerification.errors };
    }
    delete workItem.errorCode;
    delete workItem.errorReason;
    await saveBoard(boardDir, board);
    await appendBoardEvent(boardDir, {
      event: "rework_resolved",
      timestamp: now.toISOString(),
      workItemId,
      payload: { source: "orchestrator complete retry" }
    });
  }

  const commands = [];
  const errors = [];
  for (const command of workItem.verificationCommands ?? []) {
    const normalized = normalizeVerificationCommand(command);
    if (!normalized.ok) {
      errors.push(createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_INVALID",
        reason: normalized.reason,
        evidence: [`evidence/${workItemId}.verification.json`]
      }));
      continue;
    }

    const startedAt = Date.now();
    const result = spawnSync(normalized.command.file, normalized.command.args, {
      cwd: verificationCwd,
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        ...(normalized.command.env ?? {}),
        MAKEITREAL_BOARD_DIR: boardDir,
        MAKEITREAL_PROJECT_ROOT: projectRoot ?? "",
        MAKEITREAL_WORKSPACE: workspace.workspace,
        MAKEITREAL_WORK_ITEM_ID: workItem.id
      }
    });
    const evidence = {
      command,
      commandHash: hashCommand(command),
      cwd: verificationCwd,
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt
    };
    commands.push(evidence);
    if (result.status !== 0) {
      errors.push(createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_FAILED",
        reason: `Verification command failed: ${formatVerificationCommand(command)}`,
        evidence: [`evidence/${workItemId}.verification.json`]
      }));
    }
  }

  const verificationEvidence = {
    producer: BOARD_VERIFICATION_PRODUCER,
    kind: "board-verification",
    ok: errors.length === 0 && commands.length > 0,
    workItemId,
    commandHashes: commands.map((command) => command.commandHash),
    commands
  };
  const verificationPath = path.join(boardDir, "evidence", `${workItemId}.verification.json`);
  await writeJsonFile(verificationPath, verificationEvidence);

  if (errors.length === 0) {
    const openApiConformance = await validateOpenApiConformanceEvidence({ runDir: boardDir, workItem });
    errors.push(...openApiConformance.errors);
  }

  if (errors.length > 0) {
    const rework = transitionWorkItem(workItem, "Rework", { gates: {} });
    if (rework.ok) {
      workItem.errorCode = errors[0]?.code ?? "HARNESS_VERIFICATION_FAILED";
      await saveBoard(boardDir, board);
    }
    return { ok: false, command: "orchestrator complete", errors };
  }

  const humanReview = transitionWorkItem(workItem, "Human Review", { gates: { evidence: true } });
  if (!humanReview.ok) {
    return { ok: false, command: "orchestrator complete", errors: humanReview.errors };
  }
  await saveBoard(boardDir, board);
  await appendBoardEvent(boardDir, {
    event: "verification_completed",
    timestamp: now.toISOString(),
    workItemId,
    payload: { evidencePath: verificationPath }
  });

  const config = await resolveProjectConfigForRun({ runDir: boardDir });
  if (!config.ok) {
    return { ok: false, command: "orchestrator complete", errors: config.errors };
  }
  const wikiEvidencePath = path.join(boardDir, "evidence", `${workItemId}.wiki-sync.json`);
  let wikiPath = null;
  let wikiSkipped = false;
  if (liveWikiEnabled(config.config)) {
    const wikiRoot = path.join(boardDir, "wiki", "live");
    wikiPath = path.join(wikiRoot, `${workItemId}.md`);
    await mkdir(wikiRoot, { recursive: true });
    await writeFile(wikiPath, renderBoardWiki({ board, workItem, evidence: verificationEvidence }), "utf8");
    await writeJsonFile(wikiEvidencePath, {
      kind: "board-wiki-sync",
      workItemId,
      skipped: false,
      outputPath: wikiPath
    });
    await appendBoardEvent(boardDir, {
      event: "wiki_synced",
      timestamp: now.toISOString(),
      workItemId,
      payload: { evidencePath: wikiEvidencePath, outputPath: wikiPath }
    });
  } else {
    wikiSkipped = true;
    await writeJsonFile(wikiEvidencePath, {
      kind: "board-wiki-sync",
      workItemId,
      skipped: true,
      reason: "Live wiki is disabled by Make It Real config.",
      configPath: config.configPath,
      outputPath: null
    });
    await appendBoardEvent(boardDir, {
      event: "wiki_synced",
      timestamp: now.toISOString(),
      workItemId,
      payload: { evidencePath: wikiEvidencePath, skipped: true, configPath: config.configPath }
    });
  }

  let dashboardRefresh = null;
  if (refreshBeforeDone) {
    const refreshed = await refreshBeforeDone();
    if (!refreshed.ok) {
      return {
        ok: false,
        command: "orchestrator complete",
        dashboardRefresh: refreshed.dashboardRefresh,
        errors: refreshed.errors
      };
    }
    dashboardRefresh = refreshed.dashboardRefresh;
  }

  const done = transitionWorkItem(workItem, "Done", { gates: { evidence: true, wiki: true } });
  if (!done.ok) {
    return { ok: false, command: "orchestrator complete", errors: done.errors };
  }

  await saveBoard(boardDir, board);
  const runtimeState = await loadRuntimeState(boardDir);
  recordCompleted(runtimeState, {
    workItemId,
    completedAt: now.toISOString(),
    evidencePath: verificationPath,
    wikiPath
  });
  await saveRuntimeState(boardDir, runtimeState);

  return {
    ok: true,
    command: "orchestrator complete",
    workItemId,
    evidencePath: verificationPath,
    wikiPath,
    wikiSkipped,
    dashboardRefresh,
    errors: []
  };
}
