import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG, readProjectConfig, writeProjectConfig } from "../config/project-config.mjs";
import { writeCurrentRunState } from "./run-state.mjs";

const MAKEITREAL_IGNORE_ENTRY = "/.makeitreal/";

function hasMakeItRealIgnore(content) {
  return /(^|\n)\s*\/?\.makeitreal\/\s*(?:#.*)?(?=\n|$)/.test(content);
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function ensureMakeItRealGitIgnore({ projectRoot }) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const gitignorePath = path.join(resolvedProjectRoot, ".gitignore");
  const existing = await readTextIfExists(gitignorePath);
  if (existing !== null && hasMakeItRealIgnore(existing)) {
    return {
      ok: true,
      command: "setup",
      gitignorePath,
      updated: false,
      entry: MAKEITREAL_IGNORE_ENTRY,
      errors: []
    };
  }

  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  const body = existing === null
    ? `# Make It Real runtime state\n${MAKEITREAL_IGNORE_ENTRY}\n`
    : `${existing}${prefix}\n# Make It Real runtime state\n${MAKEITREAL_IGNORE_ENTRY}\n`;
  await writeFile(gitignorePath, body);
  return {
    ok: true,
    command: "setup",
    gitignorePath,
    updated: true,
    entry: MAKEITREAL_IGNORE_ENTRY,
    errors: []
  };
}

async function ensureProjectConfig({ projectRoot }) {
  const current = await readProjectConfig({ projectRoot });
  if (!current.ok || current.source === "project") {
    return { ...current, created: false };
  }
  const written = await writeProjectConfig({ projectRoot, config: DEFAULT_CONFIG });
  return { ...written, created: written.ok };
}

export async function initializeProject({ projectRoot, runDir = null, source = "makeitreal:setup", now = new Date() }) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  await mkdir(path.join(resolvedProjectRoot, ".makeitreal"), { recursive: true });

  const gitignore = await ensureMakeItRealGitIgnore({ projectRoot: resolvedProjectRoot });
  const config = await ensureProjectConfig({ projectRoot: resolvedProjectRoot });
  const currentRun = runDir
    ? await writeCurrentRunState({
        projectRoot: resolvedProjectRoot,
        runDir,
        source,
        now
      })
    : null;
  const errors = [
    ...(gitignore.errors ?? []),
    ...(config.errors ?? []),
    ...(currentRun?.errors ?? [])
  ];
  const ok = gitignore.ok && config.ok && (currentRun?.ok ?? true);

  return {
    ok,
    command: "setup",
    projectRoot: resolvedProjectRoot,
    runDir: currentRun?.runDir ?? null,
    statePath: currentRun?.statePath ?? path.join(resolvedProjectRoot, ".makeitreal", "current-run.json"),
    currentRun,
    currentRunUpdated: currentRun?.ok ?? false,
    config,
    gitignore,
    nextAction: currentRun?.ok ? "/makeitreal:status" : "/makeitreal:plan <request>",
    errors
  };
}
