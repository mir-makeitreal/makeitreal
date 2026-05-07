import { spawnSync } from "node:child_process";
import path from "node:path";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { VERIFICATION_PRODUCER, formatVerificationCommand, hashCommand, normalizeVerificationCommand } from "../domain/verification-command.mjs";
import { writeJsonFile } from "../io/json.mjs";

export async function runVerification({ runDir }) {
  const artifacts = await loadRunArtifacts(runDir);
  const workItem = findPrimaryWorkItem(artifacts);
  const commands = [];
  const errors = [];

  if ((workItem.verificationCommands ?? []).length === 0) {
    errors.push(createHarnessError({
      code: "HARNESS_VERIFICATION_COMMANDS_MISSING",
      reason: `Work item has no verification commands: ${workItem.id}`,
      evidence: ["work-items"]
    }));
  }

  for (const command of workItem.verificationCommands ?? []) {
    const normalized = normalizeVerificationCommand(command);
    if (!normalized.ok) {
      errors.push(createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_INVALID",
        reason: normalized.reason,
        evidence: ["work-items"]
      }));
      continue;
    }

    const startedAt = Date.now();
    const result = spawnSync(normalized.command.file, normalized.command.args, {
      cwd: runDir,
      encoding: "utf8",
      shell: false
    });
    const durationMs = Date.now() - startedAt;
    const commandEvidence = {
      command,
      commandHash: hashCommand(command),
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs
    };
    commands.push(commandEvidence);

    if (result.status !== 0) {
      errors.push(createHarnessError({
        code: "HARNESS_VERIFICATION_COMMAND_FAILED",
        reason: `Verification command failed: ${formatVerificationCommand(command)}`,
        evidence: ["evidence/verification.json"]
      }));
    }
  }

  await writeJsonFile(path.join(runDir, "evidence", "verification.json"), {
    producer: VERIFICATION_PRODUCER,
    kind: "verification",
    ok: errors.length === 0 && commands.length > 0,
    workItemId: workItem.id,
    commandHashes: commands.map((command) => command.commandHash),
    commands
  });

  return { ok: errors.length === 0, errors, evidencePath: path.join(runDir, "evidence", "verification.json") };
}
