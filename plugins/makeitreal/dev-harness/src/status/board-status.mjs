import { loadBoard } from "../board/board-store.mjs";
import { listClaims } from "../board/claim-store.mjs";
import { getBlockedWorkItems } from "../board/dependency-graph.mjs";
import { validateBlueprintApproval, resolveBlueprintRunDir } from "../blueprint/review.mjs";
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

export async function readBoardStatus({ boardDir, now = new Date() }) {
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
    activeClaims,
    blockedWork: blockedWork.map((item) => ({ id: item.id, dependsOn: item.dependsOn ?? [] })),
    failedFast: failedFast.map((item) => ({ id: item.id, nextRetryAt: item.nextRetryAt ?? null, attemptNumber: item.attemptNumber ?? null })),
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
    const operatorSummary = summarizeBoardOperator({ board, activeClaims, blockedWork, retryReady, now, audit });
    return {
      ...base,
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
  const readyWorkItems = (board.workItems ?? []).filter((workItem) => workItem.lane === "Ready");
  const auditWorkItems = readyWorkItems.length > 0
    ? readyWorkItems
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
  const operatorSummary = summarizeBoardOperator({ board, activeClaims, blockedWork, retryReady, now, audit });
  const evidenceSummary = await readEvidenceSummary(resolved.runDir);
  operatorSummary.evidenceSummary = evidenceSummary;
  const runtimePath = path.join(boardDir, "runtime-state.json");
  const runtimeState = await fileExists(runtimePath) ? await readJsonFile(runtimePath) : null;
  return {
    ...base,
    phase: operatorSummary.phase,
    headline: operatorSummary.headline,
    blockers: operatorSummary.blockers,
    nextAction: operatorSummary.nextAction,
    evidenceSummary,
    operatorSummary,
    runtimeState,
    audit,
    errors: []
  };
}
