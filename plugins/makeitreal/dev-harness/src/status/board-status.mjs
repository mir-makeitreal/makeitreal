import { loadBoard } from "../board/board-store.mjs";
import { listClaims } from "../board/claim-store.mjs";
import { getBlockedWorkItems, getReadyWorkItems } from "../board/dependency-graph.mjs";
import { validateBlueprintApproval, resolveBlueprintRunDir } from "../blueprint/review.mjs";
import { loadRunArtifacts } from "../domain/artifacts.mjs";
import { runGates } from "../gates/index.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";
import { readEvidenceSummary, summarizeBoardOperator } from "./operator-summary.mjs";
import path from "node:path";

function countLanes(board) {
  const counts = {};
  for (const lane of board.lanes ?? []) {
    const count = board.workItems.filter((item) => item.lane === lane).length;
    if (count > 0) {
      counts[lane] = count;
    }
  }
  return counts;
}

function emptyLaunchBatch() {
  return {
    launchableWorkItemIds: [],
    recommendedNativeTaskConcurrency: 0
  };
}

function launchBatch(workItems) {
  const responsibilityUnits = new Set(workItems.map((item) => item.responsibilityUnitId ?? item.id));
  return {
    launchableWorkItemIds: workItems.map((item) => item.id),
    recommendedNativeTaskConcurrency: responsibilityUnits.size
  };
}

function dependenciesComplete(board, workItem) {
  const itemsById = new Map((board.workItems ?? []).map((item) => [item.id, item]));
  return (workItem.dependsOn ?? []).every((dependencyId) => itemsById.get(dependencyId)?.lane === "Done");
}

async function getNativeStartLaunchableWorkItems({ board, runDir }) {
  const ready = getReadyWorkItems(board);
  const readyIds = new Set(ready.map((item) => item.id));
  const artifacts = await loadRunArtifacts(runDir);
  const graphNodeIds = new Set((artifacts.workItemDag.nodes ?? []).map((node) => node.id));
  const promotable = (board.workItems ?? []).filter((item) =>
    graphNodeIds.has(item.id)
    && item.lane === "Contract Frozen"
    && !readyIds.has(item.id)
    && dependenciesComplete(board, item)
  );
  return [...ready, ...promotable];
}

function hasRuntimePriorityLane(board) {
  const workItems = board.workItems ?? [];
  return workItems.length > 0 && (
    workItems.every((item) => item.lane === "Done")
    || workItems.some((item) => ["Failed Fast", "Rework", "Claimed", "Running", "Verifying", "Human Review"].includes(item.lane))
  );
}

export async function readBoardStatus({ boardDir, now = new Date(), readyGate: providedReadyGate = null }) {
  const board = await loadBoard(boardDir);
  const activeClaims = await listClaims({ boardDir, now });
  const blockedWork = getBlockedWorkItems(board);
  const failedFast = (board.workItems ?? []).filter((item) => item.lane === "Failed Fast");
  const retryReady = failedFast.filter((item) => !item.nextRetryAt || new Date(item.nextRetryAt).getTime() <= now.getTime());
  const rework = (board.workItems ?? []).filter((item) => item.lane === "Rework");
  const base = {
    ok: true,
    command: "board status",
    boardId: board.boardId,
    laneCounts: countLanes(board),
    ...emptyLaunchBatch(),
    activeClaims,
    blockedWork: blockedWork.map((item) => ({ id: item.id, dependsOn: item.dependsOn ?? [] })),
    failedFast: failedFast.map((item) => ({
      id: item.id,
      nextRetryAt: item.nextRetryAt ?? null,
      attemptNumber: item.attemptNumber ?? null,
      errorCode: item.errorCode ?? null,
      errorCategory: item.errorCategory ?? null,
      errorReason: item.errorReason ?? null,
      latestAttemptId: item.latestAttemptId ?? null
    })),
    retryReady: retryReady.map((item) => ({ id: item.id, nextRetryAt: item.nextRetryAt ?? null })),
    rework: rework.map((item) => ({ id: item.id })),
    generatedAt: now.toISOString()
  };

  const resolved = await resolveBlueprintRunDir({ boardDir });
  if (!resolved.ok) {
    const audit = {
      ok: false,
      skipped: true,
      code: resolved.errors[0]?.code ?? "HARNESS_BLUEPRINT_AUDIT_UNLINKED",
      reason: resolved.errors[0]?.reason ?? "Board is not linked to a Blueprint run packet.",
      gateFailures: resolved.errors
    };
    const visibleLaunchBatch = emptyLaunchBatch();
    const operatorSummary = summarizeBoardOperator({
      board,
      activeClaims,
      blockedWork,
      retryReady,
      launchableWork: [],
      now,
      audit
    });
    return {
      ...base,
      ...visibleLaunchBatch,
      phase: operatorSummary.phase,
      headline: operatorSummary.headline,
      blockers: operatorSummary.blockers,
      nextAction: operatorSummary.nextAction,
      evidenceSummary: [],
      operatorSummary,
      audit,
      errors: []
    };
  }

  const approval = await validateBlueprintApproval({ runDir: resolved.runDir });
  const auditReadyWorkItems = (board.workItems ?? []).filter((workItem) => workItem.lane === "Ready");
  const auditWorkItems = auditReadyWorkItems.length > 0
    ? auditReadyWorkItems
    : (board.workItems ?? []).filter((workItem) => !["Done", "Cancelled"].includes(workItem.lane));
  const audit = {
    ok: approval.ok,
    skipped: false,
    runDir: resolved.runDir,
    blueprintBlockedWorkItemIds: approval.ok ? [] : auditWorkItems.map((workItem) => workItem.id),
    staleBlueprintWorkItemIds: approval.status === "stale" ? auditWorkItems.map((workItem) => workItem.id) : [],
    gateFailures: approval.ok ? [] : auditWorkItems.flatMap((workItem) => approval.errors.map((error) => ({
      workItemId: workItem.id,
      code: error.code,
      reason: error.reason,
      evidence: error.evidence ?? []
    })))
  };
  const readyGate = approval.ok
    ? providedReadyGate ?? await runGates({ runDir: resolved.runDir, target: "Ready" })
    : null;
  const effectiveAudit = readyGate?.ok === false && !hasRuntimePriorityLane(board)
    ? { ...audit, ok: false, gateFailures: readyGate.errors, gateFailureAuthority: "ready-gate" }
    : audit;
  const launchableWorkItems = approval.ok && readyGate?.ok
    ? await getNativeStartLaunchableWorkItems({ board, runDir: resolved.runDir })
    : [];
  const visibleLaunchBatch = launchBatch(launchableWorkItems);
  const operatorSummary = summarizeBoardOperator({
    board,
    activeClaims,
    blockedWork,
    retryReady,
    launchableWork: approval.ok && readyGate?.ok ? launchableWorkItems : [],
    now,
    audit: effectiveAudit
  });
  const evidenceSummary = await readEvidenceSummary(resolved.runDir);
  operatorSummary.evidenceSummary = evidenceSummary;
  const runtimePath = path.join(boardDir, "runtime-state.json");
  const runtimeState = await fileExists(runtimePath) ? await readJsonFile(runtimePath) : null;
  return {
    ...base,
    ...visibleLaunchBatch,
    phase: operatorSummary.phase,
    headline: operatorSummary.headline,
    blockers: operatorSummary.blockers,
    nextAction: operatorSummary.nextAction,
    evidenceSummary,
    operatorSummary,
    runtimeState,
    audit: effectiveAudit,
    readyGate,
    errors: []
  };
}
