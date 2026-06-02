import path from "node:path";
import { projectBoardDag } from "../domain/work-item-dag.mjs";
import { fileExists, writeJsonFile } from "../io/json.mjs";
import { loadRuntimeState } from "../orchestrator/runtime-state.mjs";

// Rule-based generators (acceptanceCriteriaFor, prdGoalsFor, userVisibleBehaviorFor)
// have been removed. Claude Code is now the architect — it produces BlueprintProposal
// JSON that includes all acceptance criteria, goals, and user-visible behavior.
// The engine only validates and saves.

export function trustPolicyFor({ runnerMode, runId }) {
  const policy = {
    schemaVersion: "1.0",
    runnerMode,
    runId: runId ?? null,
    realAgentLaunch: runnerMode === "claude-code" ? "enabled" : "disabled"
  };
  if (runnerMode === "claude-code") {
    policy.commandExecution = "structured-command-only";
    policy.userInputRequired = "fail-fast";
    policy.unsupportedToolCall = "fail-fast";
    policy.approvalPolicy = "never";
    policy.sandbox = "workspace-only";
  }
  return policy;
}

const DEFAULT_NATIVE_ROLE_MAPPING = {
  schemaVersion: "1.0",
  mappings: [
    { evidenceRole: "implementation-worker", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "spec-reviewer", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "quality-reviewer", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "verification-reviewer", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "domain-pm", nativeSubagentType: "general-purpose", mappingSource: "run-declared" },
    { evidenceRole: "integration-evidence-reviewer", nativeSubagentType: "general-purpose", mappingSource: "run-declared" }
  ]
};

export async function materializeLaunchBoard({ runDir, runId, slug, workItems, workItemDag, runnerMode, board, availableLanes }) {
  const lanes = availableLanes ?? board?.availableLanes ?? [];
  const launchBoard = {
    schemaVersion: "1.0",
    boardId: `board.${slug}`,
    blueprintRunDir: ".",
    lanes,
    workItemDAG: projectBoardDag(workItemDag),
    workItems
  };
  await writeJsonFile(path.join(runDir, "board.json"), launchBoard);
  await writeJsonFile(path.join(runDir, "trust-policy.json"), trustPolicyFor({ runnerMode, runId }));
  // Write a default native-role-mapping.json only if the run did not declare one.
  // The LLM can override by emitting its own mapping during the blueprint flow.
  const mappingPath = path.join(runDir, "native-role-mapping.json");
  if (!await fileExists(mappingPath)) {
    await writeJsonFile(mappingPath, DEFAULT_NATIVE_ROLE_MAPPING);
  }
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
