import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createHarnessError } from "../domain/errors.mjs";
import { writeJsonFile } from "../io/json.mjs";

function packetError(code, reason, evidence = ["agent-packets"]) {
  return createHarnessError({ code, reason, evidence, recoverable: true });
}

function normalizedPath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function underLegacyWorkspace(candidate) {
  const normalized = normalizedPath(candidate);
  return normalized.includes("/.makeitreal/runs/") && normalized.includes("/workspaces/");
}

export function validateNativePacket(packet) {
  const errors = [];
  for (const key of ["runDir", "projectRoot", "expectedCwd", "workItemId", "attemptId", "evidenceRole"]) {
    if (!packet?.[key]) {
      errors.push(packetError("HARNESS_NATIVE_PACKET_INVALID", `Native packet requires ${key}.`));
    }
  }
  if (!packet?.hookContext?.runDir || !packet?.hookContext?.workItemId) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_SCOPE_MISSING", "Native packet requires hookContext.runDir and hookContext.workItemId."));
  }
  if (underLegacyWorkspace(packet?.expectedCwd)) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_WORKSPACE_INVALID", "Native packet expectedCwd must be the project root, not a legacy workspace."));
  }
  if (!Array.isArray(packet?.scope?.allowedPaths) || packet.scope.allowedPaths.length === 0) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_SCOPE_MISSING", "Native packet requires non-empty scope.allowedPaths."));
  }
  if (!Array.isArray(packet?.verificationCommands) || packet.verificationCommands.length === 0) {
    errors.push(packetError("HARNESS_NATIVE_PACKET_VERIFICATION_MISSING", "Native packet requires verificationCommands."));
  }
  return { ok: errors.length === 0, errors };
}

export async function writeNativePacket({ runDir, packet }) {
  const validation = validateNativePacket(packet);
  if (!validation.ok) {
    return { ok: false, packetPath: null, errors: validation.errors };
  }
  const packetDir = path.join(runDir, "agent-packets");
  await mkdir(packetDir, { recursive: true });
  const packetPath = path.join(packetDir, `${packet.workItemId}.${packet.attemptId}.${packet.evidenceRole}.json`);
  await writeJsonFile(packetPath, packet);
  return { ok: true, packetPath, errors: [] };
}
