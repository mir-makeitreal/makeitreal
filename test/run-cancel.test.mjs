import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileExists, readJsonFile } from "../src/io/json.mjs";
import {
  cancelCurrentRun,
  currentRunStatePath,
  sessionCurrentRunStatePath,
  writeCurrentRunState
} from "../src/project/run-state.mjs";

const NOW = new Date("2026-06-10T00:00:00.000Z");

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-run-cancel-"));
  const runDir = path.join(root, ".makeitreal", "runs", "feature-auth");
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "prd.json"), "{}\n");
  return { root, runDir };
}

test("run cancel releases project and matching session pointers but preserves the run directory", async () => {
  const { root, runDir } = await makeProject();
  try {
    const otherRunDir = path.join(root, ".makeitreal", "runs", "feature-other");
    await writeCurrentRunState({ projectRoot: root, runDir: otherRunDir, sessionId: "session-other", now: NOW });
    await writeCurrentRunState({ projectRoot: root, runDir, sessionId: "session-active", now: NOW });

    const pointerPath = currentRunStatePath(root);
    const activeSessionPath = sessionCurrentRunStatePath(root, "session-active");
    const otherSessionPath = sessionCurrentRunStatePath(root, "session-other");
    assert.equal(await fileExists(pointerPath), true);
    assert.equal(await fileExists(activeSessionPath), true);

    const result = await cancelCurrentRun({ projectRoot: root });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.command, "run cancel");
    assert.equal(result.runDir, runDir);
    assert.equal(result.runDirPreserved, true);
    assert.deepEqual(result.releasedPointers.sort(), [pointerPath, activeSessionPath].sort());
    assert.deepEqual(result.unreadablePointers, []);

    assert.equal(await fileExists(pointerPath), false);
    assert.equal(await fileExists(activeSessionPath), false);
    assert.equal(await fileExists(otherSessionPath), true, "session pointer for a different run must stay");
    assert.equal(await fileExists(path.join(runDir, "prd.json")), true, "run directory must be preserved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run cancel reports an unreadable session pointer and leaves it untouched", async () => {
  const { root, runDir } = await makeProject();
  try {
    await writeCurrentRunState({ projectRoot: root, runDir, now: NOW });
    const brokenPath = sessionCurrentRunStatePath(root, "session-broken");
    await mkdir(path.dirname(brokenPath), { recursive: true });
    await writeFile(brokenPath, "{not json");

    const result = await cancelCurrentRun({ projectRoot: root });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(result.unreadablePointers, [brokenPath]);
    assert.equal(await fileExists(brokenPath), true);
    assert.equal(await fileExists(currentRunStatePath(root)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run cancel without an active run returns an explicit error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-run-cancel-empty-"));
  try {
    const result = await cancelCurrentRun({ projectRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.command, "run cancel");
    assert.equal(result.errors[0].code, "HARNESS_CURRENT_RUN_MISSING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI run cancel releases the pointer once and then errors explicitly", async () => {
  const { root, runDir } = await makeProject();
  try {
    await writeCurrentRunState({ projectRoot: root, runDir, sessionId: "session-cli", now: NOW });

    const first = spawnSync(process.execPath, ["bin/harness.mjs", "run", "cancel", root], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const output = JSON.parse(first.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.command, "run cancel");
    assert.equal(output.runDirPreserved, true);
    assert.deepEqual(
      output.releasedPointers.sort(),
      [currentRunStatePath(root), sessionCurrentRunStatePath(root, "session-cli")].sort()
    );
    assert.equal(await fileExists(currentRunStatePath(root)), false);
    assert.equal(await fileExists(path.join(runDir, "prd.json")), true);

    const second = spawnSync(process.execPath, ["bin/harness.mjs", "run", "cancel", root], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(second.status, 1);
    const secondOutput = JSON.parse(second.stdout);
    assert.equal(secondOutput.ok, false);
    assert.equal(secondOutput.errors[0].code, "HARNESS_CURRENT_RUN_MISSING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("released pointers stop the hook run resolution that drives blocking", async () => {
  const { root, runDir } = await makeProject();
  try {
    await writeCurrentRunState({ projectRoot: root, runDir, sessionId: "session-hook", now: NOW });
    const { resolveCurrentRunDir } = await import("../src/project/run-state.mjs");

    const before = await resolveCurrentRunDir({ projectRoot: root, sessionId: "session-hook", env: {} });
    assert.equal(before.ok, true);

    await cancelCurrentRun({ projectRoot: root });

    const afterSession = await resolveCurrentRunDir({ projectRoot: root, sessionId: "session-hook", env: {} });
    assert.equal(afterSession.ok, false, "session-scoped hook resolution must miss after cancel");
    const afterLegacy = await resolveCurrentRunDir({ projectRoot: root, env: {} });
    assert.equal(afterLegacy.ok, false, "legacy hook resolution must miss after cancel");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
