import { appendBoardEvent, loadBoard, saveBoard } from "../board/board-store.mjs";
import { claimWorkItem, listClaims, releaseClaim } from "../board/claim-store.mjs";
import { getReadyWorkItems, validateDependencyGraph } from "../board/dependency-graph.mjs";
import { resolveBlueprintRunDir } from "../blueprint/review.mjs";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { runGates } from "../gates/index.mjs";
import { canTransition } from "../kanban/state-engine.mjs";
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
import { runClaudeCodeAttempt, validateClaudeRunnerCommand } from "./claude-runner.mjs";
import { validateRunnerPolicy } from "./trust-policy.mjs";
import { resolveWorkspace } from "./workspace-manager.mjs";

function transitionLane(board, workItemId, lane, context = { gates: {} }, extra = {}) {
  const workItem = board.workItems.find((item) => item.id === workItemId);
  const transition = canTransition({ from: workItem.lane, to: lane, context });
  if (!transition.ok) {
    return transition;
  }
  Object.assign(workItem, { lane }, extra);
  return { ok: true, errors: [] };
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

  let primaryWorkItem = null;
  try {
    primaryWorkItem = findPrimaryWorkItem(await loadRunArtifacts(resolved.runDir));
  } catch (cause) {
    return {
      ok: false,
      board,
      promotedWorkItemIds: [],
      errors: [createHarnessError({
        code: "HARNESS_READY_PROMOTION_INVALID",
        reason: cause instanceof Error ? cause.message : String(cause),
        evidence: ["design-pack.json", "work-items"]
      })]
    };
  }

  const candidate = frozen.find((item) => item.id === primaryWorkItem.id);
  if (!candidate) {
    return { ok: true, board, promotedWorkItemIds: [], errors: [] };
  }

  const readyGate = await runGates({ runDir: resolved.runDir, target: "Ready" });
  if (!readyGate.ok) {
    return { ok: false, board, promotedWorkItemIds: [], errors: readyGate.errors };
  }

  const transition = transitionLane(board, candidate.id, "Ready", {
    gates: {
      design: true,
      contract: true,
      responsibility: true,
      blueprintApproval: true
    }
  });
  if (!transition.ok) {
    return { ok: false, board, promotedWorkItemIds: [], errors: transition.errors };
  }

  await saveBoard(boardDir, board);
  const event = await appendBoardEvent(boardDir, {
    event: "work_ready",
    timestamp: now.toISOString(),
    workItemId: candidate.id,
    payload: { source: "Ready gate" }
  });
  if (!event.ok) {
    return { ok: false, board, promotedWorkItemIds: [], errors: event.errors };
  }
  return { ok: true, board, promotedWorkItemIds: [candidate.id], errors: [] };
}

export async function orchestratorTick({ boardDir, workerId, concurrency, now, runnerScript, runnerMode = "scripted-simulator", runnerCommand = null }) {
  const policy = await validateRunnerPolicy(boardDir, { runnerMode });
  if (!policy.ok) {
    return { ok: false, errors: policy.errors, dispatchedWorkItemIds: [], retryWorkItemIds: [], promotedWorkItemIds: [] };
  }
  if (runnerMode === "claude-code") {
    const command = validateClaudeRunnerCommand(runnerCommand);
    if (!command.ok) {
      return { ok: false, errors: command.errors, dispatchedWorkItemIds: [], retryWorkItemIds: [], promotedWorkItemIds: [] };
    }
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
    const result = runnerMode === "claude-code"
      ? await runClaudeCodeAttempt({ boardDir, board: claimedBoard, workItem: activeWorkItem, workerId, runnerCommand, now })
      : await runScriptedAttempt({ boardDir, workItem: activeWorkItem, workerId, script: runnerScript, now });
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
