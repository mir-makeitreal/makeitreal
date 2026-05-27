import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

    // Create a minimal BlueprintProposal JSON for import via CLI
    const proposal = {
      intent: {
        title: "Timestamp Smoke Module",
        summary: "Build a small timestamp smoke module",
        goals: ["Deliver timestamp smoke module."],
        userVisibleBehavior: ["Module works."],
        acceptanceCriteria: [{ id: "AC-001", statement: "Module works." }],
        nonGoals: ["Nothing out of scope."]
      },
      architecture: {
        nodes: [{ id: "ru.timestamp-smoke", label: "Timestamp Smoke", responsibilityUnitId: "ru.timestamp-smoke" }],
        edges: []
      },
      responsibilityUnits: [{
        id: "ru.timestamp-smoke",
        label: "Timestamp Smoke",
        owner: "team.implementation",
        owns: ["src/timestamp-smoke/**"],
        mustProvideContracts: ["contract.timestamp-smoke"],
        mayUseContracts: [],
        publicSurfaces: [{
          name: "timestampSmoke",
          kind: "module",
          contractIds: ["contract.timestamp-smoke"],
          signature: {
            inputs: [{ name: "input", type: "string" }],
            outputs: [{ name: "result", type: "string" }],
            errors: [{ code: "SMOKE_ERROR", when: "Invalid input." }]
          }
        }],
        responsibility: "Timestamp smoke module."
      }],
      contracts: [{ contractId: "contract.timestamp-smoke", kind: "none", title: "Timestamp Smoke Contract" }],
      workItems: [{
        id: "wi.timestamp-smoke",
        title: "Timestamp Smoke",
        responsibilityUnitId: "ru.timestamp-smoke",
        contractIds: ["contract.timestamp-smoke"],
        dependsOn: [],
        allowedPaths: ["src/timestamp-smoke/**"],
        acceptanceCriteriaIds: ["AC-001"],
        verificationCommands: [{ command: { file: "node", args: ["-e", "console.log('ok')"] }, purpose: "Verify" }],
        kind: "implementation"
      }],
      sequences: [{
        title: "Timestamp smoke call",
        participants: ["Caller", "TimestampSmoke"],
        steps: [
          { from: "Caller", to: "TimestampSmoke", action: "timestampSmoke(input)" },
          { from: "TimestampSmoke", to: "Caller", action: "returns result" }
        ]
      }]
    };

    const runDir = path.join(projectRoot, ".makeitreal", "runs", "timestamp-smoke");

    // Step 1: Import blueprint via CLI (reads from stdin)
    const importResult = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "blueprint",
      "import",
      runDir
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env,
      input: JSON.stringify(proposal)
    });
    assert.equal(importResult.status, 0, importResult.stderr || importResult.stdout);

    // Step 2: Setup to write current-run.json with wall-clock time
    const setupResult = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "setup",
      projectRoot,
      "--run",
      runDir
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      env
    });
    assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

    const after = Date.now() + 1000;

    const state = JSON.parse(await readFile(path.join(projectRoot, ".makeitreal", "current-run.json"), "utf8"));
    const updatedAtMs = Date.parse(state.updatedAt);
    assert.equal(updatedAtMs >= before, true);
    assert.equal(updatedAtMs <= after, true);
    assert.notEqual(state.updatedAt, "2026-04-30T00:00:00.000Z");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
