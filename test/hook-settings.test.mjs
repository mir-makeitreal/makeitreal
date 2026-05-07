import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { installClaudeHooks } from "../src/hooks/claude-settings.mjs";
import { readJsonFile } from "../src/io/json.mjs";

test("installs Claude hook settings into local project settings", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "harness-hook-settings-"));
  try {
    const source = new URL("../hooks", import.meta.url);
    await cp(source, path.join(projectRoot, "dev-harness", "hooks"), { recursive: true });
    const runDir = path.join(projectRoot, "dev-harness", "examples", "canonical", ".makeitreal", "runs", "feature-auth");

    const result = await installClaudeHooks({ projectRoot, runDir, scope: "local" });
    assert.equal(result.ok, true);
    assert.equal(result.settingsPath, path.join(projectRoot, ".claude", "settings.local.json"));

    const settings = await readJsonFile(result.settingsPath);
    assert.equal(settings.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit|Bash");
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /pre-tool-use\.mjs/);
    assert.equal(settings.hooks.UserPromptSubmit[0].matcher, "*");
    assert.match(settings.hooks.UserPromptSubmit[0].hooks[0].command, /user-prompt-submit\.mjs/);
    assert.match(settings.hooks.Stop[0].hooks[0].command, /stop\.mjs/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
