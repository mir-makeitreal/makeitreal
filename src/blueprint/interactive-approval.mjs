import { decideBlueprintReview, readBlueprintReview, validateBlueprintApproval } from "./review.mjs";
import { resolveCurrentRunDir } from "../project/run-state.mjs";
import { judgeInteractiveBlueprintReviewWithLlm } from "./approval-judge.mjs";

function reviewedByFrom({ sessionId }) {
  return sessionId ? `operator:${sessionId}` : "operator:interactive";
}

export function buildInteractiveApprovalContext({ result, launchRequested }) {
  const nextAction = launchRequested ? "/makeitreal:launch" : "/makeitreal:status";
  const launchLine = launchRequested
    ? "The user also asked to start execution. Continue with /makeitreal:launch now; do not ask them to type /makeitreal:plan approve."
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

export function buildNoopUserPromptSubmitOutput({ reason = "No Make It Real interactive approval action." } = {}) {
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit"
    },
    makeitreal: {
      action: "noop",
      reason
    }
  };
}

export async function applyInteractiveBlueprintApproval({
  projectRoot,
  runDir = null,
  prompt,
  approvalContext = "",
  sessionId = null,
  judge = judgeInteractiveBlueprintReviewWithLlm,
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

  const judgment = await judge({
    prompt,
    approvalContext,
    runDir: resolved.runDir,
    env
  });
  if (!judgment.ok) {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `Make It Real interactive review: LLM judge did not produce a valid approval decision (${judgment.reason}). Do not infer Blueprint approval from keywords.`
      },
      makeitreal: {
        action: "noop",
        reason: "LLM judge did not produce a valid Blueprint review decision.",
        judge: judgment
      }
    };
  }
  if (judgment.decision === "none") {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit"
      },
      makeitreal: {
        action: "noop",
        reason: "LLM judge did not classify the prompt as a Blueprint review decision.",
        judge: judgment
      }
    };
  }

  const approvalState = await validateBlueprintApproval({ runDir: resolved.runDir });
  if (judgment.decision === "approved" && approvalState.ok) {
    const additionalContext = judgment.launchRequested
      ? "Make It Real interactive approval: Blueprint was already approved. The user asked to start execution; continue with /makeitreal:launch now."
      : "Make It Real interactive approval: Blueprint was already approved. Report that the next action is /makeitreal:launch.";
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext
      },
      makeitreal: {
        action: "already-approved",
        runDir: resolved.runDir,
        launchRequested: judgment.launchRequested,
        judge: judgment
      }
    };
  }

  const status = judgment.decision === "approved" ? "approved" : "rejected";
  const result = await decideBlueprintReview({
    runDir: resolved.runDir,
    status,
    reviewedBy: reviewedByFrom({ sessionId }),
    decisionNote: `LLM interactive Blueprint review decision (${judgment.decision}, ${judgment.confidence} confidence): ${judgment.reason}`,
    reviewSource: "makeitreal:interactive-review:llm",
    env,
    now
  });

  if (!result.ok) {
    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: `Make It Real interactive approval failed: ${result.errors.map((error) => `${error.code}: ${error.reason}`).join("; ")}`
      },
      makeitreal: {
        action: "approval-failed",
        runDir: resolved.runDir,
        launchRequested: judgment.launchRequested,
        judge: judgment,
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
        judge: judgment
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
      judge: judgment
    }
  };
}
