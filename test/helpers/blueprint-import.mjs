import { mkdir } from "node:fs/promises";
import path from "node:path";
import { validateBlueprintProposal } from "../../src/plan/blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "../../src/plan/blueprint-normalizer.mjs";
import { materializeLaunchBoard } from "../../src/plan/artifact-assembly.mjs";
import { seedBlueprintReview } from "../../src/blueprint/review.mjs";
import { renderDesignPreview } from "../../src/preview/render-preview.mjs";
import { writeCurrentRunState } from "../../src/project/run-state.mjs";
import { runGates } from "../../src/gates/index.mjs";

/**
 * Import a BlueprintProposal through the full pipeline.
 * Returns a result shape compatible with the legacy generatePlanRun helper.
 */
export async function importBlueprint({
  projectRoot,
  proposal,
  runId = null,
  runnerMode = "scripted-simulator",
  now = new Date()
} = {}) {
  const validation = validateBlueprintProposal(proposal);
  if (!validation.ok) {
    return {
      ok: false,
      planOk: false,
      implementationReady: false,
      currentRunUpdated: false,
      currentRun: null,
      runDir: null,
      runId: null,
      workItemId: null,
      contractId: null,
      readyGate: { ok: false, errors: validation.errors },
      errors: validation.errors
    };
  }

  const slug = (proposal.title ?? "blueprint")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

  const effectiveRunId = runId ?? slug;
  const runDir = path.join(projectRoot, ".makeitreal", "runs", effectiveRunId);
  await mkdir(runDir, { recursive: true });

  const normalized = normalizeBlueprintProposal(proposal);
  await writeBlueprintArtifacts(normalized, runDir, effectiveRunId);

  const launchBoard = await materializeLaunchBoard({
    runDir,
    runId: effectiveRunId,
    slug: slug || "blueprint",
    workItems: normalized.workItems,
    workItemDag: normalized.workItemDag,
    runnerMode
  });

  const blueprintReview = await seedBlueprintReview({ runDir, now });
  const preview = await renderDesignPreview({ runDir, now });

  let currentRunUpdated = false;
  let currentRun = null;
  try {
    await writeCurrentRunState({ projectRoot, runDir, source: "makeitreal:plan", now });
    currentRunUpdated = true;
    currentRun = { runDir };
  } catch {
    // non-fatal
  }

  const readyGate = await runGates({ runDir, target: "Ready" });

  const workItemId = normalized.workItems[0]?.id ?? null;
  const contractId = normalized.workItems[0]?.contractIds?.[0] ?? null;

  return {
    ok: readyGate.ok || blueprintReview.ok,
    planOk: true,
    implementationReady: readyGate.ok,
    currentRunUpdated,
    currentRun,
    runDir,
    runId: effectiveRunId,
    workItemId,
    contractId,
    readyGate,
    errors: [
      ...(launchBoard.errors ?? []),
      ...(blueprintReview.errors ?? []),
      ...(preview.errors ?? []),
      ...(readyGate.errors ?? [])
    ]
  };
}

/**
 * A minimal single-module BlueprintProposal for tests that just need a valid run dir.
 */
export function minimalProposal({
  title = "Test Feature",
  moduleName = "test-feature",
  allowedPaths = ["src/test-feature/**"],
  verifyCommand = "node -e \"console.log('ok')\"",
  acceptanceCriteria = [
    "Feature implements the declared contract.",
    "Verification passes."
  ]
} = {}) {
  return {
    title,
    summary: title,
    goals: [`Deliver ${title} inside ${allowedPaths.join(", ")}.`],
    nonGoals: [`Out of scope for ${title}.`],
    acceptanceCriteria,
    assumptions: [],
    modules: [{
      name: moduleName,
      purpose: `Owns ${title}`,
      ownedPaths: allowedPaths,
      dependsOn: [],
      contracts: [{
        name: "execute",
        type: "function",
        inputs: [{ name: "request", type: "object", required: true }],
        outputs: [{ name: "result", type: "object" }],
        errors: [{ code: "BOUNDARY_CONTRACT_VIOLATION", when: "Input violates declared contract." }]
      }]
    }],
    workItems: [{
      module: moduleName,
      title,
      dependsOn: [],
      verifyCommand,
      complexity: "medium"
    }],
    scenarios: [{
      title: `${title} contract call`,
      steps: [
        { from: "Caller", to: title, action: "execute(request)" },
        { from: title, to: "Caller", action: "returns result" }
      ]
    }]
  };
}
