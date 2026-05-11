import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { readProjectConfig } from "../config/project-config.mjs";
import { dashboardLocation } from "../dashboard/open-dashboard.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { getClaudeHookStatus } from "../hooks/claude-settings.mjs";
import { fileExists, readJsonFile } from "../io/json.mjs";
import { resolveCurrentRunDir } from "../project/run-state.mjs";

const EXPECTED_PLUGIN_COMMANDS = Object.freeze(["setup", "plan", "launch", "status", "verify", "config", "doctor"]);
const EXPECTED_PLUGIN_SKILLS = EXPECTED_PLUGIN_COMMANDS;
const EXPECTED_PLUGIN_HOOKS = Object.freeze(["UserPromptSubmit", "PreToolUse", "Stop"]);

function pass(summary, extra = {}) {
  return { ok: true, status: "pass", summary, errors: [], ...extra };
}

function fail({ code, summary, evidence, reason = summary, nextAction = "/makeitreal:status", extra = {} }) {
  return {
    ok: false,
    status: "fail",
    summary,
    nextAction,
    errors: [createHarnessError({ code, reason, evidence, recoverable: true })],
    ...extra
  };
}

function skipped(summary, extra = {}) {
  return { ok: true, status: "skipped", summary, errors: [], ...extra };
}

async function executable(filePath) {
  try {
    return ((await stat(filePath)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function pluginHookCommand(hooksJson, hookName) {
  return hooksJson?.hooks?.[hookName]?.[0]?.hooks?.[0]?.command ?? "";
}

async function validatePluginHooks({ pluginRoot }) {
  const engineBinary = path.join(pluginRoot, "bin", "makeitreal-engine");
  const hookBinary = path.join(pluginRoot, "bin", "makeitreal-engine-hook");
  const hooksPath = path.join(pluginRoot, "hooks", "hooks.json");
  let hooksJson;
  try {
    hooksJson = await readJsonFile(hooksPath);
  } catch {
    return {
      ok: false,
      reason: "Plugin hook manifest is missing or invalid JSON.",
      evidence: [path.relative(pluginRoot, hooksPath)]
    };
  }

  const missingHookCommands = EXPECTED_PLUGIN_HOOKS.filter((hookName) =>
    !pluginHookCommand(hooksJson, hookName).includes("${CLAUDE_PLUGIN_ROOT}/bin/makeitreal-engine-hook")
  );
  if (missingHookCommands.length > 0) {
    return {
      ok: false,
      reason: `Plugin hook manifest is missing Make It Real hook commands: ${missingHookCommands.join(", ")}.`,
      evidence: [path.relative(pluginRoot, hooksPath), ...missingHookCommands]
    };
  }

  if (!await executable(hookBinary)) {
    return {
      ok: false,
      reason: "Plugin hook binary is missing or not executable.",
      evidence: [path.relative(pluginRoot, hookBinary)]
    };
  }
  if (!await executable(engineBinary)) {
    return {
      ok: false,
      reason: "Plugin engine binary is missing or not executable.",
      evidence: [path.relative(pluginRoot, engineBinary)]
    };
  }

  return {
    ok: true,
    evidence: [
      path.relative(pluginRoot, hooksPath),
      path.relative(pluginRoot, hookBinary),
      path.relative(pluginRoot, engineBinary)
    ]
  };
}

async function checkPlugin({ env }) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT ? path.resolve(env.CLAUDE_PLUGIN_ROOT) : null;
  if (!pluginRoot) {
    return skipped("CLAUDE_PLUGIN_ROOT is not set; plugin-root diagnostics were skipped.", {
      pluginRoot: null
    });
  }

  const requiredFiles = [
    path.join(pluginRoot, "bin", "makeitreal-engine"),
    path.join(pluginRoot, "bin", "makeitreal-engine-hook"),
    path.join(pluginRoot, "hooks", "hooks.json"),
    ...EXPECTED_PLUGIN_COMMANDS.map((command) => path.join(pluginRoot, "commands", `${command}.md`)),
    ...EXPECTED_PLUGIN_SKILLS.map((skill) => path.join(pluginRoot, "skills", skill, "SKILL.md"))
  ];
  const missing = [];
  for (const filePath of requiredFiles) {
    if (!await fileExists(filePath)) {
      missing.push(path.relative(pluginRoot, filePath));
    }
  }

  if (missing.length > 0) {
    return fail({
      code: "HARNESS_PLUGIN_FILES_MISSING",
      summary: "Make It Real plugin files are incomplete.",
      reason: `Missing plugin files: ${missing.join(", ")}.`,
      evidence: missing,
      nextAction: "Reinstall the Make It Real plugin from the marketplace.",
      extra: { pluginRoot, missing }
    });
  }

  const pluginHooks = await validatePluginHooks({ pluginRoot });
  if (!pluginHooks.ok) {
    return fail({
      code: "HARNESS_PLUGIN_HOOKS_INVALID",
      summary: "Make It Real plugin hook assets are invalid.",
      reason: pluginHooks.reason,
      evidence: pluginHooks.evidence,
      nextAction: "Reinstall the Make It Real plugin from the marketplace.",
      extra: { pluginRoot }
    });
  }

  return pass("Make It Real plugin commands, skills, engine binary, and hook assets are present.", {
    pluginRoot,
    commands: EXPECTED_PLUGIN_COMMANDS,
    skills: EXPECTED_PLUGIN_SKILLS,
    hookAssets: pluginHooks.evidence
  });
}

async function checkConfig({ projectRoot }) {
  const result = await readProjectConfig({ projectRoot });
  if (!result.ok) {
    return fail({
      code: result.errors[0]?.code ?? "HARNESS_CONFIG_INVALID",
      summary: "Make It Real project config is invalid.",
      reason: result.errors[0]?.reason ?? "Project config could not be read.",
      evidence: result.errors[0]?.evidence ?? [result.configPath],
      nextAction: "/makeitreal:config",
      extra: {
        configPath: result.configPath,
        source: result.source
      }
    });
  }
  return pass(`Make It Real project config loaded from ${result.source}.`, {
    configPath: result.configPath,
    source: result.source,
    config: result.config
  });
}

async function checkCurrentRun({ projectRoot, runDir, env }) {
  const result = await resolveCurrentRunDir({ projectRoot, runDir, env });
  if (!result.ok) {
    const explicitRunRequested = Boolean(runDir ?? env.HARNESS_RUN_DIR ?? env.MAKEITREAL_RUN_DIR);
    if (!explicitRunRequested) {
      return skipped("No current Make It Real run is selected yet; create one with plan when you are ready.", {
        source: result.source,
        runDir: null,
        nextAction: "/makeitreal:plan <request>"
      });
    }
    return fail({
      code: result.errors[0]?.code ?? "HARNESS_CURRENT_RUN_MISSING",
      summary: "No readable Make It Real current run is selected.",
      reason: result.errors[0]?.reason ?? "No active Make It Real run state found.",
      evidence: result.errors[0]?.evidence ?? [".makeitreal/current-run.json"],
      nextAction: "/makeitreal:plan <request>",
      extra: {
        source: result.source,
        runDir: null
      }
    });
  }
  return pass(`Current run resolved from ${result.source}.`, {
    source: result.source,
    runDir: result.runDir
  });
}

async function checkHooks({ projectRoot, currentRun }) {
  if (!currentRun.ok || !currentRun.runDir) {
    return skipped("Hook diagnostics require a current run.", {
      installed: null
    });
  }
  const result = await getClaudeHookStatus({
    projectRoot,
    runDir: currentRun.runDir,
    scope: "local"
  });
  const missing = Object.entries(result.installed)
    .filter(([, installed]) => !installed)
    .map(([hookName]) => hookName);
  if (missing.length > 0) {
    return fail({
      code: "HARNESS_CLAUDE_HOOKS_MISSING",
      summary: "Claude hook settings are missing Make It Real hooks.",
      reason: `Missing Claude hooks: ${missing.join(", ")}.`,
      evidence: [result.settingsPath],
      nextAction: "/makeitreal:setup",
      extra: {
        settingsPath: result.settingsPath,
        installed: result.installed,
        missing
      }
    });
  }
  return pass("Claude hook settings include Make It Real hooks.", {
    settingsPath: result.settingsPath,
    installed: result.installed
  });
}

async function checkDashboard({ currentRun }) {
  if (!currentRun.ok || !currentRun.runDir) {
    return skipped("Dashboard diagnostics require a current run.", {
      dashboardUrl: null
    });
  }
  const location = dashboardLocation({ runDir: currentRun.runDir });
  if (!await fileExists(location.indexPath)) {
    return fail({
      code: "HARNESS_DASHBOARD_PREVIEW_MISSING",
      summary: "Make It Real dashboard preview is missing.",
      reason: "The current run does not have preview/index.html.",
      evidence: [location.indexPath],
      nextAction: "/makeitreal:status",
      extra: location
    });
  }
  return pass("Make It Real dashboard preview exists.", location);
}

function checkClaudeBinary({ env }) {
  const pathLookup = spawnSync(env.SHELL ?? "sh", ["-lc", "command -v claude"], {
    encoding: "utf8",
    shell: false,
    env
  });
  const claudePath = pathLookup.status === 0 ? pathLookup.stdout.trim() : null;
  const version = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    shell: false,
    env
  });
  if (version.error || version.status !== 0) {
    return fail({
      code: "HARNESS_CLAUDE_BINARY_MISSING",
      summary: "Claude Code CLI is not available on PATH.",
      reason: "The doctor command could not execute claude --version.",
      evidence: ["PATH", "claude --version"],
      nextAction: "Install Claude Code CLI or fix PATH.",
      extra: {
        claudePath,
        version: null
      }
    });
  }
  return pass("Claude Code CLI is available.", {
    claudePath,
    version: version.stdout.trim() || version.stderr.trim()
  });
}

function firstFailingNextAction(checks) {
  for (const check of Object.values(checks)) {
    if (check.status === "fail") {
      return check.nextAction ?? "/makeitreal:status";
    }
  }
  return "/makeitreal:status";
}

function doctorNextAction({ healthy, checks }) {
  if (!healthy) {
    return firstFailingNextAction(checks);
  }
  if (checks.currentRun?.status === "skipped" && checks.currentRun.nextAction) {
    return checks.currentRun.nextAction;
  }
  return "/makeitreal:status";
}

export async function runDoctor({
  projectRoot = process.cwd(),
  runDir = null,
  env = process.env,
  now = new Date()
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const config = await checkConfig({ projectRoot: resolvedProjectRoot });
  const plugin = await checkPlugin({ env });
  const currentRun = await checkCurrentRun({ projectRoot: resolvedProjectRoot, runDir, env });
  const hooks = await checkHooks({ projectRoot: resolvedProjectRoot, currentRun });
  const dashboard = await checkDashboard({ currentRun });
  const claudeBinary = checkClaudeBinary({ env });
  const checks = { config, plugin, currentRun, hooks, dashboard, claudeBinary };
  const healthy = Object.values(checks).every((check) => check.status !== "fail");
  return {
    ok: true,
    healthy,
    command: "doctor",
    projectRoot: resolvedProjectRoot,
    runDir: currentRun.runDir ?? null,
    checks,
    supportMatrix: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      shell: env.SHELL ?? null,
      claudePath: claudeBinary.claudePath ?? null,
      claudeVersion: claudeBinary.version ?? null,
      pluginRoot: plugin.pluginRoot ?? null,
      configSource: config.source ?? null,
      currentRunSource: currentRun.source ?? null
    },
    nextAction: doctorNextAction({ healthy, checks }),
    generatedAt: now.toISOString(),
    errors: Object.values(checks).flatMap((check) => check.errors ?? [])
  };
}
