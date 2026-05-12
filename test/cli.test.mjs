import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("CLI help lists the supported commands", () => {
  const result = spawnSync(process.execPath, ["bin/harness.mjs", "--help"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /makeitreal-engine \(internal\)/);
  assert.match(result.stdout, /Internal commands used by Make It Real skills/);
  assert.match(result.stdout, /design render/);
  assert.match(result.stdout, /gate/);
  assert.match(result.stdout, /verify/);
  assert.match(result.stdout, /config get/);
  assert.match(result.stdout, /doctor <projectRoot>/);
  assert.match(result.stdout, /wiki sync/);
  assert.match(result.stdout, /--runner scripted-simulator\|claude-code/);
});

test("CLI exposes engine version for install diagnostics", () => {
  const result = spawnSync(process.execPath, ["bin/harness.mjs", "--version"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "version");
  assert.match(output.version, /^\d+\.\d+\.\d+/);
});

test("CLI uses wall-clock timestamps unless --now is supplied", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-cli-now-"));
  const env = { ...process.env };
  delete env.MAKEITREAL_NOW;

  try {
    const before = Date.now() - 1000;
    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "plan",
      projectRoot,
      "--request",
      "Build a small timestamp smoke module",
      "--verify",
      JSON.stringify({ file: "node", args: ["-e", "console.log('ok')"] })
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env
    });
    const after = Date.now() + 1000;

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const state = JSON.parse(await readFile(path.join(projectRoot, ".makeitreal", "current-run.json"), "utf8"));
    const updatedAtMs = Date.parse(state.updatedAt);
    assert.equal(updatedAtMs >= before, true);
    assert.equal(updatedAtMs <= after, true);
    assert.notEqual(state.updatedAt, "2026-04-30T00:00:00.000Z");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
