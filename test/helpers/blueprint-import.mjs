import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateBlueprintProposal } from "../../src/plan/blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "../../src/plan/blueprint-normalizer.mjs";
import { materializeLaunchBoard } from "../../src/plan/artifact-assembly.mjs";
import { seedBlueprintReview } from "../../src/blueprint/review.mjs";
import { renderDesignPreview } from "../../src/preview/render-preview.mjs";
import { writeCurrentRunState } from "../../src/project/run-state.mjs";
import { runGates } from "../../src/gates/index.mjs";

/**
 * Import a BlueprintProposal through the full blueprint import pipeline.
 * Replaces the deleted generatePlanRun() — no rule-based generation,
 * just validate + normalize + write + materialize + review + preview.
 *
 * Returns a result shaped similarly to the old generatePlanRun for
 * backward-compatible test assertions.
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

  const slug = (proposal.intent?.title ?? "blueprint")
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

  // Update current run state
  let currentRunUpdated = false;
  let currentRun = null;
  try {
    await writeCurrentRunState({
      projectRoot,
      runDir,
      source: "makeitreal:plan",
      now
    });
    currentRunUpdated = true;
    currentRun = { runDir };
  } catch {
    // non-fatal
  }

  // Run ready gate
  const readyGate = await runGates({ runDir, target: "Ready" });

  const workItemId = normalized.workItems[0]?.id ?? null;
  const contractId = normalized.workItems[0]?.contractIds?.[0] ??
    (proposal.contracts?.[0]?.contractId ?? null);

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
 * A minimal single-work-item BlueprintProposal. Use this as a base
 * for tests that just need a valid run dir with artifacts.
 */
export function minimalProposal({
  title = "Test Feature",
  workItemId = "wi.test-feature",
  ruId = "ru.test-feature",
  owner = "team.implementation",
  allowedPaths = ["src/test-feature/**"],
  verificationCommands = [{ file: "node", args: ["-e", "console.log('ok')"] }],
  acceptanceCriteria = [
    { id: "AC-001", statement: "Feature implements the declared contract." },
    { id: "AC-002", statement: "Verification passes." }
  ]
} = {}) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const contractId = `contract.${slug}`;
  const surfaceName = `${slug}.execute`;
  return {
    intent: {
      title,
      summary: title,
      goals: [`Deliver ${title} inside ${allowedPaths.join(", ")}.`],
      userVisibleBehavior: ["Feature works as specified."],
      acceptanceCriteria,
      nonGoals: [`Out of scope for ${title}.`]
    },
    architecture: {
      nodes: [{ id: ruId, label: title, responsibilityUnitId: ruId }],
      edges: [{ from: ruId, to: ruId, contractId }]
    },
    responsibilityUnits: [{
      id: ruId,
      label: title,
      owner,
      owns: allowedPaths,
      mustProvideContracts: [contractId],
      // A providing unit also lists its own contract in mayUseContracts so its
      // work items may reference it without tripping the boundary gate — mirrors
      // the contractIds = [contractId, ...deps] shape the old plan generator emitted.
      mayUseContracts: [contractId],
      publicSurfaces: [{
        name: surfaceName,
        kind: "module",
        contractIds: [contractId],
        signature: {
          inputs: [{ name: "request", type: "object" }],
          outputs: [{ name: "result", type: "object" }],
          errors: [{ code: "BOUNDARY_CONTRACT_VIOLATION", when: "Input violates declared contract." }]
        }
      }],
      responsibility: `Owns ${title}`
    }],
    contracts: [{
      contractId,
      kind: "none",
      title: `${title} Contract`
    }],
    workItems: [{
      id: workItemId,
      title,
      responsibilityUnitId: ruId,
      contractIds: [contractId],
      dependsOn: [],
      allowedPaths,
      acceptanceCriteriaIds: acceptanceCriteria.map(ac => ac.id),
      verificationCommands: verificationCommands.map(vc => ({
        command: vc,
        purpose: "Verify implementation"
      })),
      kind: "implementation"
    }],
    sequences: [{
      title: `${title} contract call`,
      participants: ["Caller", title],
      steps: [
        { from: "Caller", to: title, action: `${surfaceName}(request)` },
        { from: title, to: "Caller", action: "returns result" }
      ]
    }]
  };
}
