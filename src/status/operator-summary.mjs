import path from "node:path";
import { listJsonFiles, readJsonFile } from "../io/json.mjs";

const ACTIONS = {
  setup: "/makeitreal:setup",
  approve: "Answer the Blueprint review question, or reply in chat with approval, requested changes, or rejection.",
  plan: "/makeitreal:plan <request>",
  launch: "/makeitreal:launch",
  status: "/makeitreal:status",
  verify: "/makeitreal:verify",
  doctor: "/makeitreal:doctor"
};

export function actionForErrorCode(code) {
  switch (code) {
    case "HARNESS_CURRENT_RUN_MISSING":
      return ACTIONS.plan;
    case "HARNESS_BLUEPRINT_APPROVAL_MISSING":
    case "HARNESS_BLUEPRINT_APPROVAL_PENDING":
    case "HARNESS_BLUEPRINT_APPROVAL_STALE":
    case "HARNESS_BLUEPRINT_APPROVAL_DRIFT":
      return ACTIONS.approve;
    case "HARNESS_BLUEPRINT_APPROVAL_REJECTED":
      return ACTIONS.plan;
    case "HARNESS_VERIFICATION_PLAN_MISSING":
    case "HARNESS_VERIFICATION_FAILED":
    case "HARNESS_DONE_EVIDENCE_MISSING":
      return ACTIONS.verify;
    case "HARNESS_CLAUDE_RUNNER_STARTUP_FAILED":
    case "HARNESS_CLAUDE_RUNNER_COMMAND_REJECTED":
    case "HARNESS_CLAUDE_HOOK_FAILED":
    case "HARNESS_RUNNER_OUTPUT_INVALID":
      return ACTIONS.doctor;
    default:
      return ACTIONS.status;
  }
}

export function blockerFromError(error, { nextAction = null, authority = "engine" } = {}) {
  return {
    code: error.code,
    message: error.reason,
    nextAction: nextAction ?? actionForErrorCode(error.code),
    authority
  };
}

export function blueprintStatusFrom(blueprint) {
  if (!blueprint) {
    return "missing";
  }
  if (blueprint.status === "approved" && blueprint.ok) {
    return "approved";
  }
  if (["pending", "rejected", "stale"].includes(blueprint.status)) {
    return blueprint.status;
  }
  return "missing";
}

export function summarizeRunOperator({ resolved, blueprint, readyGate }) {
  if (!resolved?.ok) {
    const blockers = (resolved?.errors ?? []).map((error) => blockerFromError(error, {
      nextAction: ACTIONS.plan,
      authority: "current-run"
    }));
    return {
      phase: "planning-required",
      blueprintStatus: "missing",
      headline: "No active Make It Real run is selected yet.",
      blockers,
      nextAction: ACTIONS.plan,
      evidenceSummary: []
    };
  }

  const blueprintStatus = blueprintStatusFrom(blueprint);
  if (!blueprint?.ok) {
    const blockers = (blueprint?.errors ?? []).map((error) => blockerFromError(error, {
      nextAction: error.code === "HARNESS_BLUEPRINT_APPROVAL_REJECTED" ? ACTIONS.plan : ACTIONS.approve,
      authority: "blueprint-review"
    }));
    const rejected = blueprintStatus === "rejected";
    const stale = blueprintStatus === "stale";
    return {
      phase: rejected || stale ? "blocked" : "approval-required",
      blueprintStatus,
      headline: rejected
        ? "Blueprint was rejected and must be revised or approved."
        : stale
          ? "Blueprint approval is stale because source artifacts changed."
          : "Blueprint review is waiting for approval.",
      blockers,
      nextAction: rejected ? ACTIONS.plan : ACTIONS.approve,
      evidenceSummary: []
    };
  }

  if (!readyGate?.ok) {
    const blockers = (readyGate?.errors ?? []).map((error) => blockerFromError(error));
    return {
      phase: "blocked",
      blueprintStatus,
      headline: "Launch is blocked by Ready gate failures.",
      blockers,
      nextAction: blockers[0]?.nextAction ?? ACTIONS.status,
      evidenceSummary: []
    };
  }

  return {
    phase: "launch-ready",
    blueprintStatus,
    headline: "Blueprint is approved and ready to launch.",
    blockers: [],
    nextAction: ACTIONS.launch,
    evidenceSummary: []
  };
}

function firstByLane(board, lanes) {
  return (board.workItems ?? []).find((item) => lanes.includes(item.lane));
}

function failedFastNextAction(failedFast, canRetry) {
  if (!canRetry && failedFast.errorNextAction === ACTIONS.launch) {
    return ACTIONS.status;
  }
  return failedFast.errorNextAction ?? (canRetry ? ACTIONS.launch : ACTIONS.status);
}

function launchBatchSummary(launchableWork) {
  const work = launchableWork ?? [];
  const responsibilityUnits = new Set(work.map((item) => item.responsibilityUnitId ?? item.id));
  return {
    launchableWorkItemIds: work.map((item) => item.id),
    recommendedNativeTaskConcurrency: responsibilityUnits.size
  };
}

export function summarizeBoardOperator({
  board,
  activeClaims = [],
  blockedWork = [],
  retryReady = [],
  launchableWork = [],
  now = new Date(),
  audit = null
}) {
  const errors = audit?.gateFailures ?? [];
  if (errors.length > 0) {
    const authority = audit?.gateFailureAuthority ?? "blueprint-review";
    const blueprintBlocked = authority === "blueprint-review";
    const blockers = errors.map((error) => blockerFromError(error, {
      nextAction: blueprintBlocked ? ACTIONS.approve : null,
      authority
    }));
    return {
      phase: blueprintBlocked ? "approval-required" : "blocked",
      headline: blueprintBlocked
        ? "Board has work blocked by Blueprint approval."
        : "Board has work blocked by Ready gate failures.",
      blockers,
      nextAction: blockers[0]?.nextAction ?? (blueprintBlocked ? ACTIONS.approve : ACTIONS.status)
    };
  }

  if ((board.workItems ?? []).length > 0 && board.workItems.every((item) => item.lane === "Done")) {
    return {
      phase: "done",
      headline: "All required evidence is complete.",
      blockers: [],
      nextAction: null
    };
  }

  const failedFast = firstByLane(board, ["Failed Fast"]);
  if (failedFast) {
    const retryReadyIds = new Set(retryReady.map((item) => item.id));
    const canRetry = retryReadyIds.has(failedFast.id) || !failedFast.nextRetryAt || new Date(failedFast.nextRetryAt).getTime() <= now.getTime();
    const retryDetail = canRetry
      ? `${failedFast.id} is ready to retry.`
      : `${failedFast.id} can retry after ${failedFast.nextRetryAt}.`;
    const reasonDetail = failedFast.errorReason ? ` ${failedFast.errorReason}` : "";
    const nextAction = failedFastNextAction(failedFast, canRetry);
    return {
      phase: "failed-fast",
      headline: canRetry ? "Runner failed fast and can be retried." : "Runner failed fast and is waiting for retry time.",
      blockers: [{
        code: failedFast.errorCode ?? "HARNESS_RUNNER_FAILED",
        message: `${retryDetail}${reasonDetail}`,
        nextAction,
        authority: "orchestrator"
      }],
      nextAction
    };
  }

  const rework = firstByLane(board, ["Rework"]);
  if (rework) {
    return {
      phase: "rework-required",
      headline: "Verification failed; implementation must be revised before Done.",
      blockers: [{
        code: rework.errorCode ?? "HARNESS_VERIFICATION_FAILED",
        message: `${rework.id} requires implementation fix or replanning before completion.`,
        nextAction: ACTIONS.launch,
        authority: "verification"
      }],
      nextAction: ACTIONS.launch
    };
  }

  if (firstByLane(board, ["Claimed", "Running"])) {
    return { phase: "running", headline: "Work is running under Make It Real boundaries.", blockers: [], nextAction: ACTIONS.status };
  }
  if (firstByLane(board, ["Verifying"])) {
    return { phase: "verifying", headline: "Implementation is waiting for engine-owned verification.", blockers: [], nextAction: ACTIONS.status };
  }
  if (firstByLane(board, ["Human Review"])) {
    return { phase: "human-review", headline: "Verification passed; human review/wiki completion is pending.", blockers: [], nextAction: ACTIONS.launch };
  }
  if (launchableWork.length > 0) {
    return {
      phase: "launch-ready",
      headline: "Board has work ready for launch.",
      blockers: [],
      nextAction: ACTIONS.launch,
      ...launchBatchSummary(launchableWork)
    };
  }
  if (blockedWork.length > 0) {
    return {
      phase: "blocked",
      headline: "Some Ready work is blocked by unfinished dependencies.",
      blockers: blockedWork.map((item) => ({
        code: "HARNESS_WORK_BLOCKED",
        message: `${item.id} is waiting for dependencies.`,
        nextAction: ACTIONS.status,
        authority: "dependency-graph"
      })),
      nextAction: ACTIONS.status
    };
  }
  if (activeClaims.length > 0) {
    return { phase: "running", headline: "Work is claimed and awaiting runner progress.", blockers: [], nextAction: ACTIONS.status };
  }
  return { phase: "blocked", headline: "No launchable work is currently available.", blockers: [], nextAction: ACTIONS.status };
}

export async function readEvidenceSummary(runDir) {
  let files = [];
  try {
    files = await listJsonFiles(path.join(runDir, "evidence"));
  } catch {
    return [];
  }
  const summaries = [];
  for (const filePath of files) {
    try {
      const evidence = await readJsonFile(filePath);
      summaries.push({
        kind: evidence.kind ?? path.basename(filePath, ".json"),
        workItemId: evidence.workItemId ?? null,
        ok: evidence.ok ?? true,
        path: path.relative(runDir, filePath),
        summary: `${evidence.kind ?? "evidence"} ${evidence.ok === false ? "failed" : "recorded"}`
      });
    } catch {
      summaries.push({
        kind: path.basename(filePath, ".json"),
        workItemId: null,
        ok: false,
        path: path.relative(runDir, filePath),
        summary: "Evidence file could not be read."
      });
    }
  }
  const hasCurrentWorkItemVerification = summaries.some((summary) =>
    /^evidence\/work\..+\.verification\.json$/.test(summary.path) && summary.ok === true
  );
  if (hasCurrentWorkItemVerification) {
    return summaries.map((summary) => {
      if (summary.path === "evidence/verification.json" && summary.ok === false) {
        return {
          ...summary,
          ok: null,
          superseded: true,
          summary: "Previous ad hoc verification failure superseded by current work-item evidence"
        };
      }
      return summary;
    });
  }
  return summaries;
}
