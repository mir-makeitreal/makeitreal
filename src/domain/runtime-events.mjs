import { createHarnessError } from "./errors.mjs";

export const RUNTIME_EVENTS = new Set([
  "claim_created",
  "claim_expired",
  "work_ready",
  "work_started",
  "verification_completed",
  "wiki_synced",
  "session_started",
  "startup_failed",
  "turn_completed",
  "turn_failed",
  "turn_cancelled",
  "turn_ended_with_error",
  "turn_input_required",
  "unsupported_tool_call",
  "notification",
  "other_message",
  "malformed"
]);

export const FAILURE_EVENTS = new Set([
  "startup_failed",
  "turn_failed",
  "turn_cancelled",
  "turn_ended_with_error",
  "turn_input_required",
  "unsupported_tool_call",
  "malformed"
]);

export function normalizeRuntimeEvent(input) {
  if (!RUNTIME_EVENTS.has(input.event)) {
    return {
      ok: false,
      event: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_EVENT_UNKNOWN",
        reason: `Unknown runtime event: ${input.event}.`,
        evidence: ["events.jsonl"]
      })]
    };
  }

  return {
    ok: true,
    event: {
      schemaVersion: "1.0",
      event: input.event,
      timestamp: input.timestamp,
      runId: input.runId ?? input.workItemId ?? null,
      workItemId: input.workItemId ?? null,
      workerId: input.workerId ?? null,
      attemptId: input.attemptId ?? null,
      payload: input.payload ?? {}
    },
    errors: []
  };
}
