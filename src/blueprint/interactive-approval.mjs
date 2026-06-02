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

// Structured data emitters. The engine reports WHAT happened; the skill files
// own HOW the LLM should reason about it. No prose instructions live here.
export function buildInteractiveApprovalContext({ runDir, launchRequested }) {
  return { action: "approved", launchRequested, runDir };
}

export function buildInteractiveRejectionContext({ runDir }) {
  return { action: "rejected", runDir };
}

export function buildInteractiveRevisionContext({ runDir, feedback }) {
  return { action: "revision_requested", feedback, runDir };
}

export function buildNoopUserPromptSubmitOutput({ reason = "No Make It Real interactive approval action." } = {}) {
  return {
    continue: true,
    suppressOutput: true,
    systemMessage: reason,
    makeitreal: {
      action: "noop",
      reason
    }
  };
}

function decisionNoteFrom(judgment) {
  const confidenceText = judgment.confidence ? `, ${judgment.confidence} confidence` : "";
  return `Native Claude Code Blueprint review decision (${judgment.decision}${confidenceText}): ${judgment.reason}`;
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
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  // A recorded decision (approved/rejected/revision_requested) must carry the
  // LLM's own reason. The engine never fabricates one. "none" records nothing.
  if (payload.decision !== "none" && !reason) {
    throw new Error("Blueprint review decision must include a non-empty reason.");
  }
  if (reason.length > 1000) {
    throw new Error("Native Blueprint review decision reason must be 1000 characters or fewer.");
  }
  return {
    decision: payload.decision,
    launchRequested: payload.launchRequested,
    confidence,
    reason: reason || null
  };
}

function normalizeNativeConfidence(value) {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (CONFIDENCE.has(normalized)) {
    return normalized;
  }
  const alias = CONFIDENCE_ALIASES.get(normalized);
  if (alias) {
    return alias;
  }
  throw new Error(`Invalid confidence value: ${value}. Must be high, medium, or low.`);
}

export function buildNativeReviewDelegationContext({ runDir, blueprintStatus, reviewPath }) {
  // Structured signal only. The decision contract, the rules against keyword
  // heuristics or child Claude processes, and the launch follow-through all
  // live in the skill files — not in engine-generated prose.
  return { runDir, blueprintStatus, reviewPath, pendingDecision: true };
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
      decisionNote: decisionNoteFrom(judgment),
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
        additionalContext: JSON.stringify(buildInteractiveRevisionContext({
          runDir: resolved.runDir,
          feedback: judgment.reason
        }))
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
    decisionNote: decisionNoteFrom(judgment),
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
        additionalContext: JSON.stringify(buildInteractiveRejectionContext({ runDir: resolved.runDir }))
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
      additionalContext: JSON.stringify(buildInteractiveApprovalContext({
        runDir: resolved.runDir,
        launchRequested: judgment.launchRequested
      }))
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
      additionalContext: JSON.stringify(buildNativeReviewDelegationContext({
        runDir: resolved.runDir,
        blueprintStatus: currentReview.review.status,
        reviewPath: currentReview.reviewPath
      }))
    },
    makeitreal: {
      action: "native-review-delegated",
      runDir: resolved.runDir,
      launchRequested: false,
      reviewPath: currentReview.reviewPath
    }
  };
}
