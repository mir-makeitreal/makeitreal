import path from "node:path";
import { fileExists, readJsonFile, writeJsonFile } from "../io/json.mjs";

function settingsPath(projectRoot, scope) {
  return path.join(projectRoot, ".claude", scope === "project" ? "settings.json" : "settings.local.json");
}

function commandFor({ scriptPath, runDir, projectRoot }) {
  const relativeScript = path.relative(projectRoot, scriptPath);
  const relativeRunDir = path.relative(projectRoot, runDir);
  return `HARNESS_RUN_DIR="$CLAUDE_PROJECT_DIR/${relativeRunDir}" node "$CLAUDE_PROJECT_DIR/${relativeScript}"`;
}

function withoutExistingHarnessHook(groups, command) {
  return groups
    .map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter((hook) => hook.command !== command)
    }))
    .filter((group) => (group.hooks ?? []).length > 0);
}

function appendHook(settings, eventName, group) {
  settings.hooks ??= {};
  const current = settings.hooks[eventName] ?? [];
  const command = group.hooks[0].command;
  settings.hooks[eventName] = [...withoutExistingHarnessHook(current, command), group];
}

function hasCommand(settings, eventName, command) {
  return (settings.hooks?.[eventName] ?? []).some((group) =>
    (group.hooks ?? []).some((hook) => hook.command === command)
  );
}

export function buildClaudeHookSettings({ projectRoot, runDir }) {
  const preToolCommand = commandFor({
    projectRoot,
    runDir,
    scriptPath: path.join(projectRoot, "dev-harness", "hooks", "claude", "pre-tool-use.mjs")
  });
  const stopCommand = commandFor({
    projectRoot,
    runDir,
    scriptPath: path.join(projectRoot, "dev-harness", "hooks", "claude", "stop.mjs")
  });
  const userPromptCommand = commandFor({
    projectRoot,
    runDir,
    scriptPath: path.join(projectRoot, "dev-harness", "hooks", "claude", "user-prompt-submit.mjs")
  });

  return {
    UserPromptSubmit: {
      matcher: "*",
      hooks: [{ type: "command", command: userPromptCommand }]
    },
    PreToolUse: {
      matcher: "Edit|Write|MultiEdit|Bash",
      hooks: [{ type: "command", command: preToolCommand }]
    },
    Stop: {
      hooks: [{ type: "command", command: stopCommand }]
    }
  };
}

export async function installClaudeHooks({ projectRoot, runDir, scope = "local" }) {
  const targetPath = settingsPath(projectRoot, scope);
  const settings = await fileExists(targetPath) ? await readJsonFile(targetPath) : {};
  const hooks = buildClaudeHookSettings({ projectRoot, runDir });

  appendHook(settings, "UserPromptSubmit", hooks.UserPromptSubmit);
  appendHook(settings, "PreToolUse", hooks.PreToolUse);
  appendHook(settings, "Stop", hooks.Stop);
  await writeJsonFile(targetPath, settings);

  return {
    ok: true,
    command: "hooks install",
    settingsPath: targetPath,
    scope,
    errors: []
  };
}

export async function getClaudeHookStatus({ projectRoot, runDir, scope = "local" }) {
  const targetPath = settingsPath(projectRoot, scope);
  const hooks = buildClaudeHookSettings({ projectRoot, runDir });
  const settings = await fileExists(targetPath) ? await readJsonFile(targetPath) : {};
  const preToolCommand = hooks.PreToolUse.hooks[0].command;
  const stopCommand = hooks.Stop.hooks[0].command;
  const userPromptCommand = hooks.UserPromptSubmit.hooks[0].command;

  return {
    ok: true,
    command: "hooks status",
    settingsPath: targetPath,
    scope,
    installed: {
      UserPromptSubmit: hasCommand(settings, "UserPromptSubmit", userPromptCommand),
      PreToolUse: hasCommand(settings, "PreToolUse", preToolCommand),
      Stop: hasCommand(settings, "Stop", stopCommand)
    },
    errors: []
  };
}
