import { mkdir } from "node:fs/promises";
import path from "node:path";
import { validateBlueprintProposal } from "../../src/plan/blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "../../src/plan/blueprint-normalizer.mjs";
import { materializeLaunchBoard } from "../../src/plan/artifact-assembly.mjs";
import { seedBlueprintReview } from "../../src/blueprint/review.mjs";
import { renderDesignPreview } from "../../src/preview/render-preview.mjs";
import { writeCurrentRunState } from "../../src/project/run-state.mjs";
import { runGates } from "../../src/gates/index.mjs";
import { writeJsonFile } from "../../src/io/json.mjs";

// Doctrine: the engine emits only runnerMode/realAgentLaunch in trust-policy.json;
// the runner security posture (command execution + fail-fast policies) must be
// declared by the blueprint author. Tests stand in for that author by writing the
// operator-declared trust policy the orchestrator runner contract requires.
function declaredTrustPolicy({ runnerMode, runId }) {
  return {
    schemaVersion: "1.0",
    runnerMode,
    runId: runId ?? null,
    realAgentLaunch: runnerMode === "claude-code" ? "enabled" : "disabled",
    commandExecution: runnerMode === "claude-code" ? "structured-command-only" : "trusted-fixture-only",
    userInputRequired: "fail-fast",
    unsupportedToolCall: "fail-fast"
  };
}

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
    runnerMode,
    // Lane vocabulary is declared by the blueprint (its stateFlow), not invented
    // by the engine. Project it onto the launch board.
    board: { availableLanes: proposal.stateFlow?.lanes ?? [] }
  });

  // Write the operator-declared trust policy the orchestrator runner contract needs.
  await writeJsonFile(path.join(runDir, "trust-policy.json"), declaredTrustPolicy({ runnerMode, runId: effectiveRunId }));

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

// Canonical workflow state machine. Under the doctrine "LLM decides everything",
// the engine no longer fabricates lanes/transitions — the blueprint author (here,
// the test proposal) must declare them. These mirror the values the engine used
// to inject so existing gate expectations continue to hold.
export const CANONICAL_STATE_FLOW = {
  lanes: [
    "Intake", "Discovery", "Scoped", "Blueprint Bound",
    "Contract Frozen", "Ready", "Claimed", "Running",
    "Verifying", "Human Review", "Done"
  ],
  transitions: [
    { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
    { from: "Human Review", to: "Done", gate: "wiki" }
  ]
};

// Mirrors the engine's former doneEvidence path convention: evidence/<workId>.<kind>.json
export function canonicalDoneEvidence(moduleName) {
  const slug = String(moduleName ?? "blueprint")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "blueprint";
  const workId = `work.${slug}`;
  return [
    { kind: "verification", path: `evidence/${workId}.verification.json` },
    { kind: "wiki-sync", path: `evidence/${workId}.wiki-sync.json` }
  ];
}

/**
 * A minimal single-module BlueprintProposal for tests that just need a valid run dir.
 */
export function minimalProposal({
  title = "Test Feature",
  moduleName = "test-feature",
  owner = "team.implementation",
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
    stateFlow: CANONICAL_STATE_FLOW,
    modules: [{
      name: moduleName,
      purpose: `Owns ${title}`,
      owner,
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
      complexity: "medium",
      doneEvidence: canonicalDoneEvidence(moduleName)
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
