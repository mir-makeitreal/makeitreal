import path from "node:path";
import { loadBoard } from "../board/board-store.mjs";
import { validateDesignPack } from "../domain/design-pack.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";
import { readBoardStatus } from "../status/board-status.mjs";
import { readRunStatus } from "../status/run-status.mjs";
import { buildOperatorCockpitModel } from "./operator-cockpit-model.mjs";

function findByWorkItemId(values = []) {
  return new Map(values.map((value) => [value.id ?? value.workItemId, value]));
}

function modelWorkItem(workItem, { activeClaims, blockedWork, failedFast, retryReady, rework }) {
  const claim = activeClaims.get(workItem.id) ?? null;
  const failed = failedFast.get(workItem.id) ?? null;
  return {
    id: workItem.id,
    title: workItem.title,
    lane: workItem.lane,
    responsibilityUnitId: workItem.responsibilityUnitId,
    contractIds: workItem.contractIds ?? [],
    dependsOn: workItem.dependsOn ?? [],
    allowedPaths: workItem.allowedPaths ?? [],
    isBlocked: blockedWork.has(workItem.id),
    isRetryReady: retryReady.has(workItem.id),
    isRework: rework.has(workItem.id),
    attemptNumber: failed?.attemptNumber ?? workItem.attemptNumber ?? null,
    nextRetryAt: failed?.nextRetryAt ?? workItem.nextRetryAt ?? null,
    claim
  };
}

function modelBoard(board, boardStatus) {
  if (!board) {
    return null;
  }
  const indexes = {
    activeClaims: new Map((boardStatus?.activeClaims ?? []).map((claim) => [claim.workItemId, claim])),
    blockedWork: new Set((boardStatus?.blockedWork ?? []).map((item) => item.id)),
    failedFast: findByWorkItemId(boardStatus?.failedFast ?? []),
    retryReady: findByWorkItemId(boardStatus?.retryReady ?? []),
    rework: findByWorkItemId(boardStatus?.rework ?? [])
  };
  return {
    boardId: board.boardId,
    laneCounts: boardStatus?.laneCounts ?? {},
    lanes: (board.lanes ?? []).map((lane) => ({
      name: lane,
      workItems: (board.workItems ?? [])
        .filter((workItem) => workItem.lane === lane)
        .map((workItem) => modelWorkItem(workItem, indexes))
    })),
    activeClaims: boardStatus?.activeClaims ?? [],
    blockedWork: boardStatus?.blockedWork ?? [],
    failedFast: boardStatus?.failedFast ?? [],
    retryReady: boardStatus?.retryReady ?? [],
    rework: boardStatus?.rework ?? [],
    runtimeState: boardStatus?.runtimeState ?? null,
    audit: boardStatus?.audit ?? null
  };
}

function modelContracts(apiSpecs = []) {
  return apiSpecs.map((spec) => ({
    kind: spec.kind,
    contractId: spec.contractId ?? null,
    path: spec.path ?? null,
    reason: spec.reason ?? null
  }));
}

function modelBoundaries(boundaries = []) {
  return boundaries.map((boundary) => ({
    responsibilityUnitId: boundary.responsibilityUnitId,
    owns: boundary.owns ?? [],
    mayUseContracts: boundary.mayUseContracts ?? []
  }));
}

function modelBlueprint({ prd, designPack }) {
  const contracts = modelContracts(designPack.apiSpecs ?? []);
  return {
    title: prd.title,
    summary: prd.userVisibleBehavior ?? [],
    goals: prd.goals ?? [],
    nonGoals: prd.nonGoals ?? [],
    acceptanceCriteria: prd.acceptanceCriteria ?? [],
    primaryContract: contracts[0] ?? null,
    contracts,
    boundaries: modelBoundaries(designPack.responsibilityBoundaries ?? []),
    architecture: {
      nodes: designPack.architecture?.nodes ?? [],
      edges: designPack.architecture?.edges ?? []
    },
    stateTransitions: designPack.stateFlow?.transitions ?? [],
    callStacks: designPack.callStacks ?? [],
    sequences: designPack.sequences ?? []
  };
}

export async function buildPreviewModel({ runDir, now = new Date() }) {
  const resolvedRunDir = path.resolve(runDir);
  const prd = await readJsonFile(path.join(resolvedRunDir, "prd.json"));
  const designPack = await readJsonFile(path.join(resolvedRunDir, "design-pack.json"));
  const validation = validateDesignPack(designPack);
  if (!validation.ok) {
    return validation;
  }

  const runStatus = await readRunStatus({
    projectRoot: path.dirname(resolvedRunDir),
    runDir: resolvedRunDir,
    now
  });
  const hasBoard = await fileExists(path.join(resolvedRunDir, "board.json"));
  const boardStatus = hasBoard ? await readBoardStatus({ boardDir: resolvedRunDir, now }) : null;
  const board = hasBoard ? await loadBoard(resolvedRunDir) : null;
  const statusModel = {
    phase: runStatus.phase,
    blueprintStatus: runStatus.blueprintStatus,
    headline: runStatus.headline,
    blockers: runStatus.blockers ?? [],
    nextAction: runStatus.nextAction,
    nextCommand: runStatus.nextCommand,
    evidenceSummary: runStatus.evidenceSummary ?? []
  };

  return {
    ok: true,
    model: {
      schemaVersion: "1.0",
      generatedAt: now.toISOString(),
      run: {
        runDir: resolvedRunDir,
        runId: designPack.runId,
        workItemId: designPack.workItemId,
        prdId: designPack.prdId
      },
      blueprint: modelBlueprint({ prd, designPack }),
      design: {
        architectureEdges: designPack.architecture.edges.map((edge) => `${edge.from} -> ${edge.to} (${edge.contractId})`),
        stateTransitions: designPack.stateFlow.transitions.map((transition) => `${transition.from} -> ${transition.to} via ${transition.gate}`),
        apiSpecs: designPack.apiSpecs.map((spec) => spec.kind === "none" ? `No API: ${spec.reason}` : `${spec.kind}: ${spec.contractId} at ${spec.path}`),
        responsibilityBoundaries: designPack.responsibilityBoundaries.map((boundary) => `${boundary.responsibilityUnitId}: owns ${boundary.owns.join(", ")}`),
        callStacks: designPack.callStacks.map((stack) => `${stack.entrypoint}: ${stack.calls.join(" -> ")}`),
        sequences: designPack.sequences.flatMap((sequence) => sequence.messages.map((message) => `${sequence.title}: ${message.from} -> ${message.to}: ${message.label}`))
      },
      status: statusModel,
      operatorCockpit: buildOperatorCockpitModel({ status: statusModel }),
      board: modelBoard(board, boardStatus)
    },
    designPack,
    runStatus,
    boardStatus,
    errors: []
  };
}
