import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installClaudeHooks } from "../src/hooks/claude-settings.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";

test("installs Claude hook settings into local project settings", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "harness-hook-settings-"));
  try {
    const runDir = path.join(projectRoot, "dev-harness", "examples", "canonical", ".makeitreal", "runs", "feature-auth");

    const result = await installClaudeHooks({ projectRoot, runDir, scope: "local" });
    assert.equal(result.ok, true);
    assert.equal(result.settingsPath, path.join(projectRoot, ".claude", "settings.local.json"));

    const settings = await readJsonFile(result.settingsPath);
    assert.equal(settings.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit|Bash");
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /pre-tool-use\.mjs/);
    assert.doesNotMatch(settings.hooks.PreToolUse[0].hooks[0].command, /\$CLAUDE_PROJECT_DIR\/dev-harness\/hooks/);
    assert.equal(settings.hooks.UserPromptSubmit[0].matcher, "*");
    assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /user-prompt-submit\.mjs/);
    assert.match(settings.hooks.Stop[0].hooks[0].command, /stop\.mjs/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("hook installation replaces stale project-relative Make It Real hooks", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "harness-hook-settings-"));
  try {
    const settingsPath = path.join(projectRoot, ".claude", "settings.local.json");
    await writeJsonFile(settingsPath, {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: 'HARNESS_RUN_DIR="$CLAUDE_PROJECT_DIR/.makeitreal/runs/old" node "$CLAUDE_PROJECT_DIR/dev-harness/hooks/claude/stop.mjs"'
              }
            ]
          }
        ]
      }
    });
    const runDir = path.join(projectRoot, ".makeitreal", "runs", "feature-auth");

    const result = await installClaudeHooks({ projectRoot, runDir, scope: "local" });
    assert.equal(result.ok, true);

    const settings = await readJsonFile(settingsPath);
    const stopCommands = settings.hooks.Stop.flatMap((group) => group.hooks.map((hook) => hook.command));
    assert.equal(stopCommands.length, 1);
    assert.match(stopCommands[0], /hooks\/claude\/stop\.mjs/);
    assert.doesNotMatch(stopCommands[0], /\$CLAUDE_PROJECT_DIR\/dev-harness\/hooks/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
