#!/usr/bin/env node

import { runGates } from "../../src/gates/index.mjs";
import { resolveCurrentRunDir } from "../../src/project/run-state.mjs";

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

async function main() {
  const input = await readHookInput();
  const resolved = await resolveCurrentRunDir({
    projectRoot: input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    runDir: input.runDir ?? input.makeitreal?.runDir ?? null
  });
  if (!resolved.ok) {
    return { decision: "allow", reason: "No active Make It Real run; stop gate skipped." };
  }

  const result = await runGates({ runDir: resolved.runDir, target: "Done" });
  if (!result.ok) {
    return block(result.errors);
  }

  return { decision: "allow", reason: "Harness Done gate passed." };
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
