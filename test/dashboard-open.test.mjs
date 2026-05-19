import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openDashboard } from "../src/dashboard/open-dashboard.mjs";

function runHarness(args, options = {}) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    ...options
  });
}

async function withProjectRun(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-dashboard-open-"));
  const runDir = path.join(root, ".makeitreal", "runs", "feature-auth");
  await cp(new URL("../examples/canonical/.makeitreal/runs/feature-auth", import.meta.url), runDir, { recursive: true });
  try {
    await callback({ root, runDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("dashboard open exposes a browser URL without opening during dry-run", async () => {
  await withProjectRun(async ({ root, runDir }) => {
    const rendered = runHarness(["design", "render", runDir]);
    assert.equal(rendered.status, 0, rendered.stdout || rendered.stderr);

    const opened = runHarness(["dashboard", "open", runDir, "--project-root", root, "--dry-run"]);
    assert.equal(opened.status, 0, opened.stdout || opened.stderr);
    const output = JSON.parse(opened.stdout);
    assert.equal(output.command, "dashboard open");
    assert.equal(output.opened, false);
    assert.equal(output.skipped, true);
    assert.match(output.dashboardUrl, /^file:\/\//);
    assert.equal(output.indexPath, path.join(runDir, "preview", "index.html"));
  });
});

test("dashboard open respects dashboard auto-open config", async () => {
  await withProjectRun(async ({ root, runDir }) => {
    assert.equal(runHarness(["config", "set", root, "--dashboard-auto-open", "disabled"]).status, 0);
    const result = runHarness(["dashboard", "open", runDir, "--project-root", root]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.opened, false);
    assert.equal(output.skipped, true);
    assert.match(output.reason, /disabled/);
  });
});

test("dashboard open starts the live server before opening when no server is running", async () => {
  await withProjectRun(async ({ root, runDir }) => {
    const rendered = runHarness(["design", "render", runDir]);
    assert.equal(rendered.status, 0, rendered.stdout || rendered.stderr);

    const openedCommands = [];
    const result = await openDashboard({
      runDir,
      projectRoot: root,
      platform: "linux",
      readPortFileFn: async () => null,
      isServerAliveFn: async () => false,
      startServerFn: async (startedRunDir) => ({
        ok: true,
        url: "http://127.0.0.1:43210",
        runDir: startedRunDir
      }),
      openCommandRunner: (file, args) => {
        openedCommands.push({ file, args });
        return { status: 0, error: null };
      }
    });

    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.opened, true);
    assert.equal(result.serverUrl, "http://127.0.0.1:43210");
    assert.equal(result.dashboardUrl, "http://127.0.0.1:43210");
    assert.deepEqual(openedCommands, [{ file: "xdg-open", args: ["http://127.0.0.1:43210"] }]);
  });
});
