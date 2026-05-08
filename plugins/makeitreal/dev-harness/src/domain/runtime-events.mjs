import { createHarnessError } from "./errors.mjs";

export const RUNTIME_EVENTS = new Set([
  "claim_created",
  "claim_expired",
  "work_ready",
  "work_started",
  "rework_resolved",
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

const FAILURE_CLASSES = Object.freeze({
  startup: {
    category: "startup",
    code: "HARNESS_CLAUDE_RUNNER_STARTUP_FAILED",
    reason: "Claude Code runner failed to start.",
    nextAction: "/makeitreal:doctor"
  },
  timeout: {
    category: "timeout",
    code: "HARNESS_CLAUDE_RUNNER_TIMEOUT",
    reason: "Claude Code runner timed out.",
    nextAction: "/makeitreal:launch"
  },
  quota: {
    category: "quota",
    code: "HARNESS_CLAUDE_RUNNER_QUOTA",
    reason: "Claude Code runner hit a quota or rate-limit response.",
    nextAction: "/makeitreal:status"
  },
  commandRejection: {
    category: "command-rejection",
    code: "HARNESS_CLAUDE_RUNNER_COMMAND_REJECTED",
    reason: "Claude Code runner rejected the command or tool call.",
    nextAction: "/makeitreal:doctor"
  },
  hookFailure: {
    category: "hook-failure",
    code: "HARNESS_CLAUDE_HOOK_FAILED",
    reason: "Claude Code hook execution failed.",
    nextAction: "/makeitreal:doctor"
  },
  workspaceBoundary: {
    category: "workspace-boundary",
    code: "HARNESS_WORKSPACE_BOUNDARY_FAILED",
    reason: "Runner changed files outside the declared responsibility boundary.",
    nextAction: "/makeitreal:status"
  },
  agentStatus: {
    category: "agent-status",
    code: "HARNESS_AGENT_STATUS_FAILED",
    reason: "Implementation worker did not report a clean DONE status.",
    nextAction: "/makeitreal:status"
  },
  output: {
    category: "output",
    code: "HARNESS_RUNNER_OUTPUT_INVALID",
    reason: "Claude Code runner did not produce valid structured runtime output.",
    nextAction: "/makeitreal:doctor"
  },
  generic: {
    category: "generic",
    code: "HARNESS_CLAUDE_RUNNER_FAILED",
    reason: "Claude Code runner failed.",
    nextAction: "/makeitreal:status"
  }
});

function textIncludes(patterns, value) {
  const haystack = String(value ?? "").toLowerCase();
  return patterns.some((pattern) => haystack.includes(pattern));
}

function firstClassifiedBoundaryError(errors) {
  return (errors ?? []).find((error) =>
    error?.code === "HARNESS_PATH_BOUNDARY_VIOLATION"
    || error?.code === "HARNESS_METADATA_BOUNDARY_VIOLATION"
    || error?.code === "HARNESS_PROJECT_APPLY_CONFLICT"
  );
}

function firstOutputError(errors) {
  return (errors ?? []).find((error) => error?.code === "HARNESS_RUNNER_OUTPUT_INVALID");
}

function firstAgentStatusError(errors) {
  return (errors ?? []).find((error) => typeof error?.code === "string" && error.code.startsWith("HARNESS_AGENT_"));
}

export function classifyRunnerFailure({
  failedToStart = false,
  exitCode = null,
  stdout = "",
  stderr = "",
  error = null,
  events = [],
  errors = []
} = {}) {
  const evidence = [];
  if (stdout) {
    evidence.push("runner.stdout");
  }
  if (stderr) {
    evidence.push("runner.stderr");
  }
  if (error instanceof Error || error) {
    evidence.push("runner.error");
  }

  const boundaryError = firstClassifiedBoundaryError(errors);
  if (boundaryError) {
    return {
      ...FAILURE_CLASSES.workspaceBoundary,
      code: boundaryError.code,
      reason: boundaryError.reason,
      evidence: boundaryError.evidence ?? evidence
    };
  }

  const outputError = firstOutputError(errors);
  if (outputError) {
    return {
      ...FAILURE_CLASSES.output,
      reason: outputError.reason,
      evidence: outputError.evidence ?? evidence
    };
  }

  const agentStatusError = firstAgentStatusError(errors);
  if (agentStatusError) {
    return {
      ...FAILURE_CLASSES.agentStatus,
      code: agentStatusError.code,
      reason: agentStatusError.reason,
      evidence: agentStatusError.evidence ?? evidence
    };
  }

  if (failedToStart) {
    return {
      ...FAILURE_CLASSES.startup,
      reason: error instanceof Error ? `Claude Code runner failed to start: ${error.message}` : FAILURE_CLASSES.startup.reason,
      evidence: evidence.length > 0 ? evidence : ["runner.error"]
    };
  }

  const combined = `${stdout}\n${stderr}\n${error instanceof Error ? error.message : error ?? ""}`;
  if (textIncludes(["hook failed", "stop hook", "pretooluse", "userpromptsubmit", "hook_run_id"], combined)) {
    return { ...FAILURE_CLASSES.hookFailure, evidence };
  }
  if (textIncludes(["timed out", "timeout", "etimedout", "sigterm"], combined)) {
    return { ...FAILURE_CLASSES.timeout, evidence };
  }
  if (
    textIncludes(["api_error_status\":429", "api_error_status:429", " 429", "rate limit", "quota", "usage limit", "too many requests"], combined)
  ) {
    return { ...FAILURE_CLASSES.quota, evidence };
  }
  if (
    events.includes("unsupported_tool_call")
    || events.includes("turn_input_required")
    || textIncludes(["unsupported tool", "unsupported_tool", "permission denied", "not allowed", "command rejected"], combined)
  ) {
    return { ...FAILURE_CLASSES.commandRejection, evidence };
  }

  const failureEvent = events.find((event) => FAILURE_EVENTS.has(event));
  return {
    ...FAILURE_CLASSES.generic,
    reason: failureEvent
      ? `Claude Code runner emitted failure event: ${failureEvent}.`
      : `Claude Code runner exited with status ${exitCode}.`,
    evidence
  };
}

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
