import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { generatePlanRun } from "../src/plan/plan-generator.mjs";
import { readCurrentRunState, writeCurrentRunState } from "../src/project/run-state.mjs";
import { readJsonFile } from "../src/io/json.mjs";

test("plan generator creates a reviewable run packet with pending Blueprint approval", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dashboard widget with summary metrics",
      runId: "summary-widget",
      allowedPaths: ["modules/summary-widget/**"],
      owner: "team.frontend",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('summary widget ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.planOk, true);
    assert.equal(result.implementationReady, false);
    assert.equal(result.currentRunUpdated, true);
    assert.equal(result.readyGate.ok, false);
    assert.equal(result.readyGate.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_PENDING"), true);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.equal(prd.goals.length > 0, true);
    assert.equal(prd.userVisibleBehavior.length > 0, true);
    assert.equal(prd.acceptanceCriteria.every((criterion) => criterion.id && criterion.statement), true);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.apiSpecs[0].kind, "none");
    assert.equal(designPack.apiSpecs[0].contractId, result.contractId);
    assert.equal(designPack.architecture.edges[0].contractId, result.contractId);

    const responsibilityUnits = await readJsonFile(path.join(result.runDir, "responsibility-units.json"));
    assert.equal(responsibilityUnits.units.length, 1);
    assert.equal(responsibilityUnits.units[0].owner, "team.frontend");

    const workItem = await readJsonFile(path.join(result.runDir, "work-items", "work.summary-widget.json"));
    assert.equal(workItem.title, "Build a dashboard widget with summary metrics");
    assert.deepEqual(workItem.dependsOn, []);
    assert.deepEqual(workItem.prdTrace.acceptanceCriteriaIds, ["AC-001", "AC-002", "AC-003", "AC-004"]);
    assert.deepEqual(workItem.doneEvidence, [
      { kind: "verification", path: "evidence/work.summary-widget.verification.json" },
      { kind: "wiki-sync", path: "evidence/work.summary-widget.wiki-sync.json" }
    ]);

    const board = await readJsonFile(path.join(result.runDir, "board.json"));
    assert.equal(board.boardId, "board.summary-widget");
    assert.equal(board.blueprintRunDir, ".");
    assert.equal(board.workItems.length, 1);
    assert.equal(board.workItems[0].id, "work.summary-widget");
    assert.equal(board.workItems[0].lane, "Contract Frozen");

    const trustPolicy = await readJsonFile(path.join(result.runDir, "trust-policy.json"));
    assert.equal(trustPolicy.runnerMode, "scripted-simulator");
    assert.equal(trustPolicy.realAgentLaunch, "disabled");

    const runtimeState = await readJsonFile(path.join(result.runDir, "runtime-state.json"));
    assert.equal(runtimeState.boardId, "board.summary-widget");
    assert.deepEqual(runtimeState.running, {});

    const review = await readJsonFile(path.join(result.runDir, "blueprint-review.json"));
    assert.equal(review.status, "pending");
    assert.equal(review.reviewSource, "makeitreal:plan");

    const current = await readCurrentRunState(projectRoot);
    assert.equal(current.ok, true);
    assert.equal(current.runDir, result.runDir);

    const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
    assert.match(gitignore, /^\/\.makeitreal\/$/m);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator blocks plan and current-run updates without a real verification plan", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dashboard widget with summary metrics",
      runId: "summary-widget",
      allowedPaths: ["modules/summary-widget/**"],
      owner: "team.frontend",
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    await writeCurrentRunState({
      projectRoot,
      runDir: "/previous/run",
      source: "test",
      now: new Date("2026-05-05T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.currentRunUpdated, false);
    assert.equal(result.currentRun, null);
    assert.equal(result.readyGate.ok, false);
    assert.equal(result.readyGate.errors.some((error) => error.code === "HARNESS_VERIFICATION_PLAN_MISSING"), true);
    const current = await readCurrentRunState(projectRoot);
    assert.equal(current.runDir, "/previous/run");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator writes OpenAPI contract for API-shaped requests", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a REST API endpoint for invoice search",
      runId: "invoice-search-api",
      apiKind: "openapi",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('invoice api ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.planOk, true);
    assert.equal(result.implementationReady, false);
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.apiSpecs[0].kind, "openapi");

    const openapi = await readJsonFile(path.join(result.runDir, "contracts", "invoice-search-api.openapi.json"));
    assert.equal(openapi.openapi, "3.1.0");
    assert.ok(openapi.paths["/invoice-search-api"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator can prepare a Claude Code launch trust policy", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dependency-free slug stats module",
      runId: "slug-stats",
      allowedPaths: ["modules/slug-stats/**"],
      runnerMode: "claude-code",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('slug stats ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, true);
    assert.equal(result.planOk, true);
    assert.equal(result.implementationReady, false);
    const trustPolicy = await readJsonFile(path.join(result.runDir, "trust-policy.json"));
    assert.equal(trustPolicy.runnerMode, "claude-code");
    assert.equal(trustPolicy.realAgentLaunch, "enabled");
    assert.equal(trustPolicy.commandExecution, "structured-command-only");
    assert.equal(trustPolicy.userInputRequired, "fail-fast");
    assert.equal(trustPolicy.unsupportedToolCall, "fail-fast");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator rejects unsupported runner modes before writing a run", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dependency-free slug stats module",
      runId: "slug-stats",
      runnerMode: "browser-button",
      verificationCommands: [{ file: "node", args: ["-e", "console.log('slug stats ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.errors[0].code, "HARNESS_RUNNER_MODE_UNSUPPORTED");
    assert.equal(result.runDir, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator fails fast on obvious multi-domain requests without explicit boundaries", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a frontend UI and backend API with a database migration",
      runId: "full-stack-work",
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.errors[0].code, "HARNESS_RESPONSIBILITY_BOUNDARY_AMBIGUOUS");
    assert.equal(result.runDir, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan generator rejects unsafe allowed path patterns", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-"));
  try {
    const result = await generatePlanRun({
      projectRoot,
      request: "Build a dashboard widget with summary metrics",
      runId: "unsafe-path",
      allowedPaths: ["../outside/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('ok')"] }],
      now: new Date("2026-05-06T00:00:00.000Z")
    });

    assert.equal(result.ok, false);
    assert.equal(result.planOk, false);
    assert.equal(result.errors[0].code, "HARNESS_ALLOWED_PATH_INVALID");
    assert.equal(result.runDir, null);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("plan command creates artifacts through the internal CLI", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "makeitreal-plan-cli-"));
  try {
    const result = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "plan",
      projectRoot,
      "--request",
      "Build a billing export module",
      "--run",
      "billing-export",
      "--allowed-path",
      "modules/billing-export/**",
      "--runner",
      "claude-code",
      "--verify",
      JSON.stringify({ file: "node", args: ["-e", "console.log('billing export ok')"] })
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stdout || result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.command, "plan");
    assert.equal(output.ok, true);
    assert.equal(output.planOk, true);
    assert.equal(output.implementationReady, false);
    assert.equal(output.readyGate.ok, false);
    assert.equal(output.readyGate.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_PENDING"), true);
    assert.equal(output.runId, "billing-export");
    const trustPolicy = await readJsonFile(path.join(output.runDir, "trust-policy.json"));
    assert.equal(trustPolicy.runnerMode, "claude-code");
    assert.equal(trustPolicy.realAgentLaunch, "enabled");
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
