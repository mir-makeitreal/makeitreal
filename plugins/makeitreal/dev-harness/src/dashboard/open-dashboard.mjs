import { spawnSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readProjectConfig, resolveProjectConfigForRun } from "../config/project-config.mjs";
import { createHarnessError } from "../domain/errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function dashboardLocation({ runDir }) {
  const indexPath = path.join(path.resolve(runDir), "preview", "index.html");
  return {
    indexPath,
    dashboardUrl: pathToFileURL(indexPath).href
  };
}

function platformOpenCommand({ url, platform = process.platform }) {
  if (platform === "darwin") {
    return { file: "open", args: [url] };
  }
  if (platform === "win32") {
    return { file: "cmd", args: ["/c", "start", "", url] };
  }
  return { file: "xdg-open", args: [url] };
}

async function readPortFile(runDir) {
  const portFilePath = path.join(path.resolve(runDir), "..", "..", "..", ".makeitreal", "dashboard.port");
  try {
    const port = parseInt(await readFile(portFilePath, "utf8"), 10);
    if (!port || isNaN(port)) return null;
    return port;
  } catch {
    return null;
  }
}

async function isServerAlive(port) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/api/server-info`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function startServer(runDir) {
  const serverPath = path.join(__dirname, "server.mjs");
  const child = spawn(process.execPath, [serverPath, runDir], {
    stdio: ["ignore", "pipe", "ignore"],
    detached: true,
  });
  child.unref();

  // Wait for server to output its port info
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error("Dashboard server failed to start within 10 seconds."));
    }, 10000);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      try {
        const info = JSON.parse(output);
        clearTimeout(timeout);
        resolve(info);
      } catch {
        // keep accumulating
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Dashboard server exited with code ${code}`));
      }
    });
  });
}

export async function openDashboard({
  runDir,
  projectRoot = null,
  dryRun = false,
  force = false,
  env = process.env,
  platform = process.platform,
  readPortFileFn = readPortFile,
  isServerAliveFn = isServerAlive,
  startServerFn = startServer,
  openCommandRunner = spawnSync
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

  // Try to use the live server
  let serverUrl = null;
  const existingPort = await readPortFileFn(runDir);
  if (existingPort && await isServerAliveFn(existingPort)) {
    serverUrl = `http://127.0.0.1:${existingPort}`;
  } else {
    // Try to start the server
    try {
      const info = await startServerFn(path.resolve(runDir));
      if (info.ok && info.url) {
        serverUrl = info.url;
      }
    } catch {
      // Fall back to file:// URL if server can't start
    }
  }

  const openUrl = serverUrl ?? location.indexPath;
  const command = platformOpenCommand({ url: openUrl, platform });
  const result = openCommandRunner(command.file, command.args, {
    encoding: "utf8",
    shell: false,
    stdio: "ignore"
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      command: "dashboard open",
      ...location,
      dashboardUrl: serverUrl ?? location.dashboardUrl,
      opened: false,
      skipped: false,
      configPath: config.configPath,
      errors: [createHarnessError({
        code: "HARNESS_DASHBOARD_OPEN_FAILED",
        reason: `Failed to open Make It Real dashboard with ${command.file}.`,
        evidence: [openUrl],
        recoverable: true
      })]
    };
  }

  return {
    ok: true,
    command: "dashboard open",
    ...location,
    dashboardUrl: serverUrl ?? location.dashboardUrl,
    opened: true,
    skipped: false,
    serverUrl,
    configPath: config.configPath,
    errors: []
  };
}
