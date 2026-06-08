import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileExists, readJsonFile, writeJsonFile } from "../io/json.mjs";

export function currentRunStatePath(projectRoot) {
  return path.join(projectRoot, ".makeitreal", "current-run.json");
}

export function sessionCurrentRunStatePath(projectRoot, sessionId) {
  // sessionId is the raw string from input.session_id.
  // Callers must validate it before calling this.
  return path.join(projectRoot, ".makeitreal", "current-runs", `${sessionId}.json`);
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

async function writeSessionRunPointer({ projectRoot, sessionId, runDir, source, enforcement, now }) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const dir = path.join(resolvedProjectRoot, ".makeitreal", "current-runs");
  await mkdir(dir, { recursive: true });
  const statePath = sessionCurrentRunStatePath(resolvedProjectRoot, sessionId);
  const state = {
    schemaVersion: "1.0",
    sessionId,
    currentRunDir: relativeToProject(resolvedProjectRoot, runDir),
    enforcement,
    source,
    updatedAt: now.toISOString()
  };
  await writeJsonFile(statePath, state);
  return { statePath, state };
}

export async function writeCurrentRunState({
  projectRoot,
  runDir,
  sessionId = null,
  source = "makeitreal:setup",
  enforcement = "attached",
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
    enforcement,
    source,
    updatedAt: now.toISOString()
  };
  await writeJsonFile(statePath, state);

  // Also write session-scoped pointer when a valid sessionId is provided.
  let sessionStatePath = null;
  if (sessionId && typeof sessionId === "string" && sessionId.trim().length > 0) {
    const sessionResult = await writeSessionRunPointer({
      projectRoot: resolvedProjectRoot,
      sessionId: sessionId.trim(),
      runDir: resolvedRunDir,
      source,
      enforcement,
      now
    });
    sessionStatePath = sessionResult.statePath;
  }

  return {
    ok: true,
    command: "setup",
    projectRoot: resolvedProjectRoot,
    runDir: resolvedRunDir,
    statePath,
    sessionStatePath,
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
        reason: "No active Make It Real run state found. Start with /makeitreal:plan <request>, or use /makeitreal:setup --run <runDir> to select an existing run.",
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

export async function readSessionRunState(projectRoot, sessionId) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    return {
      ok: false,
      source: "session-missing",
      projectRoot: resolvedProjectRoot,
      runDir: null,
      state: null,
      errors: [{
        code: "HARNESS_SESSION_ID_INVALID",
        reason: "sessionId is required.",
        contractId: null,
        ownerModule: null,
        evidence: [],
        recoverable: true
      }]
    };
  }
  const statePath = sessionCurrentRunStatePath(resolvedProjectRoot, sessionId.trim());
  if (!await fileExists(statePath)) {
    return {
      ok: false,
      source: "session-missing",
      projectRoot: resolvedProjectRoot,
      statePath,
      runDir: null,
      state: null,
      errors: [{
        code: "HARNESS_SESSION_RUN_MISSING",
        reason: `No session-scoped run pointer for session ${sessionId}.`,
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
    source: "session-run",
    projectRoot: resolvedProjectRoot,
    statePath,
    runDir,
    state,
    errors: []
  };
}

export async function resolveCurrentRunDir({
  projectRoot = process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd(),
  runDir = null,
  sessionId = null,
  env = process.env
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot?.trim?.() || process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd());
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

  // Try session-scoped pointer first when sessionId is available.
  const cleanSessionId = sessionId && typeof sessionId === "string" ? sessionId.trim() : null;
  if (cleanSessionId) {
    const sessionState = await readSessionRunState(resolvedProjectRoot, cleanSessionId);
    if (sessionState.ok) {
      return {
        ok: true,
        source: "session-run",
        projectRoot: resolvedProjectRoot,
        runDir: sessionState.runDir,
        state: sessionState.state,
        statePath: sessionState.statePath,
        sessionId: cleanSessionId,
        errors: []
      };
    }
    // session file absent → fall through to legacy
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
    state: current.state,
    statePath: current.statePath,
    errors: []
  };
}
