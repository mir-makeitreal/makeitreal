import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { runVerification } from "../src/adapters/command-evidence.mjs";
import { BOARD_VERIFICATION_PRODUCER, hashCommand } from "../src/domain/verification-command.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { renderDesignPreview } from "../src/preview/render-preview.mjs";
import { withFixture } from "./helpers/fixture.mjs";
import { approveRun } from "./helpers/blueprint.mjs";

test("Ready gate requires rendered preview", async () => {
  await withFixture(async ({ runDir }) => {
    const result = spawnSync(process.execPath, ["bin/harness.mjs", "gate", runDir, "--target", "Ready"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).errors[0].code, "HARNESS_PREVIEW_MISSING");
  });
});

test("Ready gate passes after preview render", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    const result = spawnSync(process.execPath, ["bin/harness.mjs", "gate", runDir, "--target", "Ready"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).ok, true);
  });
});

test("Done gate requires verification and wiki evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    await rm(path.join(runDir, "evidence"), { recursive: true, force: true });
    const result = spawnSync(process.execPath, ["bin/harness.mjs", "gate", runDir, "--target", "Done"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).errors[0].code, "HARNESS_EVIDENCE_MISSING");
  });
});

test("Done gate rejects failed verification evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.verificationCommands = [{ file: "node", args: ["-e", "process.exit(2)"] }];
    await writeJsonFile(workItemPath, workItem);
    await approveRun(runDir);
    await runVerification({ runDir });
    await writeJsonFile(path.join(runDir, "evidence", "wiki-sync.json"), {
      kind: "wiki-sync",
      workItemId: "work.feature-auth",
      outputPath: "manual"
    });

    const result = spawnSync(process.execPath, ["bin/harness.mjs", "gate", runDir, "--target", "Done"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).errors[0].code, "HARNESS_VERIFICATION_FAILED");
  });
});

test("Done gate rejects forged verification evidence for a different command", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    await runVerification({ runDir });
    const evidencePath = path.join(runDir, "evidence", "verification.json");
    const evidence = await readJsonFile(evidencePath);
    evidence.commandHashes = ["forged"];
    await writeJsonFile(evidencePath, evidence);
    await writeJsonFile(path.join(runDir, "evidence", "wiki-sync.json"), {
      kind: "wiki-sync",
      workItemId: "work.feature-auth",
      outputPath: "manual"
    });

    const result = spawnSync(process.execPath, ["bin/harness.mjs", "gate", runDir, "--target", "Done"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).errors[0].code, "HARNESS_VERIFICATION_FAILED");
  });
});

test("Done gate accepts work item scoped board completion evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.doneEvidence = [
      { kind: "verification", path: `evidence/${workItem.id}.verification.json` },
      { kind: "wiki-sync", path: `evidence/${workItem.id}.wiki-sync.json` }
    ];
    await writeJsonFile(workItemPath, workItem);
    await approveRun(runDir);

    await writeJsonFile(path.join(runDir, "evidence", `${workItem.id}.verification.json`), {
      producer: BOARD_VERIFICATION_PRODUCER,
      kind: "board-verification",
      ok: true,
      workItemId: workItem.id,
      commandHashes: workItem.verificationCommands.map(hashCommand),
      commands: workItem.verificationCommands.map((command) => ({
        command,
        commandHash: hashCommand(command),
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 1
      }))
    });
    await writeJsonFile(path.join(runDir, "evidence", `${workItem.id}.wiki-sync.json`), {
      kind: "board-wiki-sync",
      workItemId: workItem.id,
      outputPath: "wiki/live/work.feature-auth.md"
    });

    const result = spawnSync(process.execPath, ["bin/harness.mjs", "gate", runDir, "--target", "Done"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).ok, true);
  });
});

test("Ready gate rejects PRD and responsibility boundary drift", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    const designPackPath = path.join(runDir, "design-pack.json");
    const designPack = await readJsonFile(designPackPath);
    designPack.prdId = "prd.drifted";
    await writeJsonFile(designPackPath, designPack);

    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJsonFile(workItemPath);
    workItem.prdTrace.acceptanceCriteriaIds = ["AC-001"];
    workItem.allowedPaths = ["../outside/**"];
    await writeJsonFile(workItemPath, workItem);

    const result = spawnSync(process.execPath, ["bin/harness.mjs", "gate", runDir, "--target", "Ready"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    const codes = JSON.parse(result.stdout).errors.map((error) => error.code);
    assert.equal(result.status, 1);
    assert.equal(codes.includes("HARNESS_PRD_DESIGN_DRIFT"), true);
    assert.equal(codes.includes("HARNESS_PRD_TRACE_INCOMPLETE"), true);
    assert.equal(codes.includes("HARNESS_ALLOWED_PATH_INVALID"), true);
  });
});
