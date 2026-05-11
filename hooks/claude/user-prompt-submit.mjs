#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { applyInteractiveBlueprintApproval } from "../../src/blueprint/interactive-approval.mjs";

async function readHookInput() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
  }
  return raw.trim() ? JSON.parse(raw) : {};
}

async function readLastAssistantMessage(transcriptPath) {
  if (!transcriptPath) {
    return "";
  }
  try {
    const lines = (await readFile(transcriptPath, "utf8")).trim().split(/\n+/).reverse();
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const entry = JSON.parse(line);
      if (entry?.message?.role !== "assistant") {
        continue;
      }
      const content = entry.message.content;
      if (!Array.isArray(content)) {
        return typeof content === "string" ? content : "";
      }
      return content
        .filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n");
    }
  } catch {
    return "";
  }
  return "";
}

async function main() {
  const input = await readHookInput();
  const approvalContext = input.last_assistant_message ?? await readLastAssistantMessage(input.transcript_path);
  return applyInteractiveBlueprintApproval({
    projectRoot: input.repoRoot ?? input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    runDir: input.runDir ?? input.makeitreal?.runDir ?? null,
    prompt: input.prompt ?? input.user_prompt ?? "",
    approvalContext,
    sessionId: input.session_id ?? null,
    env: process.env
  });
}

main().then((result) => {
  console.log(JSON.stringify(result));
}).catch((error) => {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: error instanceof Error ? error.message : String(error)
    },
    makeitreal: {
      action: "hook-error",
      errors: [{
        code: "HARNESS_HOOK_UNCAUGHT_ERROR",
        reason: error instanceof Error ? error.message : String(error)
      }]
    }
  }));
  process.exitCode = 1;
});
