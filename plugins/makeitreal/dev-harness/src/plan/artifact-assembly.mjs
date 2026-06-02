import path from "node:path";
import { projectBoardDag } from "../domain/work-item-dag.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";

// Rule-based generators (acceptanceCriteriaFor, prdGoalsFor, userVisibleBehaviorFor)
// have been removed. Claude Code is now the architect — it produces BlueprintProposal
// JSON that includes all acceptance criteria, goals, and user-visible behavior.
// The engine only validates and saves.

export function trustPolicyFor({ runnerMode, runId }) {
  return {
    schemaVersion: "1.0",
    runnerMode,
    runId: runId ?? null,
    realAgentLaunch: runnerMode === "claude-code" ? "enabled" : "disabled",
    // Security policies must be declared in blueprint — engine provides only runnerMode
  };
}

export async function materializeLaunchBoard({ runDir, runId, slug, workItems, workItemDag, runnerMode, board }) {
  const launchBoard = {
    schemaVersion: "1.0",
    boardId: `board.${slug}`,
    blueprintRunDir: ".",
    lanes: board?.availableLanes ?? [],
    workItemDAG: projectBoardDag(workItemDag),
    workItems
  };
  await writeJsonFile(path.join(runDir, "board.json"), launchBoard);
  await writeJsonFile(path.join(runDir, "trust-policy.json"), trustPolicyFor({ runnerMode, runId }));
  const runtimeState = await loadRuntimeState(runDir);
  return {
    ok: true,
    boardPath: path.join(runDir, "board.json"),
    trustPolicyPath: path.join(runDir, "trust-policy.json"),
    runtimeStatePath: path.join(runDir, "runtime-state.json"),
    runtimeState,
    errors: []
  };
}
