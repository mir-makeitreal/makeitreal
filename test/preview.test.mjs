import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { decideBlueprintReview } from "../src/blueprint/review.mjs";
import { generatePlanRun } from "../src/plan/plan-generator.mjs";
import { buildOperatorCockpitModel } from "../src/preview/operator-cockpit-model.mjs";
import { renderDesignPreview } from "../src/preview/render-preview.mjs";
import { fileExists, readJsonFile } from "../src/io/json.mjs";
import { withFixture } from "./helpers/fixture.mjs";

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

test("operator cockpit maps phases to a read-only first-run guide", () => {
  const cockpit = buildOperatorCockpitModel({
    status: {
      phase: "approval-required",
      blueprintStatus: "pending",
      headline: "Blueprint review is pending.",
      nextAction: "Answer the Blueprint review question, or reply in chat with approval, requested changes, or rejection.",
      nextCommand: "/makeitreal:plan approve",
      evidenceSummary: [
        {
          kind: "verification",
          summary: "Verification passed",
          path: "evidence/verification.json"
        }
      ]
    }
  });

  assert.equal(cockpit.readOnly, true);
  assert.equal(cockpit.controlSurface, "claude-code");
  assert.equal(cockpit.phase, "approval-required");
  assert.equal(cockpit.blueprintStatus, "pending");
  assert.equal(cockpit.nextCommand, "/makeitreal:plan approve");
  assert.deepEqual(
    cockpit.firstRunChecklist.map((step) => [step.id, step.status]),
    [
      ["plugin", "complete"],
      ["plan", "complete"],
      ["blueprint-review", "current"],
      ["launch", "pending"],
      ["verification", "pending"],
      ["done", "pending"]
    ]
  );
  assert.deepEqual(cockpit.evidenceLinks, [
    {
      kind: "verification",
      summary: "Verification passed",
      path: "evidence/verification.json",
      href: "../evidence/verification.json"
    }
  ]);
});

test("renders canonical architecture preview", async () => {
  await withFixture(async ({ runDir }) => {
    const watched = [
      path.join(runDir, "prd.json"),
      path.join(runDir, "design-pack.json"),
      path.join(runDir, "responsibility-units.json"),
      path.join(runDir, "blueprint-review.json"),
      path.join(runDir, "contracts", "auth-login.openapi.json"),
      path.join(runDir, "work-items", "work.feature-auth.json"),
      path.join(runDir, "evidence", "verification.json"),
      path.join(runDir, "runtime-state.json")
    ];
    const before = await snapshot(watched);
    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);
    assert.match(result.dashboardRefresh.dashboardUrl, /^file:\/\//);
    assert.equal(result.dashboardRefresh.indexPath, path.join(runDir, "preview", "index.html"));
    assert.deepEqual(await snapshot(watched), before);

    const previewDir = path.join(runDir, "preview");
    assert.equal(await fileExists(path.join(previewDir, "index.html")), true);
    assert.equal(await fileExists(path.join(previewDir, "preview.css")), true);
    assert.equal(await fileExists(path.join(previewDir, "preview.js")), true);
    assert.equal((await readJsonFile(path.join(previewDir, "design-pack.json"))).workItemId, "work.feature-auth");
    assert.equal((await readJsonFile(path.join(previewDir, "preview-meta.json"))).statusSource, "readRunStatus/readBoardStatus");
    assert.equal((await readJsonFile(path.join(previewDir, "operator-status.json"))).runStatus.blueprintStatus, "approved");

    const previewModel = await readJsonFile(path.join(previewDir, "preview-model.json"));
    assert.equal(previewModel.blueprint.title, "Authentication vertical slice");
    assert.deepEqual(previewModel.blueprint.summary, [
      "A user can submit credentials through the auth UI and receive a session result from the declared auth login contract."
    ]);
    assert.equal(previewModel.blueprint.primaryContract.contractId, "contract.auth.login");
    assert.equal(previewModel.blueprint.contracts[0].path, "contracts/auth-login.openapi.json");
    assert.equal(previewModel.blueprint.boundaries[0].responsibilityUnitId, "ru.frontend");
    assert.equal(previewModel.blueprint.acceptanceCriteria[0].id, "AC-001");

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    for (const label of [
      "Blueprint Reference",
      "What Will Be Delivered",
      "API / Interface Specs",
      "Responsibility Boundaries",
      "Sequence & Call Stack",
      "Acceptance Evidence",
      "Raw Artifacts",
      "Runtime Snapshot"
    ]) {
      assert.match(html, new RegExp(label));
    }
    assert.doesNotMatch(html, /<h2>Kanban Board<\/h2>/);
    assert.match(html, /Read-only dashboard/);
    assert.match(html, /data-read-only-cockpit="true"/);
    assert.match(html, /\/makeitreal:status/);
    assert.match(html, /copy-command/);
    assert.doesNotMatch(html, /data-harness-action=/);
    assert.doesNotMatch(html, /makeitreal-engine blueprint approve/);
    assert.doesNotMatch(html, /makeitreal-engine orchestrator tick/);

    const js = await readFile(path.join(previewDir, "preview.js"), "utf8");
    assert.match(js, /makeitreal:auto-reload/);
    assert.match(js, /preview-model\.json/);
    assert.match(js, /location\.reload/);
    assert.match(js, /window\.location\.protocol/);
    assert.match(js, /"file:"/);
    assert.match(js, /navigator\.clipboard\.writeText/);
    assert.match(js, /copy-command/);
    assert.doesNotMatch(js, /makeitreal-engine/);
    assert.doesNotMatch(js, /fetch\([^)]*blueprint/);
    assert.doesNotMatch(js, /fetch\([^)]*orchestrator/);

    const css = await readFile(path.join(previewDir, "preview.css"), "utf8");
    assert.match(css, /\.doc-shell/);
    assert.match(css, /\.doc-nav/);
    assert.match(css, /\.status-rail/);
    assert.match(css, /\.compact-kanban/);
  });
});

test("preview cockpit copies replan command for rejected Blueprint", async () => {
  await withFixture(async ({ root, runDir }) => {
    const rejection = await decideBlueprintReview({
      runDir,
      status: "rejected",
      reviewedBy: "operator:test",
      note: "Revise the responsibility boundary.",
      now: new Date("2026-05-06T00:00:01.000Z")
    });
    assert.equal(rejection.ok, true);

    const result = await renderDesignPreview({ runDir });
    assert.equal(result.ok, true);

    const previewDir = path.join(runDir, "preview");
    const model = await readJsonFile(path.join(previewDir, "preview-model.json"));
    assert.equal(model.status.nextAction, "/makeitreal:plan <request>");
    assert.equal(model.status.nextCommand, "/makeitreal:plan <request>");
    assert.equal(model.operatorCockpit.nextCommand, "/makeitreal:plan <request>");

    const html = await readFile(path.join(previewDir, "index.html"), "utf8");
    assert.match(html, /data-copy="\/makeitreal:plan &lt;request&gt;"/);
    assert.doesNotMatch(html, /data-copy="\/makeitreal:plan approve"/);
  });
});

test("preview projects approved launch board state without mutating control-plane artifacts", async () => {
  await withFixture(async ({ root }) => {
    const plan = await generatePlanRun({
      projectRoot: root,
      request: "Build a previewed report module",
      runId: "previewed-report",
      allowedPaths: ["modules/previewed-report/**"],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('previewed report ok')"] }],
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

    const watched = [
      path.join(plan.runDir, "board.json"),
      path.join(plan.runDir, "work-items", `${plan.workItemId}.json`),
      path.join(plan.runDir, "evidence", "verification.json"),
      path.join(plan.runDir, "claims", `${plan.workItemId}.json`),
      path.join(plan.runDir, "runtime-state.json"),
      path.join(plan.runDir, "trust-policy.json"),
      path.join(plan.runDir, "prd.json"),
      path.join(plan.runDir, "design-pack.json"),
      path.join(plan.runDir, "responsibility-units.json"),
      path.join(plan.runDir, "blueprint-review.json")
    ];
    const before = await snapshot(watched);

    const result = await renderDesignPreview({ runDir: plan.runDir });
    assert.equal(result.ok, true);
    assert.deepEqual(await snapshot(watched), before);

    const html = await readFile(path.join(plan.runDir, "preview", "index.html"), "utf8");
    assert.match(html, /Board has work ready for launch/);
    assert.match(html, /class="kanban-lane"/);
    assert.match(html, /data-lane="Contract Frozen"/);
    assert.match(html, /class="work-card"/);
    assert.match(html, /\/makeitreal:launch/);
    assert.doesNotMatch(html, /board claim/);
    assert.doesNotMatch(html, /orchestrator tick/);
    assert.doesNotMatch(html, />gate</);

    const model = await readJsonFile(path.join(plan.runDir, "preview", "preview-model.json"));
    assert.equal(model.board.lanes.find((lane) => lane.name === "Contract Frozen").workItems[0].id, plan.workItemId);
  });
});
