import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { decideBlueprintReview, seedBlueprintReview } from "../src/blueprint/review.mjs";
import { writeJsonFile } from "../src/io/json.mjs";
import { withFixture } from "./helpers/fixture.mjs";

function runHarness(args) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });
}

test("canonical fixture reaches Done through the public CLI", async () => {
  await withFixture(async ({ runDir }) => {
    const render = runHarness(["design", "render", runDir]);
    assert.equal(render.status, 0, render.stdout || render.stderr);

    const ready = runHarness(["gate", runDir, "--target", "Ready"]);
    assert.equal(ready.status, 0, ready.stdout || ready.stderr);
    assert.equal(JSON.parse(ready.stdout).ok, true);

    const verify = runHarness(["verify", runDir]);
    assert.equal(verify.status, 0, verify.stdout || verify.stderr);
    assert.equal(JSON.parse(verify.stdout).dashboardRefresh.attempted, true);

    const wiki = runHarness(["wiki", "sync", runDir]);
    assert.equal(wiki.status, 0, wiki.stdout || wiki.stderr);

    const done = runHarness(["gate", runDir, "--target", "Done"]);
    assert.equal(done.status, 0, done.stdout || done.stderr);
    assert.equal(JSON.parse(done.stdout).ok, true);
  });
});

test("public CLI Done gate rejects module signature drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "makeitreal-e2e-signature-"));
  const projectRoot = path.join(root, "project");
  const runDir = path.join(projectRoot, ".makeitreal", "runs", "feature-parser");
  const workItem = {
    schemaVersion: "1.0",
    id: "work.parser",
    lane: "Contract Frozen",
    prdId: "prd.parser",
    responsibilityUnitId: "ru.parser",
    contractIds: ["contract.parser.module"],
    dependsOn: [],
    allowedPaths: ["src/parse-bounded-int.mjs", "test/parse-bounded-int.test.mjs"],
    verificationCommands: [{ file: "node", args: ["-e", "console.log('parser verification ok')"] }],
    doneEvidence: [
      { kind: "verification", path: "evidence/work.parser.verification.json" },
      { kind: "wiki-sync", path: "evidence/work.parser.wiki-sync.json" }
    ],
    prdTrace: { acceptanceCriteriaIds: ["AC-001"] }
  };

  try {
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await mkdir(path.join(projectRoot, "test"), { recursive: true });
    await mkdir(path.join(runDir, "work-items"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "parse-bounded-int.mjs"), `
export function parseBoundedInt(value, min, max) {
  return Number.parseInt(value, 10);
}
`);
    await writeFile(path.join(projectRoot, "test", "parse-bounded-int.test.mjs"), "console.log('test placeholder');\n");
    await writeJsonFile(path.join(runDir, "prd.json"), {
      schemaVersion: "1.0",
      id: "prd.parser",
      title: "Bounded Integer Parser",
      goals: ["Expose a bounded integer parser module."],
      userVisibleBehavior: ["Developers import parseBoundedInt(input, min, max) from the parser module."],
      nonGoals: ["No HTTP API surface."],
      acceptanceCriteria: [{ id: "AC-001", statement: "The parser exposes the declared module signature." }]
    });
    await writeJsonFile(path.join(runDir, "responsibility-units.json"), {
      schemaVersion: "1.0",
      units: [{
        id: "ru.parser",
        owner: "team.parser",
        owns: ["src/parse-bounded-int.mjs", "test/parse-bounded-int.test.mjs"],
        publicSurfaces: ["parseBoundedInt"],
        mayUseContracts: ["contract.parser.module"]
      }]
    });
    await writeJsonFile(path.join(runDir, "design-pack.json"), {
      schemaVersion: "1.0",
      prdId: "prd.parser",
      workItemId: "work.parser",
      architecture: {
        nodes: [{ id: "bounded-int-parser", label: "Bounded Integer Parser", responsibilityUnitId: "ru.parser" }],
        edges: [{ from: "bounded-int-parser", to: "bounded-int-parser", contractId: "contract.parser.module" }]
      },
      stateFlow: {
        lanes: [{ id: "module", label: "Module" }],
        transitions: [{ from: "input", to: "parsed", trigger: "parseBoundedInt" }]
      },
      apiSpecs: [{ kind: "none", contractId: "contract.parser.module", reason: "Module contract." }],
      responsibilityBoundaries: [{
        responsibilityUnitId: "ru.parser",
        owns: ["src/parse-bounded-int.mjs", "test/parse-bounded-int.test.mjs"],
        mayUseContracts: ["contract.parser.module"]
      }],
      moduleInterfaces: [{
        responsibilityUnitId: "ru.parser",
        moduleName: "Bounded Integer Parser",
        owner: "team.parser",
        owns: ["src/parse-bounded-int.mjs", "test/parse-bounded-int.test.mjs"],
        publicSurfaces: [{
          name: "parseBoundedInt",
          kind: "module",
          contractIds: ["contract.parser.module"],
          signature: {
            inputs: [
              { name: "input", type: "string | number", required: true },
              { name: "min", type: "number", required: true },
              { name: "max", type: "number", required: true }
            ],
            outputs: [{ name: "parsed", type: "number" }],
            errors: [{ code: "INTEGER_INVALID", when: "Input or bounds violate the contract.", handling: "Fail fast." }]
          }
        }],
        imports: []
      }],
      callStacks: [{ entrypoint: "parseBoundedInt", calls: ["validate input", "parse integer", "return parsed value"] }],
      sequences: [{
        title: "Parse bounded integer",
        messages: [
          { from: "caller", to: "bounded-int-parser", label: "parseBoundedInt(input, min, max)" },
          { from: "bounded-int-parser", to: "caller", label: "parsed or INTEGER_INVALID" }
        ]
      }]
    });
    await writeJsonFile(path.join(runDir, "work-item-dag.json"), {
      schemaVersion: "1.0",
      runId: "feature-parser",
      nodes: [{ id: "work.parser", kind: "implementation", responsibilityUnitId: "ru.parser", requiredForDone: true }],
      edges: []
    });
    await writeJsonFile(path.join(runDir, "board.json"), {
      schemaVersion: "1.0",
      boardId: "board.parser",
      workItems: [workItem],
      workItemDAG: { nodes: [{ workItemId: "work.parser", kind: "implementation" }], edges: [] }
    });
    await writeJsonFile(path.join(runDir, "work-items", "work.parser.json"), workItem);
    await writeJsonFile(path.join(runDir, "trust-policy.json"), {
      schemaVersion: "1.0",
      runnerMode: "claude-code",
      realAgentLaunch: "enabled",
      approvalPolicy: "never",
      sandbox: "workspace-only",
      commandExecution: "structured-command-only",
      userInputRequired: "fail-fast",
      unsupportedToolCall: "fail-fast"
    });

    const render = runHarness(["design", "render", runDir]);
    assert.equal(render.status, 0, render.stdout || render.stderr);
    await seedBlueprintReview({ runDir, now: new Date("2026-05-18T00:00:00.000Z") });
    const approval = await decideBlueprintReview({
      runDir,
      status: "approved",
      reviewedBy: "operator:e2e",
      now: new Date("2026-05-18T00:00:00.000Z")
    });
    assert.equal(approval.ok, true, JSON.stringify(approval.errors));

    const ready = runHarness(["gate", runDir, "--target", "Ready"]);
    assert.equal(ready.status, 0, ready.stdout || ready.stderr);

    const started = runHarness([
      "orchestrator",
      "native",
      "start",
      runDir,
      "--concurrency",
      "1",
      "--now",
      "2026-05-18T00:00:00.000Z"
    ]);
    assert.equal(started.status, 0, started.stdout || started.stderr);
    const [nativeTask] = JSON.parse(started.stdout).nativeTasks;
    assert.equal(nativeTask.workItemId, "work.parser");

    const finished = runHarness([
      "orchestrator",
      "native",
      "finish",
      runDir,
      "--work",
      nativeTask.workItemId,
      "--attempt",
      nativeTask.attemptId,
      "--summary",
      "Implemented parser fixture.",
      "--changed-file",
      "src/parse-bounded-int.mjs",
      "--tested",
      "node -e parser fixture",
      "--review",
      "spec-reviewer=APPROVED",
      "--review",
      "quality-reviewer=APPROVED",
      "--review",
      "verification-reviewer=APPROVED",
      "--now",
      "2026-05-18T00:00:01.000Z"
    ]);
    assert.equal(finished.status, 0, finished.stdout || finished.stderr);

    const completed = runHarness([
      "orchestrator",
      "complete",
      runDir,
      "--work",
      nativeTask.workItemId,
      "--runner",
      "claude-code",
      "--now",
      "2026-05-18T00:00:02.000Z"
    ]);
    const errors = JSON.parse(completed.stdout).errors;
    assert.equal(completed.status, 1);
    assert.equal(errors.some((error) => error.code === "HARNESS_MODULE_SIGNATURE_MISMATCH"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
