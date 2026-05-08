import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { currentRunStatePath, readCurrentRunState, resolveCurrentRunDir, writeCurrentRunState } from "../src/project/run-state.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

test("setup without a run initializes local harness state and gitignore", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-project-"));
  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "bin", "harness.mjs"),
      "setup",
      projectRoot
    ], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.command, "setup");
    assert.equal(output.currentRunUpdated, false);
    assert.equal(output.nextAction, "/makeitreal:plan <request>");

    const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /^\/\.makeitreal\/$/m);
    const current = await readCurrentRunState(projectRoot);
    assert.equal(current.ok, false);
    assert.equal(current.errors[0].code, "HARNESS_CURRENT_RUN_MISSING");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("setup writes a portable current-run pointer", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-project-"));
  try {
    const runDir = path.join(projectRoot, ".makeitreal", "runs", "feature-demo");
    const result = await writeCurrentRunState({
      projectRoot,
      runDir,
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    assert.equal(result.ok, true);
    assert.equal(result.state.currentRunDir, ".makeitreal/runs/feature-demo");
    assert.equal(result.statePath, currentRunStatePath(projectRoot));

    const current = await readCurrentRunState(projectRoot);
    assert.equal(current.ok, true);
    assert.equal(current.runDir, runDir);

    const resolved = await resolveCurrentRunDir({ projectRoot });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "current-run");
    assert.equal(resolved.runDir, runDir);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("explicit run dir overrides current-run state", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-project-"));
  try {
    await writeCurrentRunState({
      projectRoot,
      runDir: ".makeitreal/runs/feature-a",
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    const resolved = await resolveCurrentRunDir({
      projectRoot,
      runDir: ".makeitreal/runs/feature-b"
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "explicit");
    assert.equal(resolved.runDir, path.join(projectRoot, ".makeitreal", "runs", "feature-b"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
