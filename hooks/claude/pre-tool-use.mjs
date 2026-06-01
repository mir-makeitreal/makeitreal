#!/usr/bin/env node

import path from "node:path";
import os from "node:os";
import { validateRunChangedPaths } from "../../src/adapters/path-boundary.mjs";
import { validateBlueprintApproval } from "../../src/blueprint/review.mjs";
import { fileExists, readJsonFile } from "../../src/io/json.mjs";
import { resolveCurrentRunDir } from "../../src/project/run-state.mjs";

const MUTATING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const RUNNER_CONTEXT_KEYS = [
  "MAKEITREAL_BOARD_DIR",
  "MAKEITREAL_WORK_ITEM_ID",
  "MAKEITREAL_WORKSPACE",
  "MAKEITREAL_HANDOFF_PATH",
  "MAKEITREAL_PROMPT_PATH",
  "MAKEITREAL_RESPONSIBILITY_UNIT_ID"
];
const ACTIVE_EXECUTION_LANES = new Set(["Claimed", "Running", "Verifying", "Human Review"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);

async function readHookInput() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

function collectPaths(value, paths = []) {
  if (!value || typeof value !== "object") {
    return paths;
  }

  for (const [key, nested] of Object.entries(value)) {
    if ((key === "file_path" || key === "path") && typeof nested === "string") {
      paths.push(nested);
    } else if (Array.isArray(nested)) {
      for (const item of nested) {
        collectPaths(item, paths);
      }
    } else if (nested && typeof nested === "object") {
      collectPaths(nested, paths);
    }
  }

  return paths;
}

function expandHomePath(candidate) {
  const value = String(candidate ?? "");
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function pathTargetsProject({ projectRoot, candidate }) {
  const value = expandHomePath(candidate);
  if (!value) {
    return false;
  }
  if (!path.isAbsolute(value)) {
    return true;
  }

  const root = path.resolve(projectRoot);
  const resolved = path.resolve(value);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function hasProjectTarget({ projectRoot, paths }) {
  return paths.some((candidate) => pathTargetsProject({ projectRoot, candidate }));
}

function matchesPattern(pattern, candidate) {
  const normalizedPattern = String(pattern ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedCandidate = String(candidate ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalizedPattern.endsWith("/**")) {
    const base = normalizedPattern.slice(0, -3);
    return normalizedCandidate === base || normalizedCandidate.startsWith(`${base}/`);
  }
  return normalizedPattern === normalizedCandidate;
}

function toProjectRelativePath({ candidate, projectRoot, runDir }) {
  const value = expandHomePath(candidate);
  if (!value) {
    return value;
  }
  if (!path.isAbsolute(value)) {
    return value.replaceAll("\\", "/").replace(/^\.\//, "");
  }

  const roots = [projectRoot, runDir].filter(Boolean).map((root) => path.resolve(root));
  const resolved = path.resolve(value);
  for (const root of roots) {
    const relative = path.relative(root, resolved);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return relative.replaceAll("\\", "/");
    }
  }
  return value.replaceAll("\\", "/");
}

function workItemOwnsEveryPath({ workItem, paths }) {
  return paths.length > 0 && paths.every((candidate) =>
    (workItem.allowedPaths ?? []).some((pattern) => matchesPattern(pattern, candidate))
  );
}

function readScopeViolations({ readScope, paths }) {
  const forbiddenReads = readScope?.forbiddenReads ?? [];
  if (!Array.isArray(forbiddenReads) || forbiddenReads.length === 0) {
    return [];
  }
  return paths.filter((candidate) => forbiddenReads.some((pattern) => matchesPattern(pattern, candidate)));
}

function bashCommand(input) {
  if (input?.tool_name !== "Bash") {
    return null;
  }
  const command = input.tool_input?.command ?? input.toolInput?.command ?? input.command;
  return typeof command === "string" ? command : null;
}

// Plugin-specific check: Make It Real lifecycle commands run our own engine and are
// always permitted regardless of file boundaries — they ARE the orchestration layer.
function bashLooksHarnessControl(command) {
  return /\b(?:makeitreal-engine|harness\.mjs)\b[^;&|]*(?:\s|^)(?:setup|status|doctor|plan|blueprint|config|hooks|dashboard|gate|verify|wiki|contracts|board|orchestrator)\b/.test(command);
}

function collectBashPaths(command) {
  const paths = [];
  const redirection = /(?:^|\s)>{1,2}\s*["']?([A-Za-z0-9._/-]+)["']?/g;
  for (const match of command.matchAll(redirection)) {
    paths.push(match[1]);
  }

  const mutatingCommand = /(?:^|[;&|]\s*)(?:touch|rm|mv|cp|mkdir|rmdir|tee)\s+([^;&|]+)/g;
  for (const match of command.matchAll(mutatingCommand)) {
    for (const token of match[1].split(/\s+/)) {
      const candidate = token.replace(/^["']|["']$/g, "");
      if (candidate && !candidate.startsWith("-") && (candidate.includes("/") || candidate.startsWith("."))) {
        paths.push(candidate);
      }
    }
  }

  const quotedPath = /["']([A-Za-z0-9._/-]+\/[A-Za-z0-9._/-]+)["']/g;
  for (const match of command.matchAll(quotedPath)) {
    paths.push(match[1]);
  }

  return [...new Set(paths)];
}

function allow(reason = "Harness pre-tool gate passed.") {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: reason
    }
  };
}

function block(errors) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: errors.map((error) => `${error.code}: ${error.reason}`).join("\n")
    },
    errors
  };
}

// When a Bash command exposes no project file path to validate,
// just allow it — Claude Code's own permission system handles safety.
// We only enforce path boundaries; we are NOT the Bash safety layer.
function ask(reason) {
  return allow(reason ?? "No project paths detected — allowing.");
}

async function readOptionalJson(filePath) {
  if (!await fileExists(filePath)) {
    return null;
  }
  return readJsonFile(filePath);
}

async function activeExecutionContext({ runDir }) {
  const ids = new Set();
  const runtimeState = await readOptionalJson(path.join(runDir, "runtime-state.json"));
  for (const workItemId of Object.keys(runtimeState?.running ?? {})) {
    ids.add(workItemId);
  }

  const board = await readOptionalJson(path.join(runDir, "board.json"));
  for (const workItem of board?.workItems ?? []) {
    if (ACTIVE_EXECUTION_LANES.has(workItem.lane)) {
      ids.add(workItem.id);
    }
  }

  return {
    active: ids.size > 0,
    workItemId: ids.size === 1 ? [...ids][0] : null,
    ambiguous: ids.size > 1,
    workItemIds: [...ids]
  };
}

async function safeActiveExecutionContext({ runDir }) {
  try {
    return await activeExecutionContext({ runDir });
  } catch {
    return {
      active: false,
      workItemId: null,
      ambiguous: false,
      workItemIds: [],
      stale: true
    };
  }
}

async function inferActiveWorkItemFromPaths({ runDir, workItemIds, changedPaths, projectRoot }) {
  const scopedPaths = [...new Set(changedPaths
    .map((candidate) => toProjectRelativePath({ candidate, projectRoot, runDir }))
    .filter(Boolean))];
  if (scopedPaths.length === 0) {
    return {
      ok: false,
      workItemId: null,
      reason: "No mutating file path is available for active work-item inference.",
      matchedWorkItemIds: []
    };
  }

  const matchedWorkItemIds = [];
  for (const workItemId of workItemIds) {
    const workItem = await readOptionalJson(path.join(runDir, "work-items", `${workItemId}.json`));
    if (workItem && workItemOwnsEveryPath({ workItem, paths: scopedPaths })) {
      matchedWorkItemIds.push(workItemId);
    }
  }

  if (matchedWorkItemIds.length !== 1) {
    return {
      ok: false,
      workItemId: null,
      reason: matchedWorkItemIds.length === 0
        ? `No active work item owns all changed paths: ${scopedPaths.join(", ")}.`
        : `Changed paths match multiple active work items: ${matchedWorkItemIds.join(", ")}.`,
      matchedWorkItemIds
    };
  }

  return { ok: true, workItemId: matchedWorkItemIds[0], reason: null, matchedWorkItemIds };
}

function onlyStaleApprovalErrors(errors = []) {
  return errors.length > 0 && errors.every((error) => [
    "HARNESS_BLUEPRINT_REVIEW_INVALID",
    "HARNESS_BLUEPRINT_APPROVAL_MISSING",
    "HARNESS_BLUEPRINT_APPROVAL_DRIFT",
    "HARNESS_BLUEPRINT_APPROVAL_STALE"
  ].includes(error.code));
}

function runnerContextState(env = process.env) {
  const present = RUNNER_CONTEXT_KEYS.filter((key) => env[key]);
  return {
    present,
    active: present.length > 0,
    complete: Boolean(env.MAKEITREAL_BOARD_DIR && env.MAKEITREAL_WORK_ITEM_ID)
  };
}

async function main() {
  const input = await readHookInput();
  const explicitMakeItReal = input.makeitreal ?? input.tool_input?.makeitreal ?? input.toolInput?.makeitreal ?? null;
  const changedPaths = collectPaths(input.tool_input ?? input.toolInput ?? input);
  const command = bashCommand(input);
  const harnessControlBash = command ? bashLooksHarnessControl(command) : false;
  // For Bash, we never classify the command itself as safe/dangerous — we only look
  // for file paths to check against the module boundary. Claude Code owns the rest.
  const bashPaths = command && !harnessControlBash ? collectBashPaths(command) : [];
  const bashHasPaths = bashPaths.length > 0;
  const bashNeedsDelegation = Boolean(command) && !harnessControlBash && !bashHasPaths;
  const mutatingTool = MUTATING_TOOLS.has(input?.tool_name) || bashHasPaths;
  const readScopedTool = READ_TOOLS.has(input?.tool_name);

  if (explicitMakeItReal?.agentPacket?.readScope && readScopedTool) {
    const violations = readScopeViolations({
      readScope: explicitMakeItReal.agentPacket.readScope,
      paths: changedPaths
    });
    if (violations.length > 0) {
      return block(violations.map((candidate) => ({
        code: "HARNESS_READ_SCOPE_VIOLATION",
        reason: `${candidate} is outside the native packet read scope.`,
        contractId: null,
        ownerModule: explicitMakeItReal.agentPacket.scope?.responsibilityUnitId ?? null,
        evidence: [candidate],
        recoverable: true
      })));
    }
  }

  if (bashNeedsDelegation) {
    return ask("Bash command exposes no project file path to validate; delegating safety classification to Claude Code.");
  }

  if (!mutatingTool) {
    return allow("Non-mutating tool request.");
  }

  const projectRoot = input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const explicitRunDir = explicitMakeItReal?.runDir ?? input.runDir ?? null;
  const runnerContext = runnerContextState(process.env);
  const runnerRunDir = process.env.MAKEITREAL_BOARD_DIR ?? null;
  let workItemId = explicitMakeItReal?.workItemId ?? process.env.MAKEITREAL_WORK_ITEM_ID ?? null;
  let resolved = null;

  const scopedPaths = [...changedPaths, ...bashPaths];
  if (!runnerContext.active && !explicitRunDir && scopedPaths.length > 0 && !hasProjectTarget({ projectRoot, paths: scopedPaths })) {
    return allow("Mutation targets paths outside project root; Make It Real run enforcement skipped.");
  }

  if (runnerContext.active && !runnerContext.complete) {
    return block([{
      code: "HARNESS_RUN_CONTEXT_MISSING",
      reason: `Make It Real runner context is incomplete: ${runnerContext.present.join(", ")}.`,
      contractId: null,
      ownerModule: null,
      evidence: RUNNER_CONTEXT_KEYS,
      recoverable: true
    }]);
  }

  if (runnerContext.complete || explicitRunDir) {
    resolved = await resolveCurrentRunDir({
      projectRoot,
      runDir: runnerRunDir ?? explicitRunDir
    });
  } else {
    resolved = await resolveCurrentRunDir({ projectRoot });
    if (!resolved.ok) {
      return allow("No active Make It Real enforcement context.");
    }
    if (resolved.state?.enforcement === "detached") {
      return allow("Current Make It Real run is detached from hook enforcement.");
    }
    const active = await safeActiveExecutionContext({ runDir: resolved.runDir });
    const approval = await validateBlueprintApproval({ runDir: resolved.runDir });
    if (!approval.ok) {
      if (!active.active && onlyStaleApprovalErrors(approval.errors)) {
        return allow("Current Make It Real run is stale and not executing.");
      }
      return block(approval.errors);
    }
    if (!active.active) {
      return allow("Current Make It Real run is not executing.");
    }
    if (active.ambiguous) {
      const inferred = await inferActiveWorkItemFromPaths({
        runDir: resolved.runDir,
        workItemIds: active.workItemIds,
        changedPaths: scopedPaths,
        projectRoot
      });
      if (!inferred.ok) {
        return block([{
          code: "HARNESS_RUN_CONTEXT_MISSING",
          reason: `Active Make It Real execution has multiple work items; scoped work item context is required. ${inferred.reason}`,
          contractId: null,
          ownerModule: null,
          evidence: ["runtime-state.json", "board.json", "work-items", "MAKEITREAL_WORK_ITEM_ID"],
          recoverable: true
        }]);
      }
      workItemId = inferred.workItemId;
    } else {
      workItemId = active.workItemId;
    }
  }

  if (!resolved.ok) {
    return block([{
      code: "HARNESS_RUN_CONTEXT_MISSING",
      reason: "Active Make It Real run context is required before file edits.",
      contractId: null,
      ownerModule: null,
      evidence: ["CLAUDE_PROJECT_DIR", ".makeitreal/current-run.json"],
      recoverable: true
    }]);
  }

  const approval = await validateBlueprintApproval({ runDir: resolved.runDir });
  if (!approval.ok) {
    return block(approval.errors);
  }

  if (bashHasPaths) {
    changedPaths.push(...bashPaths);
  }

  if (changedPaths.length === 0) {
    return allow("No file path in mutating tool input.");
  }

  const result = await validateRunChangedPaths({
    runDir: resolved.runDir,
    changedPaths,
    repoRoot: projectRoot,
    workItemId
  });
  return result.ok ? allow() : block(result.errors);
}

main().then((result) => {
  console.log(JSON.stringify(result));
}).catch((error) => {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: error instanceof Error ? error.message : String(error)
    },
    errors: [{
      code: "HARNESS_HOOK_UNCAUGHT_ERROR",
      reason: error instanceof Error ? error.message : String(error),
      contractId: null,
      ownerModule: null,
      evidence: ["pre-tool-use"],
      recoverable: false
    }]
  }));
  process.exitCode = 1;
});
