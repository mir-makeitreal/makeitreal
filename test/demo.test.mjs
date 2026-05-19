import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runDemo, listTemplates } from "../src/demo/demo-runner.mjs";
import { readJsonFile } from "../src/io/json.mjs";

const NOW = new Date("2026-05-19T00:00:00.000Z");

function runHarness(args) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });
}

test("listTemplates returns three templates", () => {
  const templates = listTemplates();
  assert.equal(templates.length, 3);
  const names = templates.map((t) => t.name);
  assert.deepEqual(names, ["todo-app", "rest-api", "auth-system"]);
  assert.equal(templates[0].complexity, "simple");
  assert.equal(templates[1].complexity, "medium");
  assert.equal(templates[2].complexity, "complex");
});

test("demo generates valid artifacts with todo-app template", async () => {
  const result = await runDemo({ template: "todo-app", now: NOW });
  try {
    assert.equal(result.ok, true, `Demo failed: ${JSON.stringify(result.errors)}`);
    assert.equal(result.command, "demo");
    assert.equal(result.template, "todo-app");
    assert.equal(result.complexity, "simple");
    assert.ok(result.runDir);
    assert.ok(result.projectRoot);
    assert.ok(result.runId);
    assert.ok(result.dashboardUrl);

    // Verify artifacts exist
    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.equal(prd.schemaVersion, "1.0");
    assert.ok(prd.title.length > 0);
    assert.ok(prd.goals.length > 0);

    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.equal(designPack.schemaVersion, "1.0");
    assert.ok(designPack.architecture.nodes.length > 0);

    const board = await readJsonFile(path.join(result.runDir, "board.json"));
    assert.ok(board.workItems.length > 0);
  } finally {
    if (result.projectRoot) {
      await rm(result.projectRoot, { recursive: true, force: true });
    }
  }
});

test("demo generates valid artifacts with rest-api template", async () => {
  const result = await runDemo({ template: "rest-api", now: NOW });
  try {
    assert.equal(result.ok, true, `Demo failed: ${JSON.stringify(result.errors)}`);
    assert.equal(result.template, "rest-api");
    assert.equal(result.complexity, "medium");
    assert.ok(result.runDir);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.ok(prd.request.includes("REST API"));
  } finally {
    if (result.projectRoot) {
      await rm(result.projectRoot, { recursive: true, force: true });
    }
  }
});

test("demo generates valid artifacts with auth-system template", async () => {
  const result = await runDemo({ template: "auth-system", now: NOW });
  try {
    assert.equal(result.ok, true, `Demo failed: ${JSON.stringify(result.errors)}`);
    assert.equal(result.template, "auth-system");
    assert.equal(result.complexity, "complex");
    assert.ok(result.runDir);

    const prd = await readJsonFile(path.join(result.runDir, "prd.json"));
    assert.ok(prd.request.includes("authentication"));
    const board = await readJsonFile(path.join(result.runDir, "board.json"));
    assert.ok(board.workItems.length > 1, "auth-system demo should generate multiple work items");
    const designPack = await readJsonFile(path.join(result.runDir, "design-pack.json"));
    assert.ok(designPack.apiSpecs.length > 1, "auth-system demo should declare multiple contracts");
    const dag = await readJsonFile(path.join(result.runDir, "work-item-dag.json"));
    assert.ok(dag.nodes.length > 1, "auth-system demo should generate a multi-node DAG");
    assert.ok(dag.edges.length > 0, "auth-system demo should generate dependency edges");
    assert.ok(dag.edges.some((edge) => edge.kind === "contract-dependency"));
  } finally {
    if (result.projectRoot) {
      await rm(result.projectRoot, { recursive: true, force: true });
    }
  }
});

test("demo passes Ready gate (pending Blueprint approval expected)", async () => {
  const result = await runDemo({ template: "todo-app", now: NOW });
  try {
    assert.equal(result.ok, true, `Demo failed: ${JSON.stringify(result.errors)}`);
    // planOk should be true (blueprint seeded, preview ok, ready gate passes modulo approval)
    assert.equal(result.planOk, true);
    // implementationReady is false until blueprint is approved
    assert.equal(result.implementationReady, false);
    // Ready gate should have approval-pending error
    const approvalErrors = result.errors.filter((e) => e.code === "HARNESS_BLUEPRINT_APPROVAL_PENDING");
    assert.ok(approvalErrors.length > 0, "Expected HARNESS_BLUEPRINT_APPROVAL_PENDING error");
  } finally {
    if (result.projectRoot) {
      await rm(result.projectRoot, { recursive: true, force: true });
    }
  }
});

test("demo rejects unknown template", async () => {
  const result = await runDemo({ template: "nonexistent", now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_DEMO_TEMPLATE_UNKNOWN");
  assert.deepEqual(result.availableTemplates, ["todo-app", "rest-api", "auth-system"]);
});

test("demo CLI command works", () => {
  const result = runHarness(["demo", "todo-app", "--now", "2026-05-19T00:00:00.000Z"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "demo");
  assert.equal(output.template, "todo-app");
});

test("demo list CLI command works", () => {
  const result = runHarness(["demo", "list"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.templates.length, 3);
});

test("demo default template is rest-api", () => {
  const result = runHarness(["demo", "--now", "2026-05-19T00:00:00.000Z"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.template, "rest-api");
});
