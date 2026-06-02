import path from "node:path";
import { listJsonFiles, readJsonFile } from "../io/json.mjs";

export const ACTION_CODES = {
  PLAN: "plan",
  APPROVE: "approve",
  LAUNCH: "launch",
  STATUS: "status",
  SETUP: "setup"
};

// Deterministic action-code -> Claude Code slash command mapping. This is not
// engine prose: each code resolves to exactly one operator command. Consumers
// render the surface text; this only resolves the canonical command to copy.
const ACTION_COMMANDS = {
  plan: "/makeitreal:plan <request>",
  approve: "/makeitreal:plan approve",
  launch: "/makeitreal:launch",
  status: "/makeitreal:status",
  verify: "/makeitreal:verify",
  doctor: "/makeitreal:doctor",
  setup: "/makeitreal:setup"
};

export function commandForActionCode(code) {
  return ACTION_COMMANDS[code] ?? "/makeitreal:status";
}

export function actionCodeForError(code) {
  switch (code) {
    case "HARNESS_CURRENT_RUN_MISSING":
      return ACTION_CODES.PLAN;
    case "HARNESS_BLUEPRINT_APPROVAL_MISSING":
    case "HARNESS_BLUEPRINT_APPROVAL_PENDING":
    case "HARNESS_BLUEPRINT_APPROVAL_STALE":
    case "HARNESS_BLUEPRINT_APPROVAL_DRIFT":
      return ACTION_CODES.APPROVE;
    case "HARNESS_BLUEPRINT_APPROVAL_REJECTED":
      return ACTION_CODES.PLAN;
    case "HARNESS_DAG_INVALID":
    case "HARNESS_DAG_NODE_INVALID":
    case "HARNESS_DAG_NODE_KIND_INVALID":
    case "HARNESS_DAG_NODE_WORK_ITEM_MISSING":
    case "HARNESS_DAG_EDGE_INVALID":
    case "HARNESS_DAG_DEPENDENCY_DRIFT":
    case "HARNESS_DAG_CYCLE":
    case "HARNESS_DAG_PATH_OVERLAP":
      return ACTION_CODES.PLAN;
    case "HARNESS_VERIFICATION_PLAN_MISSING":
    case "HARNESS_VERIFICATION_FAILED":
    case "HARNESS_DONE_EVIDENCE_MISSING":
      // structured action code outside the primary set; LLM decides the surface text
      return "verify";
    case "HARNESS_CLAUDE_RUNNER_STARTUP_FAILED":
    case "HARNESS_CLAUDE_RUNNER_COMMAND_REJECTED":
    case "HARNESS_CLAUDE_HOOK_FAILED":
    case "HARNESS_RUNNER_OUTPUT_INVALID":
      // structured action code outside the primary set; LLM decides the surface text
      return "doctor";
    default:
      return ACTION_CODES.STATUS;
  }
}

export function blockerFromError(error, { nextActionCode = null, authority = "engine" } = {}) {
  return {
    code: error.code,
    data: { reason: error.reason ?? null },
    nextActionCode: nextActionCode ?? actionCodeForError(error.code),
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
      nextActionCode: ACTION_CODES.PLAN,
      authority: "current-run"
    }));
    return {
      phase: "planning-required",
      blueprintStatus: "missing",
      blockers,
      nextActionCode: ACTION_CODES.PLAN,
      evidenceSummary: []
    };
  }

  const blueprintStatus = blueprintStatusFrom(blueprint);
  if (!blueprint?.ok) {
    const blockers = (blueprint?.errors ?? []).map((error) => blockerFromError(error, {
      nextActionCode: error.code === "HARNESS_BLUEPRINT_APPROVAL_REJECTED" ? ACTION_CODES.PLAN : ACTION_CODES.APPROVE,
      authority: "blueprint-review"
    }));
    const rejected = blueprintStatus === "rejected";
    const stale = blueprintStatus === "stale";
    return {
      phase: rejected || stale ? "blocked" : "approval-required",
      blueprintStatus,
      blockers,
      nextActionCode: rejected ? ACTION_CODES.PLAN : ACTION_CODES.APPROVE,
      evidenceSummary: []
    };
  }

  if (!readyGate?.ok) {
    const blockers = (readyGate?.errors ?? []).map((error) => blockerFromError(error));
    return {
      phase: "blocked",
      blueprintStatus,
      blockers,
      nextActionCode: blockers[0]?.nextActionCode ?? ACTION_CODES.STATUS,
      evidenceSummary: []
    };
  }

  return {
    phase: "launch-ready",
    blueprintStatus,
    blockers: [],
    nextActionCode: ACTION_CODES.LAUNCH,
    evidenceSummary: []
  };
}

function firstByLane(board, lanes) {
  return (board.workItems ?? []).find((item) => lanes.includes(item.lane));
}

function launchBatchSummary(launchableWork) {
  const work = launchableWork ?? [];
  const responsibilityUnits = new Set(work.map((item) => item.responsibilityUnitId ?? item.id));
  return {
    launchableWorkItemIds: work.map((item) => item.id),
    responsibilityUnitCount: responsibilityUnits.size
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
      nextActionCode: blueprintBlocked ? ACTION_CODES.APPROVE : null,
      authority
    }));
    return {
      phase: blueprintBlocked ? "approval-required" : "blocked",
      blockers,
      nextActionCode: blockers[0]?.nextActionCode ?? (blueprintBlocked ? ACTION_CODES.APPROVE : ACTION_CODES.STATUS)
    };
  }

  if ((board.workItems ?? []).length > 0 && board.workItems.every((item) => item.lane === "Done")) {
    return {
      phase: "done",
      blockers: [],
      nextActionCode: null
    };
  }

  const failedFast = firstByLane(board, ["Failed Fast"]);
  if (failedFast) {
    const retryReadyIds = new Set(retryReady.map((item) => item.id));
    const canRetry = retryReadyIds.has(failedFast.id) || !failedFast.nextRetryAt || new Date(failedFast.nextRetryAt).getTime() <= now.getTime();
    const nextActionCode = canRetry ? ACTION_CODES.LAUNCH : ACTION_CODES.STATUS;
    return {
      phase: "failed-fast",
      blockers: [{
        code: failedFast.errorCode ?? "HARNESS_RUNNER_FAILED",
        data: {
          workItemId: failedFast.id,
          canRetry,
          nextRetryAt: failedFast.nextRetryAt ?? null,
          errorReason: failedFast.errorReason ?? null
        },
        nextActionCode,
        authority: "orchestrator"
      }],
      nextActionCode
    };
  }

  const rework = firstByLane(board, ["Rework"]);
  if (rework) {
    return {
      phase: "rework-required",
      blockers: [{
        code: rework.errorCode ?? "HARNESS_VERIFICATION_FAILED",
        data: { workItemId: rework.id },
        nextActionCode: ACTION_CODES.LAUNCH,
        authority: "verification"
      }],
      nextActionCode: ACTION_CODES.LAUNCH
    };
  }

  if (firstByLane(board, ["Claimed", "Running"])) {
    return { phase: "running", blockers: [], nextActionCode: ACTION_CODES.STATUS };
  }
  if (firstByLane(board, ["Verifying"])) {
    return { phase: "verifying", blockers: [], nextActionCode: ACTION_CODES.STATUS };
  }
  if (firstByLane(board, ["Human Review"])) {
    return { phase: "human-review", blockers: [], nextActionCode: ACTION_CODES.LAUNCH };
  }
  if (launchableWork.length > 0) {
    return {
      phase: "launch-ready",
      blockers: [],
      nextActionCode: ACTION_CODES.LAUNCH,
      ...launchBatchSummary(launchableWork)
    };
  }
  if (blockedWork.length > 0) {
    return {
      phase: "blocked",
      blockers: blockedWork.map((item) => ({
        code: "HARNESS_WORK_BLOCKED",
        data: { workItemId: item.id },
        nextActionCode: ACTION_CODES.STATUS,
        authority: "dependency-graph"
      })),
      nextActionCode: ACTION_CODES.STATUS
    };
  }
  if (activeClaims.length > 0) {
    return { phase: "running", blockers: [], nextActionCode: ACTION_CODES.STATUS };
  }
  return { phase: "blocked", blockers: [], nextActionCode: ACTION_CODES.STATUS };
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
        path: path.relative(runDir, filePath)
      });
    } catch {
      summaries.push({
        kind: path.basename(filePath, ".json"),
        workItemId: null,
        ok: false,
        path: path.relative(runDir, filePath)
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
          superseded: true
        };
      }
      return summary;
    });
  }
  return summaries;
}
