import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runVerification } from "../src/adapters/command-evidence.mjs";
import { readWikiSyncEvidence } from "../src/domain/evidence.mjs";
import { readJsonFile } from "../src/io/json.mjs";
import { syncLiveWiki } from "../src/wiki/live-wiki.mjs";

function runHarness(args) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });
}

async function withProjectRun(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-config-"));
  const runDir = path.join(root, ".makeitreal", "runs", "feature-auth");
  await cp(new URL("../examples/canonical/.makeitreal/runs/feature-auth", import.meta.url), runDir, { recursive: true });
  try {
    await callback({ root, runDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("config command reads defaults and writes live wiki feature flag", async () => {
  await withProjectRun(async ({ root }) => {
    const defaults = runHarness(["config", "get", root]);
    assert.equal(defaults.status, 0, defaults.stdout || defaults.stderr);
    assert.equal(JSON.parse(defaults.stdout).config.schemaVersion, "1.1");
    assert.equal(JSON.parse(defaults.stdout).config.features.liveWiki.enabled, true);
    assert.deepEqual(JSON.parse(defaults.stdout).config.features.dashboard, {
      autoOpen: true,
      refreshOnLaunch: true,
      refreshOnStatus: true,
      refreshOnVerify: true
    });

    const disabled = runHarness(["config", "set", root, "--live-wiki", "disabled"]);
    assert.equal(disabled.status, 0, disabled.stdout || disabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).config.features.liveWiki.enabled, false);

    const enabled = runHarness(["config", "set", root, "--live-wiki", "enabled"]);
    assert.equal(enabled.status, 0, enabled.stdout || enabled.stderr);
    assert.equal(JSON.parse(enabled.stdout).config.features.liveWiki.enabled, true);
  });
});

test("config command writes dashboard refresh flags", async () => {
  await withProjectRun(async ({ root }) => {
    const disabled = runHarness([
      "config",
      "set",
      root,
      "--dashboard-auto-open",
      "disabled",
      "--dashboard-refresh-on-status",
      "disabled",
      "--dashboard-refresh-on-launch",
      "disabled",
      "--dashboard-refresh-on-verify",
      "disabled"
    ]);
    assert.equal(disabled.status, 0, disabled.stdout || disabled.stderr);
    assert.deepEqual(JSON.parse(disabled.stdout).config.features.dashboard, {
      autoOpen: false,
      refreshOnLaunch: false,
      refreshOnStatus: false,
      refreshOnVerify: false
    });

    const enabled = runHarness(["config", "set", root, "--dashboard-refresh-on-status", "enabled"]);
    assert.equal(enabled.status, 0, enabled.stdout || enabled.stderr);
    assert.deepEqual(JSON.parse(enabled.stdout).config.features.dashboard, {
      autoOpen: false,
      refreshOnLaunch: false,
      refreshOnStatus: true,
      refreshOnVerify: false
    });
  });
});

test("config command applies semantic profiles", async () => {
  await withProjectRun(async ({ root }) => {
    const quiet = runHarness(["config", "set", root, "--profile", "quiet"]);
    assert.equal(quiet.status, 0, quiet.stdout || quiet.stderr);
    assert.deepEqual(JSON.parse(quiet.stdout).config.features, {
      liveWiki: { enabled: true },
      dashboard: {
        autoOpen: false,
        refreshOnLaunch: true,
        refreshOnStatus: false,
        refreshOnVerify: true
      }
    });

    const restored = runHarness(["config", "set", root, "--profile", "default"]);
    assert.equal(restored.status, 0, restored.stdout || restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout).config.features, {
      liveWiki: { enabled: true },
      dashboard: {
        autoOpen: true,
        refreshOnLaunch: true,
        refreshOnStatus: true,
        refreshOnVerify: true
      }
    });

    const unsupported = runHarness(["config", "set", root, "--profile", "noisy"]);
    assert.equal(unsupported.status, 1);
    assert.equal(JSON.parse(unsupported.stdout).errors[0].code, "HARNESS_CONFIG_PROFILE_UNSUPPORTED");
  });
});

test("config migrates 1.0 files and rejects unsupported dashboard keys", async () => {
  await withProjectRun(async ({ root }) => {
    const configPath = path.join(root, ".makeitreal", "config.json");
    await rm(configPath, { force: true });
    const { writeJsonFile } = await import("../src/io/json.mjs");
    await writeJsonFile(configPath, {
      schemaVersion: "1.0",
      features: {
        liveWiki: { enabled: false }
      }
    });
    const migrated = runHarness(["config", "get", root]);
    assert.equal(migrated.status, 0, migrated.stdout || migrated.stderr);
    assert.equal(JSON.parse(migrated.stdout).config.schemaVersion, "1.1");
    assert.equal(JSON.parse(migrated.stdout).config.features.liveWiki.enabled, false);
    assert.equal(JSON.parse(migrated.stdout).config.features.dashboard.autoOpen, true);
    assert.equal(JSON.parse(migrated.stdout).config.features.dashboard.refreshOnStatus, true);

    await writeJsonFile(configPath, {
      schemaVersion: "1.1",
      features: {
        liveWiki: { enabled: true },
        dashboard: { enabled: false }
      }
    });
    const invalid = runHarness(["config", "get", root]);
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).errors[0].code, "HARNESS_CONFIG_KEY_UNKNOWN");
  });
});

test("wiki sync records explicit skip evidence when live wiki is disabled", async () => {
  await withProjectRun(async ({ root, runDir }) => {
    const disabled = runHarness(["config", "set", root, "--live-wiki", "disabled"]);
    assert.equal(disabled.status, 0, disabled.stdout || disabled.stderr);

    await runVerification({ runDir });
    const result = await syncLiveWiki({ runDir });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.outputPath, null);

    const evidence = await readJsonFile(path.join(runDir, "evidence", "wiki-sync.json"));
    assert.equal(evidence.kind, "wiki-sync");
    assert.equal(evidence.skipped, true);
    assert.equal(evidence.workItemId, "work.feature-auth");

    const validated = await readWikiSyncEvidence(runDir);
    assert.equal(validated.ok, true);
  });
});

test("Done gate accepts disabled live wiki skip evidence", async () => {
  await withProjectRun(async ({ root, runDir }) => {
    assert.equal(runHarness(["config", "set", root, "--live-wiki", "disabled"]).status, 0);
    assert.equal(runHarness(["design", "render", runDir]).status, 0);
    assert.equal(runHarness(["verify", runDir]).status, 0);
    const wiki = runHarness(["wiki", "sync", runDir]);
    assert.equal(wiki.status, 0, wiki.stdout || wiki.stderr);
    assert.equal(JSON.parse(wiki.stdout).skipped, true);

    const done = runHarness(["gate", runDir, "--target", "Done"]);
    assert.equal(done.status, 0, done.stdout || done.stderr);
    assert.equal(JSON.parse(done.stdout).ok, true);
  });
});
