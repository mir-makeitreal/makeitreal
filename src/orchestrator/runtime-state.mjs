import path from "node:path";
import { loadBoard } from "../board/board-store.mjs";
import { fileExists, readJsonFile, writeJsonFile } from "../io/json.mjs";

function runtimeStatePath(boardDir) {
  return path.join(boardDir, "runtime-state.json");
}

function emptyRuntimeState(board) {
  return {
    schemaVersion: "1.0",
    boardId: board.boardId,
    claimed: {},
    running: {},
    retryAttempts: {},
    completedBookkeeping: {},
    sessionMetrics: {
      turnCount: 0,
      startedSessions: 0,
      failedTurns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    },
    rateLimitSnapshots: {}
  };
}

export async function loadRuntimeState(boardDir) {
  const filePath = runtimeStatePath(boardDir);
  if (await fileExists(filePath)) {
    return readJsonFile(filePath);
  }
  const board = await loadBoard(boardDir);
  const state = emptyRuntimeState(board);
  await writeJsonFile(filePath, state);
  return state;
}

export async function saveRuntimeState(boardDir, state) {
  await writeJsonFile(runtimeStatePath(boardDir), state);
}

export function recordClaimed(state, claim) {
  state.claimed[claim.workItemId] = claim;
}

export function clearClaimed(state, workItemId) {
  delete state.claimed[workItemId];
}

export function recordRunning(state, { workItemId, workerId, attemptId, startedAt, lastEventAt }) {
  state.running[workItemId] = { workItemId, workerId, attemptId, startedAt, lastEventAt };
}

export function updateRunningEvent(state, { workItemId, event, timestamp }) {
  if (!state.running[workItemId]) {
    return;
  }
  state.running[workItemId].lastEvent = event;
  state.running[workItemId].lastEventAt = timestamp;
  if (event === "session_started") {
    state.sessionMetrics.startedSessions += 1;
  }
  if (event === "turn_completed") {
    state.sessionMetrics.turnCount += 1;
  }
  if (event === "turn_failed") {
    state.sessionMetrics.failedTurns += 1;
  }
}

export function clearRunning(state, workItemId) {
  delete state.running[workItemId];
}

export function recordRetry(state, { workItemId, attemptNumber, dueAt, errorCode, errorCategory = null, errorReason = null, latestAttemptId = null }) {
  state.retryAttempts[workItemId] = {
    workItemId,
    attemptNumber,
    dueAt,
    errorCode,
    errorCategory,
    errorReason,
    latestAttemptId
  };
}

export function clearRetry(state, workItemId) {
  delete state.retryAttempts[workItemId];
}

export function recordCompleted(state, { workItemId, completedAt, evidencePath, wikiPath }) {
  state.completedBookkeeping[workItemId] = { workItemId, completedAt, evidencePath, wikiPath };
  clearRunning(state, workItemId);
  clearRetry(state, workItemId);
  clearClaimed(state, workItemId);
}
