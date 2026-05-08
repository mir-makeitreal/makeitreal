import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendBoardEvent } from "../board/board-store.mjs";
import { validateChangedPaths } from "../board/responsibility-boundaries.mjs";
import { resolveBlueprintRunDir, validateBoardBlueprintApproval } from "../blueprint/review.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { FAILURE_EVENTS, classifyRunnerFailure, normalizeRuntimeEvent } from "../domain/runtime-events.mjs";
import { fileExists, listJsonFiles, readJsonFile, writeJsonFile } from "../io/json.mjs";
import { createRunAttempt, updateRunAttempt } from "./attempt-store.mjs";
import { resolveProjectRootForRun, resolveWorkspace, validateWorkspaceCwd } from "./workspace-manager.mjs";

const SUCCESS_EVENTS = new Set(["turn_completed"]);
const REQUIRED_CLAUDE_TOOL_ALLOWLIST = new Set(["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS"]);
const PROMPT_PLACEHOLDERS = new Set(["${prompt}", "${promptPath}", "${handoffPath}"]);

function hasArgPair(args, flag, value) {
  return args.some((arg, index) => arg === flag && args[index + 1] === value)
    || args.includes(`${flag}=${value}`);
}

function hasPromptReference(args) {
  return args.some((arg) => PROMPT_PLACEHOLDERS.has(arg));
}

function hasCliOptionSeparatorBeforePrompt(args) {
  const promptIndex = args.findIndex((arg) => ["${prompt}", "${promptPath}", "${handoffPath}"].includes(arg));
  const separatorIndex = args.indexOf("--");
  if (promptIndex === -1 || separatorIndex === -1 || separatorIndex > promptIndex) {
    return false;
  }

  return args.some((arg, index) => {
    if (arg === "--add-dir" && args[index + 1] === "${workspace}") {
      return separatorIndex > index + 1;
    }
    return arg === "--add-dir=${workspace}" && separatorIndex > index;
  });
}

function invalidCommand(reason) {
  return {
    ok: false,
    command: null,
    errors: [createHarnessError({
      code: "HARNESS_RUNNER_COMMAND_INVALID",
      reason,
      evidence: ["runnerCommand.args"],
      recoverable: true
    })]
  };
}

function parseOptionValue({ args, index, flag }) {
  const arg = args[index];
  if (arg === flag) {
    return { value: args[index + 1], consumed: 2 };
  }
  if (arg.startsWith(`${flag}=`)) {
    return { value: arg.slice(flag.length + 1), consumed: 1 };
  }
  return null;
}

function validateAllowedTools(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  const tools = value.split(",").map((item) => item.trim()).filter(Boolean);
  return tools.length > 0 && tools.every((tool) => REQUIRED_CLAUDE_TOOL_ALLOWLIST.has(tool));
}

function parseClaudeRunnerArgs(args) {
  const separators = args.filter((arg) => arg === "--");
  if (separators.length !== 1) {
    return invalidCommand("Claude Code runner command must include exactly one -- separator before the prompt.");
  }

  const separatorIndex = args.indexOf("--");
  const postSeparator = args.slice(separatorIndex + 1);
  if (postSeparator.length !== 1 || !PROMPT_PLACEHOLDERS.has(postSeparator[0])) {
    return invalidCommand("Claude Code runner command must pass exactly one prompt/handoff placeholder after --.");
  }

  const seen = new Map();
  const values = {};
  const preSeparator = args.slice(0, separatorIndex);
  for (let index = 0; index < preSeparator.length;) {
    const arg = preSeparator[index];
    if (arg === "--print") {
      seen.set("--print", (seen.get("--print") ?? 0) + 1);
      index += 1;
      continue;
    }

    const option = ["--output-format", "--permission-mode", "--allowedTools", "--add-dir"]
      .map((flag) => ({ flag, parsed: parseOptionValue({ args: preSeparator, index, flag }) }))
      .find(({ parsed }) => parsed);
    if (!option) {
      return invalidCommand(`Claude Code runner command includes unsupported argument: ${arg}.`);
    }
    if (seen.has(option.flag)) {
      return invalidCommand(`Claude Code runner command cannot include ${option.flag} more than once.`);
    }
    if (option.parsed.consumed === 2 && typeof option.parsed.value !== "string") {
      return invalidCommand(`Claude Code runner command requires a value after ${option.flag}.`);
    }
    seen.set(option.flag, 1);
    values[option.flag] = option.parsed.value;
    index += option.parsed.consumed;
  }

  if (
    seen.get("--print") !== 1
    || values["--output-format"] !== "json"
    || values["--permission-mode"] !== "dontAsk"
    || values["--add-dir"] !== "${workspace}"
    || !validateAllowedTools(values["--allowedTools"])
    || !hasCliOptionSeparatorBeforePrompt(args)
    || !hasPromptReference(args)
  ) {
    return invalidCommand("Claude Code runner requires --print, --output-format json, --permission-mode dontAsk, conservative --allowedTools, --add-dir ${workspace}, -- before the prompt, and a prompt/handoff placeholder.");
  }

  return {
    ok: true,
    command: {
      file: "claude",
      args: [
        "--print",
        "--output-format",
        "json",
        "--permission-mode",
        "dontAsk",
        "--allowedTools",
        values["--allowedTools"],
        "--add-dir",
        "${workspace}",
        "--",
        postSeparator[0]
      ]
    },
    errors: []
  };
}

export function validateClaudeRunnerCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return {
      ok: false,
      command: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_COMMAND_REQUIRED",
        reason: "Claude Code runner requires a structured runner command.",
        evidence: ["runnerCommand"],
        recoverable: true
      })]
    };
  }

  if (typeof command.file !== "string" || command.file.trim().length === 0) {
    return {
      ok: false,
      command: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_COMMAND_INVALID",
        reason: "Runner command file must be a non-empty string.",
        evidence: ["runnerCommand.file"],
        recoverable: true
      })]
    };
  }

  if (command.file !== "claude") {
    return {
      ok: false,
      command: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_COMMAND_INVALID",
        reason: "Claude Code runner command file must be exactly claude; executable paths are not accepted.",
        evidence: ["runnerCommand.file"],
        recoverable: true
      })]
    };
  }

  const args = command.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return {
      ok: false,
      command: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_COMMAND_INVALID",
        reason: "Runner command args must be an array of strings.",
        evidence: ["runnerCommand.args"],
        recoverable: true
      })]
    };
  }

  if (args.includes("--dangerously-skip-permissions") || args.includes("--allow-dangerously-skip-permissions")) {
    return {
      ok: false,
      command: null,
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_COMMAND_INVALID",
        reason: "Claude Code runner cannot bypass permissions.",
        evidence: ["runnerCommand.args"],
        recoverable: true
      })]
    };
  }

  return parseClaudeRunnerArgs(args);
}

function renderPrompt({ board, workItem, dependencyArtifacts = [] }) {
  return `# Make It Real Work Item

Board: ${board.boardId}
Work item: ${workItem.id}
Title: ${workItem.title ?? "(untitled)"}
Responsibility unit: ${workItem.responsibilityUnitId}

## Required Contract

Complete the work item described by the staged source artifacts.
- Read .makeitreal/source/prd.json, .makeitreal/source/design-pack.json, and .makeitreal/source/work-item.json before editing.
- Own only the declared responsibility boundary.
- Do not edit outside allowedPaths.
- Existing allowed-path project files have been staged into this workspace; edit those workspace files.
- On success, Make It Real applies changed allowed-path files back to the real project and verifies there.
- Use only declared contractIds for cross-boundary behavior.
- Do not add fallback behavior for undeclared SDK/API states.
- Fail fast and report the root cause if the happy path cannot be implemented.
- Leave verification evidence to the Make It Real engine.

## allowedPaths
${(workItem.allowedPaths ?? []).map((item) => `- ${item}`).join("\n")}

## contractIds
${(workItem.contractIds ?? []).map((item) => `- ${item}`).join("\n")}

## dependencyArtifacts
${dependencyArtifacts.length > 0 ? dependencyArtifacts.map((artifact) => `- ${artifact.path} from ${artifact.fromWorkItemId}`).join("\n") : "- none"}

## Source Artifacts
- .makeitreal/source/prd.json
- .makeitreal/source/design-pack.json
- .makeitreal/source/work-item.json
- .makeitreal/handoff.json
`;
}

function resolveArg(arg, replacements) {
  return arg
    .replaceAll("${workspace}", replacements.workspace)
    .replaceAll("${handoffPath}", replacements.handoffPath)
    .replaceAll("${promptPath}", replacements.promptPath)
    .replaceAll("${prompt}", replacements.prompt)
    .replaceAll("${workItemId}", replacements.workItemId);
}

function truncate(value) {
  return String(value ?? "").slice(0, 8000);
}

function matchesPattern(pattern, candidate) {
  if (pattern.endsWith("/**")) {
    return candidate.startsWith(pattern.slice(0, -3));
  }
  return pattern === candidate;
}

function safeJoin(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

function isImmutableEngineMetadata(relative) {
  return relative === ".makeitreal" || relative.startsWith(".makeitreal/");
}

function isRunnerSessionMetadata(relative) {
  return relative === ".omc/sessions" || relative.startsWith(".omc/sessions/");
}

async function collectWorkspaceFiles(root, current = root, files = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(root, fullPath).split(path.sep).join("/");
    if (entry.isDirectory()) {
      await collectWorkspaceFiles(root, fullPath, files);
    } else if (entry.isFile()) {
      files.push({ relative, fullPath });
    }
  }
  return files;
}

async function listProjectFilesForAllowedPattern({ projectRoot, pattern }) {
  const relativeRoot = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  const sourcePath = safeJoin(projectRoot, relativeRoot);
  if (!sourcePath) {
    return [];
  }

  let sourceStat = null;
  try {
    sourceStat = await stat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  if (sourceStat.isFile()) {
    return [path.relative(projectRoot, sourcePath).split(path.sep).join("/")];
  }
  if (!sourceStat.isDirectory() || !pattern.endsWith("/**")) {
    return [];
  }

  return (await collectWorkspaceFiles(projectRoot, sourcePath))
    .map((file) => file.relative)
    .filter((relative) => matchesPattern(pattern, relative));
}

async function stageAllowedProjectFiles({ projectRoot, workspace, workItem }) {
  if (!projectRoot) {
    return { projectRoot: null, stagedPaths: [] };
  }

  const stagedPaths = [];
  const seen = new Set();
  for (const pattern of workItem.allowedPaths ?? []) {
    for (const relative of await listProjectFilesForAllowedPattern({ projectRoot, pattern })) {
      if (seen.has(relative)) {
        continue;
      }
      seen.add(relative);
      const source = safeJoin(projectRoot, relative);
      const target = safeJoin(workspace, relative);
      if (!source || !target) {
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
      stagedPaths.push(relative);
    }
  }

  return { projectRoot, stagedPaths };
}

async function applyWorkspaceChangesToProject({ projectRoot, workspace, changedPaths }) {
  if (!projectRoot) {
    return { ok: true, applied: false, projectRoot: null, appliedPaths: [], errors: [] };
  }

  const appliedPaths = [];
  const errors = [];
  for (const relative of changedPaths) {
    const source = safeJoin(workspace, relative);
    const target = safeJoin(projectRoot, relative);
    if (!source || !target) {
      errors.push(createHarnessError({
        code: "HARNESS_WORKSPACE_APPLY_ESCAPE",
        reason: `Workspace output path escaped project root: ${relative}.`,
        evidence: [relative],
        recoverable: true
      }));
      continue;
    }

    if (await fileExists(source)) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    } else {
      await rm(target, { force: true });
    }
    appliedPaths.push(relative);
  }

  return {
    ok: errors.length === 0,
    applied: true,
    projectRoot,
    appliedPaths,
    errors
  };
}

async function hashFile(filePath) {
  return crypto.createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function runnerExecutableMetadata(file) {
  const resolved = spawnSync("zsh", ["-lc", `command -v ${file}`], {
    encoding: "utf8",
    shell: false,
    env: process.env
  });
  const resolvedPath = resolved.status === 0 ? resolved.stdout.trim() : null;
  const realPath = resolvedPath ? await realpath(resolvedPath).catch(() => null) : null;
  const hash = realPath ? `sha256:${await hashFile(realPath)}` : null;
  return { resolvedPath, realPath, hash };
}

async function snapshotImmutableMetadata(root) {
  const snapshot = {};
  for (const file of await collectWorkspaceFiles(root)) {
    if (isImmutableEngineMetadata(file.relative)) {
      snapshot[file.relative] = await hashFile(file.fullPath);
    }
  }
  return snapshot;
}

async function validateImmutableMetadata({ root, snapshot, workItem }) {
  const current = {};
  for (const file of await collectWorkspaceFiles(root)) {
    if (isImmutableEngineMetadata(file.relative)) {
      current[file.relative] = await hashFile(file.fullPath);
    }
  }

  const errors = [];
  for (const [relative, hash] of Object.entries(snapshot)) {
    if (!Object.hasOwn(current, relative)) {
      errors.push(createHarnessError({
        code: "HARNESS_METADATA_BOUNDARY_VIOLATION",
        reason: `Runner deleted engine-owned metadata: ${relative}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [relative],
        recoverable: true
      }));
    } else if (current[relative] !== hash) {
      errors.push(createHarnessError({
        code: "HARNESS_METADATA_BOUNDARY_VIOLATION",
        reason: `Runner modified engine-owned metadata: ${relative}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [relative],
        recoverable: true
      }));
    }
  }

  for (const relative of Object.keys(current)) {
    if (!Object.hasOwn(snapshot, relative)) {
      errors.push(createHarnessError({
        code: "HARNESS_METADATA_BOUNDARY_VIOLATION",
        reason: `Runner created engine-owned metadata: ${relative}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [relative],
        recoverable: true
      }));
    }
  }

  return { ok: errors.length === 0, errors };
}

async function snapshotMutableWorkspaceFiles(root) {
  const snapshot = {};
  for (const file of await collectWorkspaceFiles(root)) {
    if (isImmutableEngineMetadata(file.relative) || isRunnerSessionMetadata(file.relative)) {
      continue;
    }
    snapshot[file.relative] = await hashFile(file.fullPath);
  }
  return snapshot;
}

async function listChangedWorkspaceFiles(root, baseline) {
  const current = {};
  for (const file of await collectWorkspaceFiles(root)) {
    if (isImmutableEngineMetadata(file.relative) || isRunnerSessionMetadata(file.relative)) {
      continue;
    }
    current[file.relative] = await hashFile(file.fullPath);
  }

  const changed = [];
  for (const [relative, hash] of Object.entries(current)) {
    if (baseline[relative] !== hash) {
      changed.push(relative);
    }
  }
  for (const relative of Object.keys(baseline)) {
    if (!Object.hasOwn(current, relative)) {
      changed.push(relative);
    }
  }
  return [...new Set(changed)].sort();
}

async function listWorkspaceFiles(root, current = root, files = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(root, fullPath).split(path.sep).join("/");
    if (isImmutableEngineMetadata(relative)) {
      continue;
    }
    if (isRunnerSessionMetadata(relative)) {
      continue;
    }
    if (entry.isDirectory()) {
      await listWorkspaceFiles(root, fullPath, files);
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

async function stageDependencyArtifacts({ boardDir, board, workItem, workspace }) {
  const artifacts = [];
  const errors = [];
  for (const dependencyId of workItem.dependsOn ?? []) {
    const dependency = board.workItems.find((candidate) => candidate.id === dependencyId);
    if (!dependency || dependency.lane !== "Done") {
      errors.push(createHarnessError({
        code: "HARNESS_DEPENDENCY_ARTIFACT_MISSING",
        reason: `${workItem.id} depends on incomplete work item ${dependencyId}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["board.json"],
        recoverable: true
      }));
      continue;
    }

    const dependencyWorkspace = resolveWorkspace({ boardDir, workItemId: dependency.id });
    if (!dependencyWorkspace.ok) {
      errors.push(...dependencyWorkspace.errors);
      continue;
    }

    let dependencyFiles = [];
    try {
      dependencyFiles = await collectWorkspaceFiles(dependencyWorkspace.workspace);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      errors.push(createHarnessError({
        code: "HARNESS_DEPENDENCY_ARTIFACT_MISSING",
        reason: `${dependency.id} has no readable completed workspace artifacts.`,
        ownerModule: dependency.responsibilityUnitId ?? null,
        evidence: [`workspaces/${dependency.id}`],
        recoverable: true
      }));
      continue;
    }

    for (const file of dependencyFiles) {
      if (isImmutableEngineMetadata(file.relative) || isRunnerSessionMetadata(file.relative)) {
        continue;
      }
      if (!(dependency.allowedPaths ?? []).some((pattern) => matchesPattern(pattern, file.relative))) {
        continue;
      }
      const target = path.join(workspace, file.relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.fullPath, target);
      artifacts.push({
        fromWorkItemId: dependency.id,
        path: file.relative,
        sourceWorkspace: dependencyWorkspace.workspace
      });
    }
  }

  return { ok: errors.length === 0, artifacts, errors };
}

async function copyJsonIfExists({ from, to }) {
  if (!await fileExists(from)) {
    return null;
  }
  const value = await readJsonFile(from);
  await writeJsonFile(to, value);
  return to;
}

async function stageSourceArtifacts({ boardDir, runDir, board, workItem, handoffDir }) {
  const sourceDir = path.join(handoffDir, "source");
  await mkdir(sourceDir, { recursive: true });
  const staged = [];

  await writeJsonFile(path.join(sourceDir, "board.json"), board);
  staged.push(path.join(sourceDir, "board.json"));
  await writeJsonFile(path.join(sourceDir, "work-item.json"), workItem);
  staged.push(path.join(sourceDir, "work-item.json"));

  for (const filename of ["responsibility-units.json", "trust-policy.json", "prd.json", "design-pack.json", "blueprint-review.json"]) {
    const copied = await copyJsonIfExists({
      from: path.join(runDir, filename),
      to: path.join(sourceDir, filename)
    });
    if (copied) {
      staged.push(copied);
    }
  }

  const contractArtifacts = [];
  for (const contractPath of await listJsonFiles(path.join(runDir, "contracts"))) {
    const value = await readJsonFile(contractPath);
    const targetPath = path.join(sourceDir, "contracts", path.basename(contractPath));
    await writeJsonFile(targetPath, value);
    staged.push(targetPath);
    contractArtifacts.push(targetPath);
  }

  return { sourceDir, staged, contractArtifacts };
}

async function writeHandoff({ boardDir, runDir, board, workItem, workspace, blueprintApproval, now, dependencyArtifacts = [], projectRoot = null, stagedProjectPaths = [] }) {
  const handoffDir = path.join(workspace, ".makeitreal");
  await mkdir(handoffDir, { recursive: true });
  const responsibilityUnits = await readJsonFile(path.join(runDir, "responsibility-units.json"));
  const source = await stageSourceArtifacts({ boardDir, runDir, board, workItem, handoffDir });
  const handoff = {
    schemaVersion: "1.0",
    runnerMode: "claude-code",
    generatedAt: now.toISOString(),
    boardId: board.boardId,
    boardDir,
    projectRoot,
    workItem,
    responsibilityUnits,
    blueprintReview: {
      status: blueprintApproval.review.status,
      blueprintFingerprint: blueprintApproval.review.blueprintFingerprint,
      reviewedBy: blueprintApproval.review.reviewedBy,
      reviewedAt: blueprintApproval.review.reviewedAt,
      reviewSource: blueprintApproval.review.reviewSource
    },
    dependencyArtifacts,
    stagedProjectPaths,
    contractArtifacts: source.contractArtifacts,
    sourceDir: source.sourceDir,
    sourceArtifacts: source.staged,
    rules: [
      "PRD and blueprint artifacts are the source of truth.",
      "Do not edit outside allowedPaths.",
      "Exactly one responsibility unit owns this work item.",
      "Use only declared contractIds across responsibility boundaries.",
      "Do not introduce undeclared fallback behavior.",
      "Fast-fail and surface root cause when the contract cannot be satisfied."
    ]
  };
  const handoffPath = path.join(handoffDir, "handoff.json");
  const promptPath = path.join(handoffDir, "prompt.md");
  const prompt = renderPrompt({ board, workItem, dependencyArtifacts });
  await writeJsonFile(handoffPath, handoff);
  await writeFile(promptPath, prompt, "utf8");
  return { handoffPath, promptPath, prompt };
}

function jsonRecords(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

function eventNameFromRecord(record) {
  if (record && typeof record === "object" && typeof record.event === "string") {
    return record.event;
  }
  if (record && typeof record === "object" && record.type === "result") {
    if (record.is_error === true || record.api_error_status) {
      return "turn_failed";
    }
    if (record.subtype === "success") {
      return "turn_completed";
    }
    if (typeof record.subtype === "string" && record.subtype.length > 0) {
      return "turn_failed";
    }
  }
  return null;
}

function parseRunnerEvents({ stdout, now, workItem, workerId, attemptId }) {
  let records;
  try {
    records = jsonRecords(stdout);
  } catch {
    return {
      ok: false,
      events: ["malformed"],
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_OUTPUT_INVALID",
        reason: "Claude Code runner stdout must be JSON or JSONL runtime output.",
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["runner.stdout"],
        recoverable: true
      })]
    };
  }

  if (records.length === 0) {
    return {
      ok: false,
      events: ["malformed"],
      errors: [createHarnessError({
        code: "HARNESS_RUNNER_OUTPUT_INVALID",
        reason: "Claude Code runner produced no structured runtime output.",
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["runner.stdout"],
        recoverable: true
      })]
    };
  }

  const events = [];
  const errors = [];
  for (const record of records) {
    const eventName = eventNameFromRecord(record);
    if (!eventName) {
      errors.push(createHarnessError({
        code: "HARNESS_RUNNER_OUTPUT_INVALID",
        reason: "Claude Code runner output did not include a runtime event.",
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["runner.stdout"],
        recoverable: true
      }));
      events.push("malformed");
      continue;
    }
    const normalized = normalizeRuntimeEvent({
      event: eventName,
      timestamp: now.toISOString(),
      workItemId: workItem.id,
      workerId,
      attemptId,
      payload: record.payload ?? record
    });
    if (!normalized.ok) {
      errors.push(...normalized.errors);
      events.push("malformed");
    } else {
      events.push(normalized.event.event);
    }
  }

  return { ok: errors.length === 0, events, errors };
}

export async function runClaudeCodeAttempt({ boardDir, board, workItem, workerId, runnerCommand, now, cwd }) {
  const normalized = validateClaudeRunnerCommand(runnerCommand);
  if (!normalized.ok) {
    return { ok: false, attemptId: null, workspace: null, events: [], errors: normalized.errors };
  }

  const workspace = resolveWorkspace({ boardDir, workItemId: workItem.id });
  if (!workspace.ok) {
    return { ok: false, attemptId: null, workspace: null, events: [], errors: workspace.errors };
  }
  const cwdResult = validateWorkspaceCwd({ workspace: workspace.workspace, cwd });
  if (!cwdResult.ok) {
    return { ok: false, attemptId: null, workspace: null, events: [], errors: cwdResult.errors };
  }

  const resolvedRun = await resolveBlueprintRunDir({ boardDir });
  if (!resolvedRun.ok) {
    return { ok: false, attemptId: null, workspace: workspace.workspace, events: [], errors: resolvedRun.errors };
  }
  const blueprintApproval = await validateBoardBlueprintApproval({ boardDir });
  if (!blueprintApproval.ok) {
    return { ok: false, attemptId: null, workspace: workspace.workspace, events: [], errors: blueprintApproval.errors };
  }
  await mkdir(workspace.workspace, { recursive: true });

  const projectRoot = resolveProjectRootForRun({ runDir: boardDir });
  const stagedProject = await stageAllowedProjectFiles({
    projectRoot,
    workspace: workspace.workspace,
    workItem
  });
  const dependencies = await stageDependencyArtifacts({ boardDir, board, workItem, workspace: workspace.workspace });
  if (!dependencies.ok) {
    return { ok: false, attemptId: null, workspace: workspace.workspace, events: [], errors: dependencies.errors };
  }
  const handoff = await writeHandoff({
    boardDir,
    runDir: resolvedRun.runDir,
    board,
    workItem,
    workspace: workspace.workspace,
    blueprintApproval,
    now,
    dependencyArtifacts: dependencies.artifacts,
    projectRoot,
    stagedProjectPaths: stagedProject.stagedPaths
  });
  const immutableMetadataSnapshot = await snapshotImmutableMetadata(workspace.workspace);
  const mutableWorkspaceSnapshot = await snapshotMutableWorkspaceFiles(workspace.workspace);
  const attempt = await createRunAttempt({ boardDir, workItem, workerId, now });
  const replacements = {
    workspace: workspace.workspace,
    handoffPath: handoff.handoffPath,
    promptPath: handoff.promptPath,
    prompt: handoff.prompt,
    workItemId: workItem.id
  };
  const command = {
    file: normalized.command.file,
    args: normalized.command.args.map((arg) => resolveArg(arg, replacements))
  };
  const executable = await runnerExecutableMetadata(command.file);

  const events = ["session_started"];
  await appendBoardEvent(boardDir, {
    event: "session_started",
    timestamp: now.toISOString(),
    workItemId: workItem.id,
    workerId,
    attemptId: attempt.attemptId,
    payload: { runnerMode: "claude-code", handoffPath: handoff.handoffPath }
  });

  const result = spawnSync(command.file, command.args, {
    cwd: workspace.workspace,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      MAKEITREAL_BOARD_DIR: boardDir,
      MAKEITREAL_WORKSPACE: workspace.workspace,
      MAKEITREAL_HANDOFF_PATH: handoff.handoffPath,
      MAKEITREAL_PROMPT_PATH: handoff.promptPath,
      MAKEITREAL_WORK_ITEM_ID: workItem.id,
      MAKEITREAL_RESPONSIBILITY_UNIT_ID: workItem.responsibilityUnitId ?? ""
    }
  });

  const failedToStart = result.error instanceof Error;
  const parsed = failedToStart || result.status !== 0
    ? { ok: result.status === 0 && !failedToStart, events: [failedToStart ? "startup_failed" : "turn_failed"], errors: [] }
    : parseRunnerEvents({ stdout: result.stdout, now, workItem, workerId, attemptId: attempt.attemptId });

  const parsedEvents = parsed.events.length > 0 ? parsed.events : ["malformed"];
  events.push(...parsedEvents);
  for (const event of parsedEvents) {
    await appendBoardEvent(boardDir, {
      event,
      timestamp: now.toISOString(),
      workItemId: workItem.id,
      workerId,
      attemptId: attempt.attemptId,
      payload: {
        exitCode: result.status,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
        error: result.error instanceof Error ? result.error.message : null
      }
    });
  }

  const hasSuccess = parsedEvents.some((event) => SUCCESS_EVENTS.has(event));
  const hasFailure = parsedEvents.some((event) => FAILURE_EVENTS.has(event));
  const changedPaths = await listChangedWorkspaceFiles(workspace.workspace, mutableWorkspaceSnapshot);
  const boundary = validateChangedPaths({ workItem, changedPaths });
  const metadataBoundary = await validateImmutableMetadata({
    root: workspace.workspace,
    snapshot: immutableMetadataSnapshot,
    workItem
  });
  const runnerOk = !failedToStart && result.status === 0 && parsed.ok && hasSuccess && !hasFailure && boundary.ok && metadataBoundary.ok;
  const applyResult = runnerOk
    ? await applyWorkspaceChangesToProject({ projectRoot, workspace: workspace.workspace, changedPaths })
    : { ok: true, applied: false, projectRoot, appliedPaths: [], errors: [] };
  const ok = runnerOk && applyResult.ok;
  const outputErrors = [...(parsed.errors ?? []), ...metadataBoundary.errors, ...boundary.errors, ...applyResult.errors];
  const failure = ok ? null : classifyRunnerFailure({
    failedToStart,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    events: parsedEvents,
    errors: outputErrors
  });

  await updateRunAttempt({
    boardDir,
    attemptId: attempt.attemptId,
    patch: {
      status: ok ? "completed" : "failed",
      completedAt: now.toISOString(),
      events,
      runner: {
        mode: "claude-code",
        command,
        executable,
        handoffPath: handoff.handoffPath,
        promptPath: handoff.promptPath,
        projectRoot,
        stagedProjectPaths: stagedProject.stagedPaths,
        changedPaths,
        projectApply: {
          ok: applyResult.ok,
          applied: applyResult.applied,
          appliedPaths: applyResult.appliedPaths
        },
        exitCode: result.status,
        stdout: truncate(result.stdout),
        stderr: truncate(result.stderr),
        failure
      }
    }
  });

  if (ok) {
    return { ok: true, attemptId: attempt.attemptId, workspace: workspace.workspace, events, errors: [] };
  }

  return {
    ok: false,
    attemptId: attempt.attemptId,
    workspace: workspace.workspace,
    events,
    failure,
    errors: outputErrors.length > 0 ? outputErrors : [createHarnessError({
      code: failure.code,
      reason: failure.reason,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: failure.evidence?.length > 0 ? failure.evidence : [handoff.handoffPath],
      recoverable: true
    })]
  };
}
