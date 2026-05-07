#!/usr/bin/env node

import { validateRunChangedPaths } from "../../src/adapters/path-boundary.mjs";
import { validateBlueprintApproval } from "../../src/blueprint/review.mjs";
import { resolveCurrentRunDir } from "../../src/project/run-state.mjs";

const MUTATING_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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
    || /(^|[;&|]\s*)(sed|perl)\s+[^;&|]*\s-i\b/.test(command)
    || /(^|[^<])>{1,2}[^>]/.test(command)
    || /\b(node|python3?|ruby)\s+-e\b/.test(command) && /\b(writeFile|appendFile|mkdirSync|rmSync|open\s*\()/i.test(command);
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

async function main() {
  const input = await readHookInput();
  const changedPaths = collectPaths(input.tool_input ?? input.toolInput ?? input);
  const command = bashCommand(input);
  const bashMutating = command ? bashLooksMutating(command) : false;
  const mutatingTool = MUTATING_TOOLS.has(input?.tool_name) || bashMutating;

  if (!mutatingTool) {
    return allow("Non-mutating tool request.");
  }

  const resolved = await resolveCurrentRunDir({
    projectRoot: input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    runDir: input.runDir ?? input.harness?.runDir ?? null
  });
  if (!resolved.ok) {
    return block([{
      code: "HARNESS_RUN_CONTEXT_MISSING",
      reason: "Active Make It Real run context is required before file edits.",
      contractId: null,
      ownerModule: null,
      evidence: ["CLAUDE_PROJECT_DIR", ".harness/current-run.json"],
      recoverable: true
    }]);
  }

  const approval = await validateBlueprintApproval({ runDir: resolved.runDir });
  if (!approval.ok) {
    return block(approval.errors);
  }

  if (command && bashMutating) {
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
    repoRoot: input.repoRoot ?? input.cwd ?? process.cwd()
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
