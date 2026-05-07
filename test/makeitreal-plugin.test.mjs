import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "makeitreal");

async function readPluginFile(...parts) {
  return readFile(path.join(pluginRoot, ...parts), "utf8");
}

test("Make It Real plugin exposes only the intended workflow skills", async () => {
  const manifest = JSON.parse(await readPluginFile(".codex-plugin", "plugin.json"));
  const claudeManifest = JSON.parse(await readPluginFile(".claude-plugin", "plugin.json"));
  assert.equal(manifest.name, "makeitreal");
  assert.equal(claudeManifest.name, "makeitreal");
  assert.equal(manifest.repository, "https://github.com/mir-makeitreal/makeitreal");
  assert.equal(manifest.homepage, "https://github.com/mir-makeitreal/makeitreal");
  assert.equal(manifest.author.url, "https://github.com/mir-makeitreal/makeitreal");
  assert.equal(claudeManifest.repository, "https://github.com/mir-makeitreal/makeitreal");
  assert.equal(claudeManifest.homepage, "https://github.com/mir-makeitreal/makeitreal");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(claudeManifest.skills, "./skills/");
  assert.deepEqual(manifest.keywords, [
    "claude-code",
    "engineering-harness",
    "contracts",
    "kanban"
  ]);
  assert.deepEqual(manifest.interface.defaultPrompt, [
    "Use $makeitreal:setup for this project.",
    "Use $makeitreal:plan for this feature.",
    "Use $makeitreal:launch to advance the gated run."
  ]);

  const normalSkills = ["setup", "plan", "launch"];
  const advancedSkills = ["verify", "status", "config"];
  for (const skillName of [...normalSkills, ...advancedSkills]) {
    const skill = await readPluginFile("skills", skillName, "SKILL.md");
    assert.match(skill, new RegExp(`name: ${skillName}`));
  }

  for (const commandName of [...normalSkills, ...advancedSkills]) {
    const command = await readPluginFile("commands", `${commandName}.md`);
    assert.match(command, /description:/);
    assert.match(command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/makeitreal-engine/);
  }

  const planSkill = await readPluginFile("skills", "plan", "SKILL.md");
  assert.match(planSkill, /LLM-classified conversational review/i);
  assert.match(planSkill, /makeitreal:interactive-review:llm/);
  assert.match(planSkill, /--runner claude-code/);
});

test("Make It Real plugin registers user-facing slash commands", async () => {
  const expectedCommands = ["setup", "plan", "launch", "status", "verify", "config"];

  for (const commandName of expectedCommands) {
    const command = await readPluginFile("commands", `${commandName}.md`);
    assert.match(command, /^---\ndescription:/);
    assert.match(command, new RegExp(`makeitreal-engine`), `${commandName} should bridge to the plugin engine`);
    assert.doesNotMatch(command, /board claim|wiki sync/, `${commandName} should not expose manual claim or wiki sync commands`);
  }

  const launchCommand = await readPluginFile("commands", "launch.md");
  assert.match(launchCommand, /orchestrator tick/);
  assert.match(launchCommand, /orchestrator complete/);

  const planCommand = await readPluginFile("commands", "plan.md");
  assert.match(planCommand, /--runner claude-code/);
  assert.match(planCommand, /blueprint approve/);
  assert.match(planCommand, /blueprint reject/);
});

test("Make It Real launch skill keeps low-level engine commands internal", async () => {
  const launchSkill = await readPluginFile("skills", "launch", "SKILL.md");
  assert.match(launchSkill, /Use internal engine commands/);
  assert.match(launchSkill, /Do not convert internal commands/);
  assert.match(launchSkill, /board claim/);
  assert.match(launchSkill, /orchestrator tick/);
});

test("Make It Real skills keep the browser dashboard read-only", async () => {
  const root = new URL("../plugins/makeitreal/skills/", import.meta.url);
  const files = ["setup", "plan", "status", "launch", "verify"];
  for (const name of files) {
    const body = await readFile(new URL(`${name}/SKILL.md`, root), "utf8");
    assert.match(body, /read-only|observability/i, `${name} should describe dashboard as read-only observability`);
    assert.doesNotMatch(body, /dashboard.*button.*(Approve|Launch|Retry)|data-harness-action/i, `${name} must not present mutating dashboard actions`);
  }
});

test("Make It Real Claude plugin registers native hooks through plugin root files", async () => {
  const hooks = JSON.parse(await readPluginFile("hooks", "hooks.json"));
  assert.equal(hooks.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit|Bash");
  assert.match(hooks.hooks.PreToolUse[0].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/makeitreal-engine-hook/);
  assert.equal(hooks.hooks.UserPromptSubmit[0].matcher, "*");
  assert.match(hooks.hooks.UserPromptSubmit[0].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/makeitreal-engine-hook/);
  assert.match(hooks.hooks.Stop[0].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/makeitreal-engine-hook/);

  const cliMode = (await stat(path.join(pluginRoot, "bin", "makeitreal-engine"))).mode;
  const hookMode = (await stat(path.join(pluginRoot, "bin", "makeitreal-engine-hook"))).mode;
  assert.notEqual(cliMode & 0o111, 0);
  assert.notEqual(hookMode & 0o111, 0);
});

test("Make It Real repository exposes a Claude marketplace entry", async () => {
  const marketplace = JSON.parse(await readFile(path.join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(marketplace.name, "makeitreal-tools");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, "makeitreal");
  assert.equal(marketplace.plugins[0].source, "./plugins/makeitreal");
});

test("Make It Real plugin binary delegates to the internal engine", () => {
  const result = spawnSync(path.join(pluginRoot, "bin", "makeitreal-engine"), ["--help"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MAKEITREAL_ENGINE_ROOT: repoRoot
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /makeitreal-engine \(internal\)/);
});

test("Make It Real plugin binary discovers the in-repository engine", () => {
  const result = spawnSync(path.join(pluginRoot, "bin", "makeitreal-engine"), ["--help"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /makeitreal-engine \(internal\)/);
});

test("Make It Real plugin binary is self-contained after installation", () => {
  const result = spawnSync(path.join(pluginRoot, "bin", "makeitreal-engine"), ["--help"], {
    cwd: "/tmp",
    encoding: "utf8",
    env: {
      ...process.env,
      MAKEITREAL_ENGINE_ROOT: ""
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /makeitreal-engine \(internal\)/);
});

test("Make It Real exposes an opt-in real Claude golden-path E2E script", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["e2e:real-claude"], "node scripts/run-real-claude-golden-path.mjs");

  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "run-real-claude-golden-path.mjs"), "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /setup -> plan --runner claude-code/);
  assert.match(result.stdout, /consumes real Claude Code quota/);
});

test("Make It Real exposes opt-in Claude plugin validation", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["plugin:validate"], "node scripts/validate-claude-plugin.mjs");
  assert.equal(pkg.scripts["release:check"], "npm run check && npm run plugin:validate");

  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "validate-claude-plugin.mjs"), "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /claude plugin validate plugins\/makeitreal/);
  assert.match(result.stdout, /does not run real Claude Code tasks/);
});
