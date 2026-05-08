import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { installClaudeHooks } from "../src/hooks/claude-settings.mjs";
import { generatePlanRun } from "../src/plan/plan-generator.mjs";
import { runDoctor } from "../src/diagnostics/doctor.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const pluginRoot = path.join(repoRoot, "plugins", "makeitreal");

async function writeFakeClaude(root) {
  const filePath = path.join(root, "claude");
  await writeFile(filePath, "#!/usr/bin/env node\nconsole.log('2.1.133');\n", "utf8");
  await chmod(filePath, 0o755);
  return filePath;
}

async function snapshot(paths) {
  const out = {};
  for (const filePath of paths) {
    try {
      out[filePath] = await readFile(filePath, "utf8");
    } catch {
      out[filePath] = null;
    }
  }
  return out;
}

test("doctor reports plugin, hooks, current run, dashboard, and Claude binary without writes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-"));
  const binDir = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-bin-"));
  try {
    await writeFakeClaude(binDir);
    const plan = await generatePlanRun({
      projectRoot: root,
      request: "Build a doctor diagnostic module",
      runId: "doctor-diagnostics",
      owner: "team.diagnostics",
      allowedPaths: ["modules/doctor-diagnostics/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('doctor ok')"] }],
      now: new Date("2026-05-08T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);
    const hooks = await installClaudeHooks({
      projectRoot: root,
      runDir: plan.runDir,
      scope: "local"
    });
    assert.equal(hooks.ok, true);

    const watched = [
      path.join(root, ".makeitreal", "current-run.json"),
      path.join(root, ".claude", "settings.local.json"),
      path.join(plan.runDir, "preview", "index.html")
    ];
    const before = await snapshot(watched);
    const result = await runDoctor({
      projectRoot: root,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      },
      now: new Date("2026-05-08T00:00:01.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.healthy, true);
    assert.equal(result.nextAction, "/makeitreal:status");
    assert.equal(result.checks.plugin.status, "pass");
    assert.deepEqual(result.checks.plugin.hookAssets, ["hooks/hooks.json", "bin/makeitreal-engine-hook", "bin/makeitreal-engine"]);
    assert.equal(result.checks.currentRun.status, "pass");
    assert.equal(result.checks.hooks.status, "pass");
    assert.equal(result.checks.dashboard.status, "pass");
    assert.equal(result.checks.claudeBinary.status, "pass");
    assert.equal(result.supportMatrix.claudeVersion, "2.1.133");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(await snapshot(watched), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});

test("doctor diagnoses a non-executable plugin engine binary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-engine-"));
  const binDir = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-engine-bin-"));
  const copiedPlugin = path.join(root, "plugin");
  try {
    await writeFakeClaude(binDir);
    await cp(pluginRoot, copiedPlugin, { recursive: true });
    await chmod(path.join(copiedPlugin, "bin", "makeitreal-engine"), 0o644);

    const result = await runDoctor({
      projectRoot: root,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: copiedPlugin,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      },
      now: new Date("2026-05-08T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.healthy, false);
    assert.equal(result.checks.plugin.status, "fail");
    assert.equal(result.checks.plugin.errors[0].code, "HARNESS_PLUGIN_HOOKS_INVALID");
    assert.equal(result.checks.plugin.errors[0].evidence.includes("bin/makeitreal-engine"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});

test("doctor diagnoses plugin hook bundle assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-plugin-"));
  const binDir = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-plugin-bin-"));
  const copiedPlugin = path.join(root, "plugin");
  try {
    await writeFakeClaude(binDir);
    await cp(pluginRoot, copiedPlugin, { recursive: true });
    await rm(path.join(copiedPlugin, "hooks", "hooks.json"), { force: true });

    const result = await runDoctor({
      projectRoot: root,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: copiedPlugin,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      },
      now: new Date("2026-05-08T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.healthy, false);
    assert.equal(result.checks.plugin.status, "fail");
    assert.equal(result.checks.plugin.errors[0].code, "HARNESS_PLUGIN_FILES_MISSING");
    assert.equal(result.checks.plugin.missing.includes("hooks/hooks.json"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});

test("doctor CLI accepts a documented positional run path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-positional-"));
  const binDir = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-positional-bin-"));
  try {
    await writeFakeClaude(binDir);
    const plan = await generatePlanRun({
      projectRoot: root,
      request: "Build positional doctor diagnostics",
      runId: "positional-doctor",
      owner: "team.diagnostics",
      allowedPaths: ["modules/positional-doctor/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('positional doctor ok')"] }],
      now: new Date("2026-05-08T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "doctor",
      root,
      path.relative(root, plan.runDir),
      "--now",
      "2026-05-08T00:00:01.000Z"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      }
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.runDir, plan.runDir);
    assert.equal(output.checks.currentRun.source, "explicit");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});

test("doctor exits zero and points to setup when no current run is selected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-empty-"));
  const binDir = await mkdtemp(path.join(os.tmpdir(), "makeitreal-doctor-empty-bin-"));
  try {
    await writeFakeClaude(binDir);
    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "doctor",
      root,
      "--now",
      "2026-05-08T00:00:00.000Z"
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`
      }
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.healthy, false);
    assert.equal(output.checks.currentRun.status, "fail");
    assert.equal(output.checks.currentRun.errors[0].code, "HARNESS_CURRENT_RUN_MISSING");
    assert.equal(output.nextAction, "/makeitreal:setup");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  }
});
