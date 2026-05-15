import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "makeitreal");
const aliasPluginRoot = path.join(repoRoot, "plugins", "mir");

async function readPluginFile(...parts) {
  return readFile(path.join(pluginRoot, ...parts), "utf8");
}

async function readAliasPluginFile(...parts) {
  return readFile(path.join(aliasPluginRoot, ...parts), "utf8");
}

test("Make It Real plugin exposes only the intended workflow skills", async () => {
  const manifest = JSON.parse(await readPluginFile(".codex-plugin", "plugin.json"));
  const claudeManifest = JSON.parse(await readPluginFile(".claude-plugin", "plugin.json"));
  assert.equal(manifest.name, "makeitreal");
  assert.equal(claudeManifest.name, "makeitreal");
  assert.equal(manifest.version, claudeManifest.version);
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
    "Use $makeitreal:plan for this feature.",
    "Review and approve the Blueprint in chat.",
    "Use $makeitreal:launch to advance the gated run."
  ]);

  const normalSkills = ["setup", "plan", "launch"];
  const advancedSkills = ["verify", "status", "config", "doctor"];
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
  assert.match(planSkill, /Native Claude Code conversational review/i);
  assert.match(planSkill, /makeitreal:interactive-review:native-claude/);
  assert.match(planSkill, /--runner claude-code/);
});

test("Make It Real plugin registers user-facing slash commands", async () => {
  const expectedCommands = ["setup", "plan", "launch", "status", "verify", "config", "doctor"];

  for (const commandName of expectedCommands) {
    const command = await readPluginFile("commands", `${commandName}.md`);
    assert.match(command, /^---\ndescription:/);
    assert.match(command, new RegExp(`makeitreal-engine`), `${commandName} should bridge to the plugin engine`);
    assert.doesNotMatch(command, /board claim|wiki sync/, `${commandName} should not expose manual claim or wiki sync commands`);
  }

  const launchCommand = await readPluginFile("commands", "launch.md");
  assert.match(launchCommand, /allowed-tools: \["Bash", "Read", "Task"\]/);
  assert.match(launchCommand, /orchestrator native start/);
  assert.match(launchCommand, /--concurrency 6/);
  assert.match(launchCommand, /recommendedNativeTaskConcurrency/);
  assert.match(launchCommand, /unblocked responsibility/i);
  assert.match(launchCommand, /orchestrator native finish/);
  assert.match(launchCommand, /nativeTasks\[\]/);
  assert.match(launchCommand, /Claude Code\s+`Task` tool/);
  assert.match(launchCommand, /Verifying` or `Rework/);
  assert.match(launchCommand, /recover `Rework -> Verifying`/);
  assert.match(launchCommand, /orchestrator complete/);
  assert.match(launchCommand, /Do not spawn a separate `claude --print` child process/);
  assert.doesNotMatch(launchCommand, /headless fallback|--runner-command|orchestrator tick --runner claude-code/i);
  assert.match(launchCommand, /one-command start/);
  assert.match(launchCommand, /Do not execute implementation until the\s+Blueprint is approved/);
  assert.match(launchCommand, /evidence roles, not guaranteed installed Claude Code/i);
  assert.match(launchCommand, /Do not pass these labels as `subagent_type` unless\s+Claude Code lists them as available agents/i);
  assert.match(launchCommand, /feature-dev:code-reviewer[\s\S]*spec-reviewer/i);
  assert.match(launchCommand, /oh-my-claudecode:critic[\s\S]*quality-reviewer/i);
  assert.match(launchCommand, /oh-my-claudecode:verifier[\s\S]*verification-reviewer/i);
  assert.match(launchCommand, /HARNESS_NATIVE_ROLE_MAPPING_MISSING/i);
  assert.doesNotMatch(launchCommand, /retry the\s+same reviewer prompt with `general-purpose`/i);
  assert.match(launchCommand, /Do not describe successful completion as a hook failure/i);

  const planCommand = await readPluginFile("commands", "plan.md");
  assert.match(planCommand, /allowed-tools: \["Bash", "Read", "AskUserQuestion", "Task"\]/);
  assert.match(planCommand, /--runner claude-code/);
  assert.match(planCommand, /\$\{CLAUDE_PROJECT_DIR:-\$PWD\}/);
  assert.match(planCommand, /blueprint approve/);
  assert.match(planCommand, /blueprint reject/);
  assert.match(planCommand, /If the argument is empty/i);
  assert.match(planCommand, /AskUserQuestion/);
  assert.match(planCommand, /canonical request/i);
  assert.match(planCommand, /Do not run `makeitreal-engine` plan with an empty `--request`/);
  assert.match(planCommand, /Do not use a fixed question script/i);
  assert.match(planCommand, /derive each question/i);
  assert.doesNotMatch(planCommand, /ask what concrete feature/i);
  assert.match(planCommand, /operator-facing Blueprint report/i);
  assert.match(planCommand, /What will be delivered/i);
  assert.match(planCommand, /Do not lead with raw engine fields/i);
  assert.match(planCommand, /AskUserQuestion/);
  assert.match(planCommand, /blueprint review/);
  assert.match(planCommand, /Do not branch on the selected label/i);
  assert.match(planCommand, /If the question is dismissed/i);
  assert.match(planCommand, /Do not add a guessed `--allowed-path modules\/<slug>\/\*\*`/);
  assert.match(planCommand, /--prompt "<operator answer>" --decision-json/);
  assert.match(planCommand, /Never run `blueprint review` without both `--prompt` and `--decision-json`/);

  const planSkill = await readPluginFile("skills", "plan", "SKILL.md");
  assert.match(planSkill, /blueprint review --prompt <operator answer> --decision-json <native judgment>/);
  assert.match(planSkill, /Always include both `--prompt` and `--decision-json`/);
});

test("Make It Real config commands use OMC-style semantic UX", async () => {
  for (const [label, reader] of [
    ["makeitreal", readPluginFile],
    ["mir", readAliasPluginFile]
  ]) {
    const command = await reader("commands", "config.md");
    const skill = await reader("skills", "config", "SKILL.md");
    const combined = `${command}\n${skill}`;

    assert.match(command, /allowed-tools: \["Bash", "Read", "AskUserQuestion"\]/, `${label} config should be able to ask`);
    assert.match(combined, /semantic operator intent/i, `${label} config should classify semantic intent`);
    assert.match(combined, /AskUserQuestion/, `${label} config should use Claude Code question UI`);
    assert.match(combined, /--profile quiet/, `${label} config should expose quiet mode through deterministic profile`);
    assert.match(combined, /--profile default/, `${label} config should expose default mode through deterministic profile`);
    assert.match(combined, /Do not present key\/value config editing as the normal path/i);
    assert.doesNotMatch(combined, /features\.liveWiki\.enabled=false/);
    assert.doesNotMatch(command, /config set "\$\{CLAUDE_PROJECT_DIR:-\$PWD\}" \$ARGUMENTS/);
  }
});

test("Make It Real operator commands separate primary reports from diagnostics", async () => {
  const commandNames = ["status", "doctor", "verify", "launch"];
  for (const reader of [readPluginFile, readAliasPluginFile]) {
    for (const commandName of commandNames) {
      const command = await reader("commands", `${commandName}.md`);
      const skill = await reader("skills", commandName, "SKILL.md");
      const combined = `${command}\n${skill}`;

      assert.match(combined, /Operator Report/i, `${commandName} should define an operator report`);
      assert.match(combined, /advanced diagnostic/i, `${commandName} should keep diagnostics secondary`);
      assert.match(combined, /Do not lead with raw engine fields/i, `${commandName} should hide raw fields by default`);
    }
  }
});

test("Make It Real launch skill keeps low-level engine commands internal", async () => {
  const launchSkill = await readPluginFile("skills", "launch", "SKILL.md");
  assert.match(launchSkill, /Use internal engine commands/);
  assert.match(launchSkill, /Do not convert internal commands/);
  assert.match(launchSkill, /board claim/);
  assert.match(launchSkill, /orchestrator native start/);
  assert.match(launchSkill, /--concurrency 6/);
  assert.match(launchSkill, /recommendedNativeTaskConcurrency/);
  assert.match(launchSkill, /unblocked responsibility/i);
  assert.match(launchSkill, /orchestrator native finish/);
  assert.match(launchSkill, /nativeTasks\[\]/);
  assert.match(launchSkill, /parent-session native Task path/);
  assert.match(launchSkill, /existing work item in `Verifying` or `Rework`/);
  assert.match(launchSkill, /Do not spawn `claude --print`/);
  assert.match(launchSkill, /Ralph-like one-command start/);
  assert.match(launchSkill, /evidence roles, not guaranteed installed Claude Code/i);
  assert.match(launchSkill, /code-reviewer.*spec review/i);
  assert.match(launchSkill, /critic.*quality review/i);
  assert.match(launchSkill, /verifier.*verification review/i);
  assert.doesNotMatch(launchSkill, /retry.*general-purpose/i);
  assert.match(launchSkill, /Do not call a successful Done transition a hook failure/i);
});

test("Make It Real skills keep the browser dashboard read-only", async () => {
  const root = new URL("../plugins/makeitreal/skills/", import.meta.url);
  const files = ["setup", "plan", "status", "launch", "verify", "doctor"];
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
  assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].timeout, 20);
  assert.match(hooks.hooks.Stop[0].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/makeitreal-engine-hook/);

  const cliMode = (await stat(path.join(pluginRoot, "bin", "makeitreal-engine"))).mode;
  const hookMode = (await stat(path.join(pluginRoot, "bin", "makeitreal-engine-hook"))).mode;
  assert.notEqual(cliMode & 0o111, 0);
  assert.notEqual(hookMode & 0o111, 0);
});

test("Make It Real repository exposes a Claude marketplace entry", async () => {
  const marketplace = JSON.parse(await readFile(path.join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(marketplace.name, "52g");
  assert.equal(marketplace.plugins.length, 2);

  const plugins = Object.fromEntries(marketplace.plugins.map((plugin) => [plugin.name, plugin]));
  assert.equal(plugins.makeitreal.source, "./plugins/makeitreal");
  assert.equal(plugins.mir.source, "./plugins/mir");
  assert.match(plugins.mir.description, /alias/i);
});

test("Make It Real exposes a thin mir slash-command alias plugin", async () => {
  const canonicalManifest = JSON.parse(await readPluginFile(".claude-plugin", "plugin.json"));
  const aliasManifest = JSON.parse(await readAliasPluginFile(".claude-plugin", "plugin.json"));

  assert.equal(aliasManifest.name, "mir");
  assert.equal(aliasManifest.version, canonicalManifest.version);
  assert.equal(aliasManifest.repository, "https://github.com/mir-makeitreal/makeitreal");
  assert.equal(aliasManifest.homepage, "https://github.com/mir-makeitreal/makeitreal");
  assert.equal(aliasManifest.skills, "./skills/");
  assert.deepEqual(aliasManifest.dependencies, ["makeitreal@52g"]);
  assert.equal(Object.hasOwn(aliasManifest, "hooks"), false, "mir must not register duplicate hooks");
  await assert.rejects(
    () => stat(path.join(aliasPluginRoot, "hooks", "hooks.json")),
    /ENOENT/,
    "mir should rely on the canonical makeitreal plugin hooks"
  );

  const expectedCommands = ["setup", "plan", "launch", "status", "verify", "config", "doctor"];
  for (const commandName of expectedCommands) {
    const command = await readAliasPluginFile("commands", `${commandName}.md`);
    const skill = await readAliasPluginFile("skills", commandName, "SKILL.md");
    assert.match(command, /^---\ndescription:/);
    assert.match(command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/makeitreal-engine/);
    assert.doesNotMatch(`${command}\n${skill}`, /\/makeitreal:/);
  }

  const readme = await readAliasPluginFile("README.md");
  assert.match(readme, /\/mir:setup/);
  assert.match(readme, /\/mir:plan <feature request>/);
  assert.match(readme, /\/mir:launch/);
  assert.match(readme, /\/mir:status/);

  const planSkill = await readAliasPluginFile("skills", "plan", "SKILL.md");
  assert.match(planSkill, /makeitreal:interactive-review:native-claude/);

  const planCommand = await readAliasPluginFile("commands", "plan.md");
  assert.match(planCommand, /allowed-tools: \["Bash", "Read", "AskUserQuestion", "Task"\]/);
  assert.match(planCommand, /\$\{CLAUDE_PROJECT_DIR:-\$PWD\}/);
  assert.match(planCommand, /If the argument is empty/i);
  assert.match(planCommand, /AskUserQuestion/);
  assert.match(planCommand, /canonical request/i);
  assert.match(planCommand, /Do not run `makeitreal-engine` plan with an empty `--request`/);
  assert.match(planCommand, /Do not use a fixed question script/i);
  assert.match(planCommand, /derive each question/i);
  assert.doesNotMatch(planCommand, /ask what concrete feature/i);
  assert.match(planCommand, /operator-facing Blueprint report/i);
  assert.match(planCommand, /What will be delivered/i);
  assert.match(planCommand, /Do not lead with raw engine fields/i);
  assert.match(planCommand, /AskUserQuestion/);
  assert.match(planCommand, /blueprint review/);
  assert.match(planCommand, /Do not branch on the selected label/i);
  assert.match(planCommand, /If the question is dismissed/i);
  assert.match(planCommand, /Do not add a guessed `--allowed-path modules\/<slug>\/\*\*`/);
  assert.match(planCommand, /--prompt "<operator answer>" --decision-json/);
  assert.match(planCommand, /Never run `blueprint review` without both `--prompt` and `--decision-json`/);

  assert.match(planSkill, /blueprint review --prompt <operator answer> --decision-json <native judgment>/);
  assert.match(planSkill, /Always include both `--prompt` and `--decision-json`/);

  const launchCommand = await readAliasPluginFile("commands", "launch.md");
  assert.match(launchCommand, /evidence roles, not guaranteed installed Claude Code/i);
  assert.match(launchCommand, /Do not pass these labels as `subagent_type` unless\s+Claude Code lists them as available agents/i);
  assert.match(launchCommand, /feature-dev:code-reviewer[\s\S]*spec-reviewer/i);
  assert.match(launchCommand, /oh-my-claudecode:critic[\s\S]*quality-reviewer/i);
  assert.match(launchCommand, /oh-my-claudecode:verifier[\s\S]*verification-reviewer/i);
  assert.match(launchCommand, /HARNESS_NATIVE_ROLE_MAPPING_MISSING/i);
  assert.doesNotMatch(launchCommand, /retry the\s+same reviewer prompt with `general-purpose`/i);
  assert.match(launchCommand, /Do not describe successful completion as a hook failure/i);

  const launchSkill = await readAliasPluginFile("skills", "launch", "SKILL.md");
  assert.match(launchSkill, /evidence roles, not guaranteed installed Claude Code/i);
  assert.match(launchSkill, /HARNESS_NATIVE_ROLE_MAPPING_MISSING/i);
  assert.doesNotMatch(launchSkill, /retry the same prompt with `general-purpose`/i);
  assert.match(launchSkill, /Do not call a successful Done transition a hook failure/i);
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

test("mir alias plugin binary delegates to the canonical engine", () => {
  const result = spawnSync(path.join(aliasPluginRoot, "bin", "makeitreal-engine"), ["--help"], {
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

test("mir alias plugin binary prefers the same cached makeitreal version", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-alias-cache-"));
  const cacheRoot = path.join(root, "cache");
  const mirRoot = path.join(cacheRoot, "52g", "mir", "0.1.17");
  const oldEngine = path.join(cacheRoot, "52g", "makeitreal", "0.1.16", "dev-harness", "bin");
  const sameEngine = path.join(cacheRoot, "52g", "makeitreal", "0.1.17", "dev-harness", "bin");
  try {
    await mkdir(mirRoot, { recursive: true });
    await mkdir(oldEngine, { recursive: true });
    await mkdir(sameEngine, { recursive: true });
    await writeFile(path.join(oldEngine, "harness.mjs"), "console.log('selected 0.1.16');\n");
    await writeFile(path.join(sameEngine, "harness.mjs"), "console.log('selected 0.1.17');\n");

    const result = spawnSync(path.join(aliasPluginRoot, "bin", "makeitreal-engine"), ["--version"], {
      cwd: "/tmp",
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: mirRoot,
        CLAUDE_PLUGIN_CACHE_DIR: cacheRoot,
        CLAUDE_PROJECT_DIR: "",
        MAKEITREAL_ENGINE_ROOT: ""
      }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "selected 0.1.17");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("Make It Real installed plugin copy uses the embedded engine", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-installed-plugin-"));
  const installedPlugin = path.join(root, "makeitreal");
  await cp(pluginRoot, installedPlugin, { recursive: true });
  try {
    const result = spawnSync(path.join(installedPlugin, "bin", "makeitreal-engine"), ["--help"], {
      cwd: "/tmp",
      encoding: "utf8",
      env: {
        ...process.env,
        MAKEITREAL_ENGINE_ROOT: "",
        CLAUDE_PROJECT_DIR: ""
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /makeitreal-engine \(internal\)/);

    const embeddedPkg = JSON.parse(await readFile(path.join(installedPlugin, "dev-harness", "package.json"), "utf8"));
    const rootPkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    assert.equal(embeddedPkg.version, rootPkg.version);
    const renderer = await readFile(path.join(installedPlugin, "dev-harness", "src", "preview", "render-dashboard-html.mjs"), "utf8");
    assert.match(renderer, /Blueprint Reference/);
    assert.match(renderer, /Visual Blueprint/);
    assert.match(renderer, /Contract Matrix/);
    assert.match(renderer, /Module Directory/);
    assert.match(renderer, /Usage Example/);
    assert.match(renderer, /Parameters/);
    assert.match(renderer, /Contracts/);
    assert.match(renderer, /Developer Diagnostics/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Make It Real embedded plugin engine stays synchronized", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "sync-plugin-engine.mjs"), "--check"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /in sync/);
});

test("Make It Real does not expose a child-process Claude runner script", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["e2e:real-claude"], undefined);
  await assert.rejects(readFile(path.join(repoRoot, "scripts", "run-real-claude-golden-path.mjs"), "utf8"));
});

test("Make It Real exposes opt-in Claude plugin validation", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["plugin:validate"], "node scripts/validate-claude-plugin.mjs");
  assert.equal(pkg.scripts["plugin:sync"], "node scripts/sync-plugin-engine.mjs");
  assert.equal(pkg.scripts["release:check"], "npm run check && npm run plugin:sync -- --check && npm run plugin:validate");

  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "validate-claude-plugin.mjs"), "--help"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /claude plugin validate plugins\/makeitreal/);
  assert.match(result.stdout, /claude plugin validate plugins\/mir/);
  assert.match(result.stdout, /does not run real Claude Code tasks/);
});
