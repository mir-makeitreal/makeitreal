import path from "node:path";
import { listJsonFiles, readJsonFile, writeJsonFile } from "../io/json.mjs";

function attemptPath(boardDir, attemptId) {
  return path.join(boardDir, "attempts", `${attemptId}.json`);
}

export async function createRunAttempt({ boardDir, workItem, workerId, now }) {
  const attemptId = `${workItem.id}.${now.getTime()}`;
  const attempt = {
    attemptId,
    workItemId: workItem.id,
    workerId,
    responsibilityUnitId: workItem.responsibilityUnitId ?? null,
    status: "running",
    startedAt: now.toISOString(),
    completedAt: null,
    events: []
  };
  await writeJsonFile(attemptPath(boardDir, attemptId), attempt);
  return attempt;
}

export async function updateRunAttempt({ boardDir, attemptId, patch }) {
  const current = await readRunAttempt({ boardDir, attemptId });
  const next = { ...current, ...patch };
  await writeJsonFile(attemptPath(boardDir, attemptId), next);
  return next;
}

export async function readRunAttempt({ boardDir, attemptId }) {
  return readJsonFile(attemptPath(boardDir, attemptId));
}

export async function listRunAttempts({ boardDir, workItemId = null }) {
  const files = await listJsonFiles(path.join(boardDir, "attempts"));
  const attempts = [];
  for (const filePath of files) {
    const attempt = await readJsonFile(filePath);
    if (!workItemId || attempt.workItemId === workItemId) {
      attempts.push(attempt);
    }
  }
  return attempts.sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)));
}

export async function latestSuccessfulRunAttempt({ boardDir, workItemId }) {
  const attempts = await listRunAttempts({ boardDir, workItemId });
  return attempts
    .filter((attempt) => attempt.status === "completed")
    .at(-1) ?? null;
}
