import path from "node:path";
import { createHarnessError } from "./errors.mjs";
import { BOARD_VERIFICATION_PRODUCER, VERIFICATION_PRODUCER, diagnoseVerificationCommandResult, hashCommand } from "./verification-command.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";

function evidencePlanPath(workItem, kind, fallbackPath) {
  const planned = (workItem?.doneEvidence ?? []).find((evidence) => evidence.kind === kind);
  return typeof planned?.path === "string" && planned.path.trim().length > 0
    ? planned.path
    : fallbackPath;
}

function resolveRunPath(runDir, relativePath) {
  if (path.isAbsolute(relativePath)) {
    return null;
  }

  const resolvedRunDir = path.resolve(runDir);
  const resolvedPath = path.resolve(resolvedRunDir, relativePath);
  if (resolvedPath !== resolvedRunDir && !resolvedPath.startsWith(`${resolvedRunDir}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
}

export async function readVerificationEvidence(runDir, { workItem = null } = {}) {
  const relativePath = evidencePlanPath(workItem, "verification", "evidence/verification.json");
  const evidencePath = resolveRunPath(runDir, relativePath);
  if (!evidencePath) {
    return {
      ok: false,
      evidence: null,
      errors: [createHarnessError({
        code: "HARNESS_EVIDENCE_PATH_INVALID",
        reason: `Done verification evidence path must stay inside the run directory: ${relativePath}`,
        evidence: ["work-items"]
      })]
    };
  }

  if (!await fileExists(evidencePath)) {
    return {
      ok: false,
      evidence: null,
      errors: [createHarnessError({
        code: "HARNESS_EVIDENCE_MISSING",
        reason: `Done requires ${relativePath}.`,
        evidence: [relativePath]
      })]
    };
  }

  const evidence = await readJsonFile(evidencePath);
  const commands = Array.isArray(evidence.commands) ? evidence.commands : [];
  const failedCommands = commands.filter((command) => command.exitCode !== 0);
  const commandDiagnostics = commands
    .map((command) => diagnoseVerificationCommandResult({
      command: command.command,
      stdout: command.stdout,
      stderr: command.stderr,
      exitCode: command.exitCode
    }))
    .filter((diagnosis) => !diagnosis.ok);
  const producerInvalid = ![VERIFICATION_PRODUCER, BOARD_VERIFICATION_PRODUCER].includes(evidence.producer);
  const kindInvalid = !["verification", "board-verification"].includes(evidence.kind);
  const workItemInvalid = workItem && evidence.workItemId && evidence.workItemId !== workItem.id;
  const expectedHashes = workItem ? (workItem.verificationCommands ?? []).map(hashCommand) : null;
  const actualHashes = Array.isArray(evidence.commandHashes) ? evidence.commandHashes : [];
  const hashesInvalid = expectedHashes
    ? actualHashes.length !== expectedHashes.length || actualHashes.some((hash, index) => hash !== expectedHashes[index])
    : false;
  if (kindInvalid || evidence.ok !== true || commands.length === 0 || failedCommands.length > 0 || commandDiagnostics.length > 0 || producerInvalid || hashesInvalid || workItemInvalid) {
    const diagnostic = commandDiagnostics[0];
    return {
      ok: false,
      evidence,
      errors: [createHarnessError({
        code: diagnostic?.code ?? "HARNESS_VERIFICATION_FAILED",
        reason: diagnostic?.reason ?? "Done requires passing verification evidence produced by makeitreal-engine for the current work item.",
        evidence: [relativePath]
      })]
    };
  }

  return { ok: true, evidence, errors: [] };
}

export async function readWikiSyncEvidence(runDir, { workItem = null } = {}) {
  const relativePath = evidencePlanPath(workItem, "wiki-sync", "evidence/wiki-sync.json");
  const evidencePath = resolveRunPath(runDir, relativePath);
  if (!evidencePath) {
    return {
      ok: false,
      evidence: null,
      errors: [createHarnessError({
        code: "HARNESS_WIKI_SYNC_PATH_INVALID",
        reason: `Done wiki sync evidence path must stay inside the run directory: ${relativePath}`,
        evidence: ["work-items"]
      })]
    };
  }

  if (!await fileExists(evidencePath)) {
    return {
      ok: false,
      evidence: null,
      errors: [createHarnessError({
        code: "HARNESS_WIKI_SYNC_MISSING",
        reason: `Done requires ${relativePath}.`,
        evidence: [relativePath]
      })]
    };
  }

  const evidence = await readJsonFile(evidencePath);
  const kindInvalid = !["wiki-sync", "board-wiki-sync"].includes(evidence.kind);
  const workItemInvalid = workItem && evidence.workItemId !== workItem.id;
  const skipped = evidence.skipped === true && typeof evidence.reason === "string" && evidence.reason.trim().length > 0;
  if (kindInvalid || !evidence.workItemId || (!skipped && !evidence.outputPath) || workItemInvalid) {
    return {
      ok: false,
      evidence,
      errors: [createHarnessError({
        code: "HARNESS_WIKI_SYNC_INVALID",
        reason: "Done requires valid wiki sync evidence or explicit disabled-wiki skip evidence.",
        evidence: [relativePath]
      })]
    };
  }

  return { ok: true, evidence, errors: [] };
}
