import path from "node:path";
import { projectBoardDag } from "../domain/work-item-dag.mjs";
import { writeJsonFile } from "../io/json.mjs";
import { LANES } from "../kanban/lanes.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";

// Rule-based generators (acceptanceCriteriaFor, prdGoalsFor, userVisibleBehaviorFor)
// have been removed. Claude Code is now the architect — it produces BlueprintProposal
// JSON that includes all acceptance criteria, goals, and user-visible behavior.
// The engine only validates and saves.

export function trustPolicyFor({ runnerMode, runId }) {
  if (runnerMode === "claude-code") {
    return {
      schemaVersion: "1.0",
      runnerMode: "claude-code",
      realAgentLaunch: "enabled",
      approvalPolicy: "never",
      sandbox: "workspace-only",
      commandExecution: "structured-command-only",
      userInputRequired: "fail-fast",
      unsupportedToolCall: "fail-fast",
      source: "makeitreal:plan",
      runId
    };
  }

  return {
    schemaVersion: "1.0",
    runnerMode: "scripted-simulator",
    realAgentLaunch: "disabled",
    approvalPolicy: "never",
    sandbox: "workspace-only",
    commandExecution: "trusted-fixture-only",
    userInputRequired: "fail-fast",
    unsupportedToolCall: "fail-fast",
    source: "makeitreal:plan",
    runId
  };
}

export async function materializeLaunchBoard({ runDir, runId, slug, workItems, workItemDag, runnerMode }) {
  const board = {
    schemaVersion: "1.0",
    boardId: `board.${slug}`,
    blueprintRunDir: ".",
    lanes: LANES,
    workItemDAG: projectBoardDag(workItemDag),
    workItems
  };
  await writeJsonFile(path.join(runDir, "board.json"), board);
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
