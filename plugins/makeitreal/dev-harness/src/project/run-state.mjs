import path from "node:path";
import { fileExists, readJsonFile, writeJsonFile } from "../io/json.mjs";

export function currentRunStatePath(projectRoot) {
  return path.join(projectRoot, ".makeitreal", "current-run.json");
}

function resolveProjectPath(projectRoot, maybePath) {
  if (!maybePath) {
    return null;
  }
  return path.isAbsolute(maybePath) ? path.normalize(maybePath) : path.resolve(projectRoot, maybePath);
}

function relativeToProject(projectRoot, targetPath) {
  const relative = path.relative(projectRoot, targetPath);
  return relative || ".";
}

export async function writeCurrentRunState({
  projectRoot,
  runDir,
  source = "makeitreal:setup",
  now = new Date()
}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedRunDir = resolveProjectPath(resolvedProjectRoot, runDir);
  if (!resolvedRunDir) {
    return {
      ok: false,
      command: "setup",
      statePath: currentRunStatePath(resolvedProjectRoot),
      errors: [{
        code: "HARNESS_RUN_DIR_REQUIRED",
        reason: "setup requires --run <runDir>.",
        contractId: null,
        ownerModule: null,
        evidence: ["argv"],
        recoverable: false
      }]
    };
  }

  const statePath = currentRunStatePath(resolvedProjectRoot);
  const state = {
    schemaVersion: "1.0",
    currentRunDir: relativeToProject(resolvedProjectRoot, resolvedRunDir),
    source,
    updatedAt: now.toISOString()
  };
  await writeJsonFile(statePath, state);

  return {
    ok: true,
    command: "setup",
    projectRoot: resolvedProjectRoot,
    runDir: resolvedRunDir,
    statePath,
    state,
    errors: []
  };
}

export async function readCurrentRunState(projectRoot) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const statePath = currentRunStatePath(resolvedProjectRoot);
  if (!await fileExists(statePath)) {
    return {
      ok: false,
      command: "status",
      projectRoot: resolvedProjectRoot,
      statePath,
      runDir: null,
      state: null,
      errors: [{
        code: "HARNESS_CURRENT_RUN_MISSING",
        reason: "No active Make It Real run state found. Run makeitreal:setup first.",
        contractId: null,
        ownerModule: null,
        evidence: [statePath],
        recoverable: true
      }]
    };
  }

  const state = await readJsonFile(statePath);
  const runDir = resolveProjectPath(resolvedProjectRoot, state.currentRunDir);
  return {
    ok: true,
    command: "status",
    projectRoot: resolvedProjectRoot,
    statePath,
    runDir,
    state,
    errors: []
  };
}

export async function resolveCurrentRunDir({
  projectRoot = process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  runDir = null,
  env = process.env
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const explicitRunDir = runDir ?? env.HARNESS_RUN_DIR ?? env.MAKEITREAL_RUN_DIR ?? null;
  if (explicitRunDir) {
    return {
      ok: true,
      source: "explicit",
      projectRoot: resolvedProjectRoot,
      runDir: resolveProjectPath(resolvedProjectRoot, explicitRunDir),
      errors: []
    };
  }

  const current = await readCurrentRunState(resolvedProjectRoot);
  if (!current.ok) {
    return {
      ok: false,
      source: "missing",
      projectRoot: resolvedProjectRoot,
      runDir: null,
      errors: current.errors
    };
  }

  return {
    ok: true,
    source: "current-run",
    projectRoot: resolvedProjectRoot,
    runDir: current.runDir,
    errors: []
  };
}
