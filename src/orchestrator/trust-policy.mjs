import path from "node:path";
import { createHarnessError } from "../domain/errors.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";

export async function loadTrustPolicy(boardDir) {
  const filePath = path.join(boardDir, "trust-policy.json");
  if (!await fileExists(filePath)) {
    return {
      ok: false,
      policy: null,
      errors: [createHarnessError({
        code: "HARNESS_TRUST_POLICY_MISSING",
        reason: "Board orchestration requires trust-policy.json.",
        evidence: ["trust-policy.json"]
      })]
    };
  }

  return { ok: true, policy: await readJsonFile(filePath), errors: [] };
}

export async function validateScriptedRunnerPolicy(boardDir) {
  return validateRunnerPolicy(boardDir, { runnerMode: "scripted-simulator" });
}

export async function validateRunnerPolicy(boardDir, { runnerMode }) {
  const loaded = await loadTrustPolicy(boardDir);
  if (!loaded.ok) {
    return loaded;
  }
  const policy = loaded.policy;
  const errors = [];

  if (runnerMode === "scripted-simulator" && policy.runnerMode !== "scripted-simulator") {
    errors.push(createHarnessError({
      code: "HARNESS_RUNNER_MODE_UNSUPPORTED",
      reason: "This tranche supports only explicit scripted-simulator runner mode.",
      evidence: ["trust-policy.json"]
    }));
  }

  if (runnerMode === "scripted-simulator" && policy.realAgentLaunch !== "disabled") {
    errors.push(createHarnessError({
      code: "HARNESS_TRUST_POLICY_INVALID",
      reason: "Real agent launch must remain disabled until hook/agent integration is implemented.",
      evidence: ["trust-policy.json"]
    }));
  }

  if (runnerMode === "claude-code" && policy.runnerMode !== "claude-code") {
    errors.push(createHarnessError({
      code: "HARNESS_RUNNER_MODE_UNSUPPORTED",
      reason: "Claude Code runner requires trust-policy runnerMode claude-code.",
      evidence: ["trust-policy.json"]
    }));
  }

  if (runnerMode === "claude-code" && policy.realAgentLaunch !== "enabled") {
    errors.push(createHarnessError({
      code: "HARNESS_TRUST_POLICY_INVALID",
      reason: "Claude Code runner requires explicit realAgentLaunch enabled.",
      evidence: ["trust-policy.json"]
    }));
  }

  if (runnerMode === "claude-code" && policy.commandExecution !== "structured-command-only") {
    errors.push(createHarnessError({
      code: "HARNESS_TRUST_POLICY_INVALID",
      reason: "Claude Code runner requires structured-command-only execution.",
      evidence: ["trust-policy.json"]
    }));
  }

  if (!["scripted-simulator", "claude-code"].includes(runnerMode)) {
    errors.push(createHarnessError({
      code: "HARNESS_RUNNER_MODE_UNSUPPORTED",
      reason: `Unsupported runner mode: ${runnerMode}.`,
      evidence: ["runnerMode"]
    }));
  }

  if (policy.userInputRequired !== "fail-fast" || policy.unsupportedToolCall !== "fail-fast") {
    errors.push(createHarnessError({
      code: "HARNESS_TRUST_POLICY_INVALID",
      reason: "User input and unsupported tools must fail fast in the scripted runner tranche.",
      evidence: ["trust-policy.json"]
    }));
  }

  return { ok: errors.length === 0, policy, errors };
}
