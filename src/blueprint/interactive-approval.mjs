import {
  decideBlueprintReview,
  readBlueprintReview,
  recordBlueprintRevisionRequest,
  validateBlueprintApproval
} from "./review.mjs";
import { resolveCurrentRunDir } from "../project/run-state.mjs";

const DECISIONS = new Set(["approved", "rejected", "revision_requested", "none"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const CONFIDENCE_ALIASES = new Map([
  ["very_high", "high"],
  ["high_confidence", "high"],
  ["certain", "high"],
  ["confident", "high"],
  ["strong", "high"],
  ["moderate", "medium"],
  ["normal", "medium"],
  ["default", "medium"],
  ["medium_confidence", "medium"],
  ["very_low", "low"],
  ["low_confidence", "low"],
  ["uncertain", "low"],
  ["weak", "low"]
]);
const NATIVE_REVIEW_SOURCE = "makeitreal:interactive-review:native-claude";

function reviewedByFrom({ sessionId }) {
  return sessionId ? `operator:${sessionId}` : "operator:interactive";
}

export function buildInteractiveApprovalContext({ result, launchRequested }) {
  const nextAction = launchRequested ? "native Make It Real launch flow" : "/makeitreal:status";
  const launchLine = launchRequested
    ? "The user also asked to start execution. Execute the Make It Real launch flow in this same Claude Code session now: read the launch skill/command, run orchestrator native start, use native Task subagents, record native finish, then run orchestrator complete. Do not ask the user to type /makeitreal:launch or /makeitreal:plan approve."
    : "The run is now launch-ready. Report that the Blueprint is approved and the next action is /makeitreal:launch.";

  return [
    "Make It Real interactive approval:",
    `Blueprint approval has been recorded at ${result.reviewPath}.`,
    `Approval source: ${result.review.reviewSource}.`,
    `Next public action: ${nextAction}.`,
    launchLine
  ].join("\n");
}

export function buildInteractiveRejectionContext({ result }) {
  return [
    "Make It Real interactive review:",
    `Blueprint review was recorded as rejected at ${result.reviewPath}.`,
    `Review source: ${result.review.reviewSource}.`,
    "Do not launch implementation. Revise the Blueprint or report the requested changes before asking for review again."
  ].join("\n");
}

export function buildInteractiveRevisionContext({ result }) {
  return [
    "Make It Real interactive review:",
    `Blueprint revision request has been recorded at ${result.reviewPath}.`,
    `Review source: ${result.review.reviewSource}.`,
    "Keep the Blueprint in pending review. Do not launch implementation.",
    "Revise the Blueprint from the operator feedback, then ask for review again."
  ].join("\n");
}

export function buildNoopUserPromptSubmitOutput({ reason = "No Make It Real interactive approval action." } = {}) {
  return {
    continue: true,
    suppressOutput: true,
    makeitreal: {
      action: "noop",
      reason
    }
  };
}

function enginePathFromEnv(env = process.env) {
  return env.CLAUDE_PLUGIN_ROOT
    ? `${env.CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine`
    : "makeitreal-engine";
}

function previewContext(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "(none)";
  }
  return text.length > 4000 ? `${text.slice(0, 4000)}\n[truncated]` : text;
}

function normalizeNativeDecisionPayload(payload) {
  if (typeof payload === "string") {
    payload = JSON.parse(payload);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Native Blueprint review decision must be a JSON object.");
  }
  if (!DECISIONS.has(payload.decision)) {
    throw new Error("Native Blueprint review decision must be approved, rejected, revision_requested, or none.");
  }
  if (typeof payload.launchRequested !== "boolean") {
    throw new Error("Native Blueprint review decision requires boolean launchRequested.");
  }
  const confidence = normalizeNativeConfidence(payload.confidence);
  const reason = typeof payload.reason === "string" && payload.reason.trim()
    ? payload.reason.trim()
    : "Native Claude Code judgment recorded from the current Blueprint review interaction.";
  if (reason.length > 1000) {
    throw new Error("Native Blueprint review decision reason must be 1000 characters or fewer.");
  }
  return {
    decision: payload.decision,
    launchRequested: payload.launchRequested,
    confidence,
    reason
  };
}

function normalizeNativeConfidence(value) {
  if (value == null) {
    return "medium";
  }
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (CONFIDENCE.has(normalized)) {
    return normalized;
  }
  return CONFIDENCE_ALIASES.get(normalized) ?? "medium";
}

export function buildNativeReviewDelegationContext({
  runDir,
  projectRoot,
  sessionId,
  prompt,
  approvalContext = "",
  env = process.env
}) {
  const enginePath = enginePathFromEnv(env);
  const session = sessionId || "interactive";
  return [
    "Make It Real pending Blueprint review:",
    `Blueprint review is pending for ${runDir}.`,
    "Judge the latest user message yourself in this same Claude Code session.",
    "Do not use keyword heuristics. Do not spawn `claude --print`, `claude --json-schema`, or another Claude process.",
    "Classify only the user's intent toward the pending Blueprint, not whether the Blueprint is technically good.",
    "Decision contract:",
    "- approved: the user intentionally approves the current Blueprint",
    "- rejected: the user explicitly rejects the current Blueprint",
    "- revision_requested: the user asks for changes, more review, or blocks approval until changes are made",
    "- none: unrelated or ambiguous; do not write review evidence",
    "If the decision is approved, rejected, or revision_requested, record your native Claude Code judgment with:",
    "```bash",
    `"${enginePath}" blueprint review "${runDir}" --prompt '<operator answer>' --decision-json '<JSON>' --session "${session}" --project-root "${projectRoot}"`,
    "```",
    "The JSON must be valid JSON with this shape. `decision` and `launchRequested` are required; `confidence` and `reason` are recommended and default to medium confidence with a generic reason if omitted.",
    "Example when the user approves and asks to start now:",
    "{\"decision\":\"approved\",\"launchRequested\":true,\"confidence\":\"high\",\"reason\":\"short native Claude Code judgment\"}",
    "Example when the user approves but does not ask to start now:",
    "{\"decision\":\"approved\",\"launchRequested\":false,\"confidence\":\"high\",\"reason\":\"short native Claude Code judgment\"}",
    "If decision is none, continue the conversation normally and do not record approval.",
    "If decision is approved and launchRequested is true, execute the Make It Real launch flow in this same Claude Code session after the review command succeeds. Do not ask the user to type `/makeitreal:launch`; read the launch skill/command and perform its native Task sequence yourself.",
    "Latest user message:",
    previewContext(prompt),
    "Previous assistant Blueprint context:",
    previewContext(approvalContext)
  ].join("\n");
}

export async function applyNativeBlueprintReviewDecision({
  projectRoot,
  runDir,
  decisionPayload,
  sessionId = null,
  env = process.env,
  now = new Date()
}) {
  let judgment;
  try {
    judgment = normalizeNativeDecisionPayload(decisionPayload);
  } catch (error) {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `Make It Real native Blueprint review failed: ${error instanceof Error ? error.message : String(error)}`
      },
      makeitreal: {
        action: "review-failed",
        runDir,
        launchRequested: false,
        errors: [{
          code: "HARNESS_NATIVE_REVIEW_DECISION_INVALID",
          reason: error instanceof Error ? error.message : String(error)
        }]
      }
    };
  }

  if (judgment.decision === "none") {
    return buildNoopUserPromptSubmitOutput({
      reason: "Native Claude Code did not classify the prompt as a Blueprint review decision."
    });
  }

  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, env });
  if (!resolved.ok) {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "Make It Real native Blueprint review failed: no active run was available."
      },
      makeitreal: {
        action: "review-failed",
        runDir,
        launchRequested: judgment.launchRequested,
        judge: { ok: true, ...judgment },
        errors: resolved.errors
      }
    };
  }

  const approvalState = await validateBlueprintApproval({ runDir: resolved.runDir });
  if (judgment.decision === "approved" && approvalState.ok) {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: judgment.launchRequested
          ? "Make It Real interactive approval: Blueprint was already approved. The user asked to start execution; execute the Make It Real launch flow in this same Claude Code session now. Do not ask the user to type /makeitreal:launch."
          : "Make It Real interactive approval: Blueprint was already approved. Ask the user whether to start execution now; do not force a slash command."
      },
      makeitreal: {
        action: "already-approved",
        runDir: resolved.runDir,
        launchRequested: judgment.launchRequested,
        judge: { ok: true, ...judgment }
      }
    };
  }

  if (judgment.decision === "revision_requested") {
    const result = await recordBlueprintRevisionRequest({
      runDir: resolved.runDir,
      requestedBy: reviewedByFrom({ sessionId }),
      decisionNote: `Native Claude Code Blueprint review decision (${judgment.decision}, ${judgment.confidence} confidence): ${judgment.reason}`,
      reviewSource: NATIVE_REVIEW_SOURCE,
      env,
      now
    });

    if (!result.ok) {
      return {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `Make It Real native revision request failed: ${result.errors.map((error) => `${error.code}: ${error.reason}`).join("; ")}`
        },
        makeitreal: {
          action: "revision-failed",
          runDir: resolved.runDir,
          launchRequested: false,
          judge: { ok: true, ...judgment },
          errors: result.errors
        }
      };
    }

    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: buildInteractiveRevisionContext({ result })
      },
      makeitreal: {
        action: "revision-requested",
        runDir: resolved.runDir,
        reviewPath: result.reviewPath,
        launchRequested: false,
        reviewedBy: result.revisionRequestedBy,
        judge: { ok: true, ...judgment }
      }
    };
  }

  const status = judgment.decision === "approved" ? "approved" : "rejected";
  const result = await decideBlueprintReview({
    runDir: resolved.runDir,
    status,
    reviewedBy: reviewedByFrom({ sessionId }),
    decisionNote: `Native Claude Code Blueprint review decision (${judgment.decision}, ${judgment.confidence} confidence): ${judgment.reason}`,
    reviewSource: NATIVE_REVIEW_SOURCE,
    env,
    now
  });

  if (!result.ok) {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `Make It Real native Blueprint review failed: ${result.errors.map((error) => `${error.code}: ${error.reason}`).join("; ")}`
      },
      makeitreal: {
        action: "approval-failed",
        runDir: resolved.runDir,
        launchRequested: judgment.launchRequested,
        judge: { ok: true, ...judgment },
        errors: result.errors
      }
    };
  }

  if (status === "rejected") {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: buildInteractiveRejectionContext({ result })
      },
      makeitreal: {
        action: "rejected",
        runDir: resolved.runDir,
        reviewPath: result.reviewPath,
        launchRequested: false,
        reviewedBy: result.reviewedBy,
        judge: { ok: true, ...judgment }
      }
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildInteractiveApprovalContext({
        result,
        launchRequested: judgment.launchRequested
      })
    },
    makeitreal: {
      action: "approved",
      runDir: resolved.runDir,
      reviewPath: result.reviewPath,
      launchRequested: judgment.launchRequested,
      reviewedBy: result.reviewedBy,
      judge: { ok: true, ...judgment }
    }
  };
}

export async function applyInteractiveBlueprintApproval({
  projectRoot,
  runDir = null,
  prompt,
  approvalContext = "",
  sessionId = null,
  env = process.env,
  now = new Date()
}) {
  const resolved = await resolveCurrentRunDir({ projectRoot, runDir, env });
  if (!resolved.ok) {
    return buildNoopUserPromptSubmitOutput({ reason: "No active Make It Real run was available for review." });
  }

  const currentReview = await readBlueprintReview({ runDir: resolved.runDir });
  if (!currentReview.ok) {
    return buildNoopUserPromptSubmitOutput({ reason: "No Blueprint review evidence was available for review." });
  }
  if (currentReview.review.status !== "pending") {
    return buildNoopUserPromptSubmitOutput({ reason: "Blueprint review is not pending." });
  }

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildNativeReviewDelegationContext({
        runDir: resolved.runDir,
        projectRoot,
        sessionId,
        prompt,
        approvalContext,
        env,
        now
      })
    },
    makeitreal: {
      action: "native-review-delegated",
      runDir: resolved.runDir,
      launchRequested: false,
      reviewPath: currentReview.reviewPath
    }
  };
}
