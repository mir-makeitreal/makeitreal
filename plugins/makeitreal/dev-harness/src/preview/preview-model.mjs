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

function unitIndex(responsibilityUnits) {
  return new Map((responsibilityUnits?.units ?? []).map((unit) => [unit.id, unit]));
}

function normalizeSignature(signature = {}) {
  return {
    inputs: signature.inputs ?? [],
    outputs: signature.outputs ?? [],
    errors: signature.errors ?? []
  };
}

function normalizeSurface(surface) {
  if (typeof surface === "string") {
    return {
      name: surface,
      kind: "surface",
      description: null,
      contractIds: [],
      consumers: [],
      signature: {
        inputs: [],
        outputs: [],
        errors: []
      }
    };
  }
  return {
    name: surface?.name ?? "Unnamed surface",
    kind: surface?.kind ?? "surface",
    description: surface?.description ?? null,
    contractIds: surface?.contractIds ?? [],
    consumers: surface?.consumers ?? [],
    signature: normalizeSignature(surface?.signature)
  };
}

function modelModuleInterfaces({ designPack, responsibilityUnits }) {
  const units = unitIndex(responsibilityUnits);
  return (designPack.moduleInterfaces ?? []).map((moduleInterface) => {
    const unit = units.get(moduleInterface.responsibilityUnitId) ?? {};
    return {
      responsibilityUnitId: moduleInterface.responsibilityUnitId,
      owner: moduleInterface.owner ?? unit.owner ?? null,
      moduleName: moduleInterface.moduleName ?? moduleInterface.responsibilityUnitId,
      purpose: moduleInterface.purpose ?? null,
      owns: moduleInterface.owns ?? unit.owns ?? [],
      publicSurfaces: (moduleInterface.publicSurfaces ?? []).map(normalizeSurface),
      imports: moduleInterface.imports ?? []
    };
  });
}

function modelBlueprint({ prd, designPack, responsibilityUnits }) {
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
    moduleInterfaces: modelModuleInterfaces({ designPack, responsibilityUnits }),
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
  const hasResponsibilityUnits = await fileExists(path.join(resolvedRunDir, "responsibility-units.json"));
  const responsibilityUnits = hasResponsibilityUnits ? await readJsonFile(path.join(resolvedRunDir, "responsibility-units.json")) : null;
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
      blueprint: modelBlueprint({ prd, designPack, responsibilityUnits }),
      design: {
        architectureEdges: designPack.architecture.edges.map((edge) => `${edge.from} -> ${edge.to} (${edge.contractId})`),
        stateTransitions: designPack.stateFlow.transitions.map((transition) => `${transition.from} -> ${transition.to} via ${transition.gate}`),
        apiSpecs: designPack.apiSpecs.map((spec) => spec.kind === "none" ? `No API: ${spec.reason}` : `${spec.kind}: ${spec.contractId} at ${spec.path}`),
        responsibilityBoundaries: designPack.responsibilityBoundaries.map((boundary) => `${boundary.responsibilityUnitId}: owns ${boundary.owns.join(", ")}`),
        moduleInterfaces: (designPack.moduleInterfaces ?? []).map((moduleInterface) => `${moduleInterface.responsibilityUnitId}: ${(moduleInterface.publicSurfaces ?? []).map((surface) => surface.name).join(", ")}`),
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
