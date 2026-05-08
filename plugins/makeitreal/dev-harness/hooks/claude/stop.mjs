#!/usr/bin/env node

import path from "node:path";
import { runGates } from "../../src/gates/index.mjs";
import { fileExists, readJsonFile } from "../../src/io/json.mjs";
import { resolveCurrentRunDir } from "../../src/project/run-state.mjs";

const ACTIVE_EXECUTION_LANES = new Set(["Running", "Verifying", "Human Review"]);

async function readHookInput() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

function block(errors) {
  return {
    decision: "block",
    reason: errors.map((error) => `${error.code}: ${error.reason}`).join("\n"),
    errors
  };
}

function passThrough() {
  return {
    continue: true,
    suppressOutput: true
  };
}

function approve(reason) {
  return {
    decision: "approve",
    suppressOutput: true,
    reason
  };
}

async function readOptionalJson(filePath) {
  if (!await fileExists(filePath)) {
    return null;
  }
  return readJsonFile(filePath);
}

async function hasActiveExecution({ runDir }) {
  const runtimeState = await readOptionalJson(path.join(runDir, "runtime-state.json"));
  if (Object.keys(runtimeState?.running ?? {}).length > 0) {
    return true;
  }

  const board = await readOptionalJson(path.join(runDir, "board.json"));
  return (board?.workItems ?? []).some((workItem) => ACTIVE_EXECUTION_LANES.has(workItem.lane));
}

async function main() {
  const input = await readHookInput();
  const resolved = await resolveCurrentRunDir({
    projectRoot: input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    runDir: input.runDir ?? input.makeitreal?.runDir ?? null
  });
  if (!resolved.ok) {
    return passThrough();
  }

  if (!await hasActiveExecution({ runDir: resolved.runDir })) {
    return passThrough();
  }

  const result = await runGates({ runDir: resolved.runDir, target: "Done" });
  if (!result.ok) {
    return block(result.errors);
  }

  return approve("Harness Done gate passed.");
}

main().then((result) => {
  console.log(JSON.stringify(result));
}).catch((error) => {
  console.log(JSON.stringify({
    decision: "block",
    reason: error instanceof Error ? error.message : String(error),
    errors: [{
      code: "HARNESS_HOOK_UNCAUGHT_ERROR",
      reason: error instanceof Error ? error.message : String(error),
      contractId: null,
      ownerModule: null,
      evidence: ["stop"],
      recoverable: false
    }]
  }));
  process.exitCode = 1;
});
