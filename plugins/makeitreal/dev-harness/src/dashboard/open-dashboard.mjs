import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readProjectConfig, resolveProjectConfigForRun } from "../config/project-config.mjs";
import { createHarnessError } from "../domain/errors.mjs";

export function dashboardLocation({ runDir }) {
  const indexPath = path.join(path.resolve(runDir), "preview", "index.html");
  return {
    indexPath,
    dashboardUrl: pathToFileURL(indexPath).href
  };
}

function platformOpenCommand({ indexPath, platform = process.platform }) {
  if (platform === "darwin") {
    return { file: "open", args: [indexPath] };
  }
  if (platform === "win32") {
    return { file: "cmd", args: ["/c", "start", "", indexPath] };
  }
  return { file: "xdg-open", args: [indexPath] };
}

export async function openDashboard({
  runDir,
  projectRoot = null,
  dryRun = false,
  force = false,
  env = process.env,
  platform = process.platform
}) {
  const config = projectRoot
    ? await readProjectConfig({ projectRoot })
    : await resolveProjectConfigForRun({ runDir, env });
  const location = dashboardLocation({ runDir });
  if (!config.ok) {
    return {
      ok: false,
      command: "dashboard open",
      ...location,
      opened: false,
      skipped: false,
      configPath: config.configPath,
      errors: config.errors
    };
  }

  if (!force && config.config.features.dashboard.autoOpen === false) {
    return {
      ok: true,
      command: "dashboard open",
      ...location,
      opened: false,
      skipped: true,
      reason: "Dashboard auto-open is disabled by Make It Real config.",
      configPath: config.configPath,
      errors: []
    };
  }

  if (dryRun || env.MAKEITREAL_DASHBOARD_OPEN === "disabled") {
    return {
      ok: true,
      command: "dashboard open",
      ...location,
      opened: false,
      skipped: true,
      reason: dryRun ? "Dashboard open dry-run requested." : "Dashboard open disabled by environment.",
      configPath: config.configPath,
      errors: []
    };
  }

  const command = platformOpenCommand({ indexPath: location.indexPath, platform });
  const result = spawnSync(command.file, command.args, {
    encoding: "utf8",
    shell: false,
    stdio: "ignore"
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      command: "dashboard open",
      ...location,
      opened: false,
      skipped: false,
      configPath: config.configPath,
      errors: [createHarnessError({
        code: "HARNESS_DASHBOARD_OPEN_FAILED",
        reason: `Failed to open Make It Real dashboard with ${command.file}.`,
        evidence: [location.indexPath],
        recoverable: true
      })]
    };
  }

  return {
    ok: true,
    command: "dashboard open",
    ...location,
    opened: true,
    skipped: false,
    configPath: config.configPath,
    errors: []
  };
}
