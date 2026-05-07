import { runGates } from "../gates/index.mjs";
import { readCurrentRunState, resolveCurrentRunDir } from "../project/run-state.mjs";
import { validateBlueprintApproval } from "../blueprint/review.mjs";
import { fileExists } from "../io/json.mjs";
import path from "node:path";
import { readBoardStatus } from "./board-status.mjs";
import { readEvidenceSummary, summarizeRunOperator } from "./operator-summary.mjs";

function nextCommandFor(blueprint) {
  if (blueprint.ok) {
    return "/makeitreal:launch";
  }
  if (blueprint.status === "rejected") {
    return "/makeitreal:plan <request>";
  }
  if (blueprint.status === "stale") {
    return "/makeitreal:plan approve";
  }
  return "/makeitreal:plan approve";
}

export async function readRunStatus({ projectRoot, runDir = null, now = new Date() }) {
  const resolved = runDir
    ? await resolveCurrentRunDir({ projectRoot, runDir })
    : await readCurrentRunState(projectRoot);
  if (!resolved.ok) {
    const operatorSummary = summarizeRunOperator({ resolved, blueprint: null, readyGate: null });
    return {
      ok: false,
      command: "status",
      projectRoot,
      runDir: null,
      phase: operatorSummary.phase,
      blueprintStatus: operatorSummary.blueprintStatus,
      headline: operatorSummary.headline,
      blockers: operatorSummary.blockers,
      nextAction: operatorSummary.nextAction,
      evidenceSummary: operatorSummary.evidenceSummary,
      operatorSummary,
      errors: resolved.errors
    };
  }

  const blueprint = await validateBlueprintApproval({ runDir: resolved.runDir });
  const readyGate = await runGates({ runDir: resolved.runDir, target: "Ready" });
  const runOperatorSummary = summarizeRunOperator({ resolved, blueprint, readyGate });
  const evidenceSummary = await readEvidenceSummary(resolved.runDir);
  const boardStatus = await fileExists(path.join(resolved.runDir, "board.json"))
    ? await readBoardStatus({ boardDir: resolved.runDir, now })
    : null;
  const operatorSummary = blueprint.ok && readyGate.ok && boardStatus?.operatorSummary
    ? {
        ...boardStatus.operatorSummary,
        blueprintStatus: runOperatorSummary.blueprintStatus,
        evidenceSummary: boardStatus.evidenceSummary ?? evidenceSummary
      }
    : runOperatorSummary;
  operatorSummary.evidenceSummary = evidenceSummary;
  return {
    ok: true,
    command: "status",
    projectRoot,
    runDir: resolved.runDir,
    currentRun: resolved,
    blueprint: {
      ok: blueprint.ok,
      status: blueprint.status,
      stale: blueprint.stale,
      reviewedBy: blueprint.review?.reviewedBy ?? null,
      reviewedAt: blueprint.review?.reviewedAt ?? null,
      fingerprint: blueprint.currentFingerprint ?? blueprint.review?.blueprintFingerprint ?? null,
      errors: blueprint.errors
    },
    gateAudit: {
      ok: readyGate.ok,
      target: "Ready",
      checks: [
        {
          gate: "ready",
          ok: readyGate.ok,
          errors: readyGate.errors
        }
      ]
    },
    phase: operatorSummary.phase,
    blueprintStatus: operatorSummary.blueprintStatus,
    headline: operatorSummary.headline,
    blockers: operatorSummary.blockers,
    nextAction: operatorSummary.nextAction,
    nextCommand: blueprint.ok ? operatorSummary.nextAction : nextCommandFor(blueprint),
    evidenceSummary: operatorSummary.evidenceSummary,
    boardStatus,
    operatorSummary,
    generatedAt: now.toISOString(),
    errors: []
  };
}
