import { mkdir } from "node:fs/promises";
import { appendBoardEvent } from "../board/board-store.mjs";
import { FAILURE_EVENTS, RUNTIME_EVENTS } from "../domain/runtime-events.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { createRunAttempt, updateRunAttempt } from "./attempt-store.mjs";
import { resolveWorkspace, validateWorkspaceCwd } from "./workspace-manager.mjs";

export async function runScriptedAttempt({ boardDir, workItem, workerId, script, now, cwd }) {
  const unknownEvent = script.find((event) => !RUNTIME_EVENTS.has(event));
  if (unknownEvent) {
    return {
      ok: false,
      attemptId: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_EVENT_UNKNOWN",
        reason: `Unknown runner event: ${unknownEvent}.`,
        evidence: ["runnerScript"]
      })]
    };
  }

  const workspace = resolveWorkspace({ boardDir, workItemId: workItem.id });
  if (!workspace.ok) {
    return { ok: false, attemptId: null, errors: workspace.errors };
  }
  const cwdResult = validateWorkspaceCwd({ workspace: workspace.workspace, cwd });
  if (!cwdResult.ok) {
    return { ok: false, attemptId: null, errors: cwdResult.errors };
  }
  await mkdir(workspace.workspace, { recursive: true });

  const attempt = await createRunAttempt({ boardDir, workItem, workerId, now });
  const events = [];

  for (const event of script) {
    events.push(event);
    await appendBoardEvent(boardDir, {
      event,
      timestamp: now.toISOString(),
      workItemId: workItem.id,
      workerId,
      attemptId: attempt.attemptId
    });
  }

  const ok = !script.some((event) => FAILURE_EVENTS.has(event));
  await updateRunAttempt({
    boardDir,
    attemptId: attempt.attemptId,
    patch: {
      status: ok ? "completed" : "failed",
      completedAt: now.toISOString(),
      events,
      runner: {
        mode: "scripted-simulator"
      }
    }
  });

  return { ok, attemptId: attempt.attemptId, workspace: workspace.workspace, errors: [] };
}
