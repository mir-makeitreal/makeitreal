import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { currentRunStatePath, readCurrentRunState, resolveCurrentRunDir, writeCurrentRunState } from "../src/project/run-state.mjs";

test("setup writes a portable current-run pointer", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-project-"));
  try {
    const runDir = path.join(projectRoot, ".harness", "runs", "feature-demo");
    const result = await writeCurrentRunState({
      projectRoot,
      runDir,
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    assert.equal(result.ok, true);
    assert.equal(result.state.currentRunDir, ".harness/runs/feature-demo");
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
      runDir: ".harness/runs/feature-a",
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    const resolved = await resolveCurrentRunDir({
      projectRoot,
      runDir: ".harness/runs/feature-b"
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.source, "explicit");
    assert.equal(resolved.runDir, path.join(projectRoot, ".harness", "runs", "feature-b"));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
