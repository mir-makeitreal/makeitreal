#!/usr/bin/env node

import path from "node:path";
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

function bashCommand(input) {
  if (input?.tool_name !== "Bash") {
    return null;
  }
  const command = input.tool_input?.command ?? input.toolInput?.command ?? input.command;
  return typeof command === "string" ? command : null;
}

function bashLooksMutating(command) {
  return /(^|[;&|]\s*)(touch|rm|mv|cp|mkdir|rmdir|tee)\b/.test(command)
    || /(^|[;&|]\s*)git\s+(apply|am|checkout|cherry-pick|clean|commit|merge|rebase|reset|restore|stash|switch)\b/.test(command)
    || /(^|[;&|]\s*)(npm|pnpm|yarn|bun)\s+(add|ci|install|i|remove|update|upgrade)\b/.test(command)
    || /(^|[;&|]\s*)(pip|pip3|uv)\s+(add|install|remove|sync)\b/.test(command)
    || /(^|[;&|]\s*)(sed|perl)\s+[^;&|]*\s-i\b/.test(command)
    || /(^|\s)(?:[A-Za-z0-9._/-]+)?>{1,2}\s*(?!&\d)(?=["']?[A-Za-z0-9._/-])/.test(command)
    || /\b(node|python3?|ruby)\s+-e\b/.test(command) && /\b(writeFile|appendFile|mkdirSync|rmSync|open\s*\()/i.test(command);
}

function splitBashSegments(command) {
  return command
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function stripEnvAssignments(segment) {
  let current = segment.trim();
  const assignment = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+/;
  while (assignment.test(current)) {
    current = current.replace(assignment, "").trim();
  }
  return current;
}

function bashLooksHarnessControl(command) {
  return /\b(?:makeitreal-engine|harness\.mjs)\b[^;&|]*(?:\s|^)(?:setup|status|doctor|plan|blueprint|config|hooks|dashboard|gate|verify|wiki|contracts|board|orchestrator)\b/.test(command);
}

function bashSegmentLooksReadOnly(segment) {
  const normalized = stripEnvAssignments(segment);
  if (!normalized || /(^|\s)>{1,2}\s*(?!&\d)/.test(normalized)) {
    return false;
  }
  return /^(?:pwd|date|whoami|true|false)\b/.test(normalized)
    || /^(?:ls|cat|head|tail|wc|sort|uniq|jq|rg|grep|find|awk)\b/.test(normalized)
    || /^sed\b(?![^;&|]*\s-i\b)/.test(normalized)
    || /^git\s+(?:status|diff|log|show|grep|ls-files|rev-parse|branch|remote)\b/.test(normalized)
    || /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test|lint|check|typecheck|build|release:check|plugin:validate)\b/.test(normalized)
    || /^(?:pytest|go\s+test|cargo\s+test|swift\s+test|mvn\s+test|gradle\s+test)\b/.test(normalized)
    || /^(?:node|python3?|ruby)\s+(?:--test|-m\s+pytest)\b/.test(normalized)
    || /^cd\s+/.test(normalized);
}

function bashLooksReadOnly(command) {
  const segments = splitBashSegments(command);
  return segments.length > 0 && segments.every((segment) => bashSegmentLooksReadOnly(segment));
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
  const changedPaths = collectPaths(input.tool_input ?? input.toolInput ?? input);
  const command = bashCommand(input);
  const harnessControlBash = command ? bashLooksHarnessControl(command) : false;
  const bashRequiresBoundary = command ? !harnessControlBash && (bashLooksMutating(command) || !bashLooksReadOnly(command)) : false;
  const mutatingTool = MUTATING_TOOLS.has(input?.tool_name) || bashRequiresBoundary;

  if (!mutatingTool) {
    return allow("Non-mutating tool request.");
  }

  const projectRoot = input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const explicitRunDir = input.runDir ?? input.makeitreal?.runDir ?? null;
  const runnerContext = runnerContextState(process.env);
  const runnerRunDir = process.env.MAKEITREAL_BOARD_DIR ?? null;
  let workItemId = process.env.MAKEITREAL_WORK_ITEM_ID ?? input.makeitreal?.workItemId ?? null;
  let resolved = null;

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
    const approval = await validateBlueprintApproval({ runDir: resolved.runDir });
    if (!approval.ok) {
      return block(approval.errors);
    }
    const active = await activeExecutionContext({ runDir: resolved.runDir });
    if (!active.active) {
      return allow("Current Make It Real run is not executing.");
    }
    if (active.ambiguous) {
      return block([{
        code: "HARNESS_RUN_CONTEXT_MISSING",
        reason: `Active Make It Real execution has multiple work items; scoped work item context is required: ${active.workItemIds.join(", ")}.`,
        contractId: null,
        ownerModule: null,
        evidence: ["runtime-state.json", "board.json", "MAKEITREAL_WORK_ITEM_ID"],
        recoverable: true
      }]);
    }
    workItemId = active.workItemId;
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

  if (command && bashRequiresBoundary) {
    const bashPaths = collectBashPaths(command);
    if (bashPaths.length === 0) {
      return block([{
        code: "HARNESS_BASH_WRITE_UNSUPPORTED",
        reason: "Mutating Bash commands must expose project-relative file paths for Make It Real boundary validation.",
        contractId: null,
        ownerModule: null,
        evidence: ["Bash.command"],
        recoverable: true
      }]);
    }
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
