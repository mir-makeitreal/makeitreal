import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decideBlueprintReview, seedBlueprintReview } from "../src/blueprint/review.mjs";
import { writeJsonFile } from "../src/io/json.mjs";
import { orchestratorTick, reconcileBoard } from "../src/orchestrator/orchestrator.mjs";
import { importBlueprint, minimalProposal } from "./helpers/blueprint-import.mjs";
import { renderDesignPreview } from "../src/preview/render-preview.mjs";
import { writeCurrentRunState } from "../src/project/run-state.mjs";
import { readEvidenceSummary } from "../src/status/operator-summary.mjs";
import { withFixture } from "./helpers/fixture.mjs";

function runHarness(args) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });
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

test("status reports pending approval and exits zero for readable blocked runs", async () => {
  await withFixture(async ({ root, runDir }) => {
    await renderDesignPreview({ runDir });
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeCurrentRunState({ projectRoot: root, runDir, now: new Date("2026-05-06T00:00:00.000Z") });

    const watched = [
      path.join(root, ".makeitreal", "current-run.json"),
      path.join(runDir, "blueprint-review.json")
    ];
    const before = await snapshot(watched);
    const result = runHarness(["status", root]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.blueprint.status, "pending");
    assert.equal(output.phase, "approval-required");
    assert.equal(output.blueprintStatus, "pending");
    assert.equal(output.blockers[0].code, "HARNESS_BLUEPRINT_APPROVAL_PENDING");
    assert.equal(output.blockers[0].nextActionCode, "approve");
    assert.equal(output.gateAudit.ok, false);
    assert.equal(output.nextCommand, "/makeitreal:plan approve");
    assert.equal(output.nextActionCode, "approve");
    assert.equal(output.dashboardRefresh.attempted, true);
    assert.equal(output.dashboardRefresh.skipped, false);
    assert.deepEqual(await snapshot(watched), before);
  });
});

test("status accepts explicit run override without setup current-run state", async () => {
  await withFixture(async ({ root, runDir }) => {
    await renderDesignPreview({ runDir });

    const result = runHarness(["status", root, "--run", runDir]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.runDir, runDir);
  });
});

test("status marks stale generic verification failure as superseded after work-item evidence passes", async () => {
  await withFixture(async ({ runDir }) => {
    await writeJsonFile(path.join(runDir, "evidence", "verification.json"), {
      kind: "verification",
      ok: false,
      commands: [{ exitCode: 1 }]
    });
    await writeJsonFile(path.join(runDir, "evidence", "work.feature-auth.verification.json"), {
      kind: "board-verification",
      ok: true,
      workItemId: "work.feature-auth",
      commands: [{ exitCode: 0 }]
    });

    const summary = await readEvidenceSummary(runDir);
    const generic = summary.find((item) => item.path === "evidence/verification.json");
    assert.equal(generic.superseded, true);
    assert.equal(generic.ok, null);
  });
});

test("status reports explicit dashboard refresh skip when configured off", async () => {
  await withFixture(async ({ root, runDir }) => {
    await renderDesignPreview({ runDir });
    await writeCurrentRunState({ projectRoot: root, runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    await writeJsonFile(path.join(root, ".makeitreal", "config.json"), {
      schemaVersion: "1.1",
      features: {
        liveWiki: { enabled: true },
        dashboard: {
          refreshOnStatus: false,
          refreshOnLaunch: true,
          refreshOnVerify: true
        }
      }
    });
    const previewFile = path.join(runDir, "preview", "index.html");
    const before = await snapshot([previewFile]);

    const result = runHarness(["status", root]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.dashboardRefresh.attempted, false);
    assert.equal(output.dashboardRefresh.skipped, true);
    assert.match(output.dashboardRefresh.reason, /disabled/);
    assert.deepEqual(await snapshot([previewFile]), before);
  });
});

test("status reports rejected Blueprint with replan command", async () => {
  await withFixture(async ({ root, runDir }) => {
    await renderDesignPreview({ runDir });
    await writeCurrentRunState({ projectRoot: root, runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const rejection = await decideBlueprintReview({
      runDir,
      status: "rejected",
      reviewedBy: "operator:test",
      note: "Revise the responsibility boundary.",
      now: new Date("2026-05-06T00:00:01.000Z")
    });
    assert.equal(rejection.ok, true);

    const result = runHarness(["status", root]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.blueprint.status, "rejected");
    assert.equal(output.phase, "blocked");
    assert.equal(output.blueprintStatus, "rejected");
    assert.equal(output.nextActionCode, "plan");
    assert.equal(output.nextCommand, "/makeitreal:plan <request>");
    assert.equal(output.blockers[0].nextActionCode, "plan");
  });
});

test("status reports stale approval separately from missing approval", async () => {
  await withFixture(async ({ root, runDir }) => {
    await renderDesignPreview({ runDir });
    await writeCurrentRunState({ projectRoot: root, runDir, now: new Date("2026-05-06T00:00:00.000Z") });

    // The status surface only treats Ready-lane items as launchable; move the
    // fixture work item to Ready so the approved board projects launch-ready.
    const boardPath = path.join(runDir, "board.json");
    const board = JSON.parse(await readFile(boardPath, "utf8"));
    for (const item of board.workItems) {
      item.lane = "Ready";
    }
    await writeJsonFile(boardPath, board);

    let result = runHarness(["status", root]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    let output = JSON.parse(result.stdout);
    assert.equal(output.blueprint.status, "approved");
    assert.equal(output.phase, "launch-ready");
    assert.equal(output.blueprintStatus, "approved");
    assert.equal(output.nextActionCode, "launch");

    const designPackPath = path.join(runDir, "design-pack.json");
    const designPack = JSON.parse(await readFile(designPackPath, "utf8"));
    designPack.callStacks.push({ entrypoint: "Status.audit", calls: ["detect stale"] });
    await cp(designPackPath, `${designPackPath}.bak`);
    await writeJsonFile(designPackPath, designPack);

    result = runHarness(["status", root]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.blueprint.status, "stale");
    assert.equal(output.phase, "blocked");
    assert.equal(output.blueprintStatus, "stale");
    assert.equal(output.blockers[0].nextActionCode, "approve");

    await rm(path.join(runDir, "blueprint-review.json"), { force: true });
    result = runHarness(["status", root]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    output = JSON.parse(result.stdout);
    assert.equal(output.blueprint.status, "missing");
    assert.equal(output.phase, "approval-required");
  });
});

test("status reports current-run missing without failing the operator command", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-status-missing-"));
  try {
    const result = runHarness(["status", projectRoot]);
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.errors[0].code, "HARNESS_CURRENT_RUN_MISSING");
    assert.equal(output.phase, "planning-required");
    assert.equal(output.nextActionCode, "plan");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("status projects board recovery phases through the public current-run surface", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-status-board-"));
  try {
    const plan = await importBlueprint({
      projectRoot,
      proposal: minimalProposal({
        title: "Retryable Report Module",
        workItemId: "wi.retryable-report",
        ruId: "ru.retryable-report",
        owner: "team.reports",
        allowedPaths: ["modules/retryable-report/**"],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('retryable report ok')"] }]
      }),
      runId: "retryable-report",
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    assert.equal(plan.ok, true);

    const approval = await decideBlueprintReview({
      runDir: plan.runDir,
      status: "approved",
      reviewedBy: "operator:test",
      now: new Date("2026-05-06T00:00:01.000Z")
    });
    assert.equal(approval.ok, true);

    // The read-only status surface no longer auto-promotes Contract Frozen
    // items. They remain non-launchable until the orchestrator's Ready gate
    // flow promotes them, so the pre-launch projection is "blocked".
    let status = runHarness(["status", projectRoot]);
    assert.equal(status.status, 0, status.stdout || status.stderr);
    assert.equal(JSON.parse(status.stdout).phase, "blocked");
    assert.deepEqual(JSON.parse(status.stdout).boardStatus.launchableWorkItemIds, []);
    assert.equal(JSON.parse(status.stdout).boardStatus.recommendedNativeTaskConcurrency, 0);

    const failed = await orchestratorTick({
      boardDir: plan.runDir,
      workerId: "worker.test",
      concurrency: 1,
      now: new Date("2026-05-06T00:00:02.000Z"),
      runnerScript: ["session_started", "turn_failed"]
    });
    assert.equal(failed.ok, true);
    assert.deepEqual(failed.promotedWorkItemIds, [plan.workItemId]);
    assert.deepEqual(failed.retryWorkItemIds, [plan.workItemId]);

    status = runHarness(["status", projectRoot, "--now", "2026-05-06T00:00:02.000Z"]);
    assert.equal(status.status, 0, status.stdout || status.stderr);
    let output = JSON.parse(status.stdout);
    assert.equal(output.phase, "failed-fast");
    assert.equal(output.nextActionCode, "status");
    assert.equal(output.boardStatus.failedFast[0].id, plan.workItemId);
    assert.equal(output.boardStatus.failedFast[0].errorCode, "HARNESS_RUNNER_FAILED");
    assert.equal(output.boardStatus.failedFast[0].errorCategory, null);

    const reconciled = await reconcileBoard({
      boardDir: plan.runDir,
      now: new Date("2026-05-06T00:00:04.000Z")
    });
    assert.equal(reconciled.ok, true);
    assert.deepEqual(reconciled.retryReadyWorkItemIds, [plan.workItemId]);

    status = runHarness(["status", projectRoot, "--now", "2026-05-06T00:00:04.000Z"]);
    assert.equal(status.status, 0, status.stdout || status.stderr);
    output = JSON.parse(status.stdout);
    assert.equal(output.phase, "launch-ready");
    assert.equal(output.nextActionCode, "launch");
    assert.deepEqual(output.boardStatus.launchableWorkItemIds, [plan.workItemId]);
    assert.equal(output.operatorSummary.responsibilityUnitCount, 1);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
