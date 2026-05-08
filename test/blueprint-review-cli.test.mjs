import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { seedBlueprintReview } from "../src/blueprint/review.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { withFixture } from "./helpers/fixture.mjs";

function runHarness(args, options = {}) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    env: options.env ?? process.env
  });
}

async function writeApprovalJudgeFixture(root, result) {
  const scriptPath = `${root}/approval-judge-fixture.mjs`;
  await writeFile(scriptPath, [
    "#!/usr/bin/env node",
    `const result = ${JSON.stringify(result)};`,
    "process.stdout.write(JSON.stringify({ result: JSON.stringify(result) }));"
  ].join("\n"));
  return {
    MAKEITREAL_APPROVAL_JUDGE_COMMAND_JSON: JSON.stringify({
      file: process.execPath,
      args: [scriptPath]
    })
  };
}

test("blueprint approve and reject write operator review evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });

    const approved = runHarness(["blueprint", "approve", runDir, "--by", "operator:eugene"]);
    assert.equal(approved.status, 0, approved.stdout || approved.stderr);
    const approvedOutput = JSON.parse(approved.stdout);
    assert.equal(approvedOutput.ok, true);
    assert.equal(approvedOutput.command, "blueprint approve");
    assert.equal(approvedOutput.status, "approved");
    assert.equal(approvedOutput.reviewedBy, "operator:eugene");
    const review = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(review.status, "approved");
    assert.equal(review.reviewSource, "makeitreal:plan approve");

    const rejected = runHarness(["blueprint", "reject", runDir, "--by", "operator:eugene", "--note", "revise boundaries"]);
    assert.equal(rejected.status, 0, rejected.stdout || rejected.stderr);
    const rejectedReview = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(rejectedReview.status, "rejected");
    assert.equal(rejectedReview.reviewSource, "makeitreal:plan reject");
    assert.equal(rejectedReview.decisionNote, "revise boundaries");
  });
});

test("blueprint decision failures are no-write", async () => {
  await withFixture(async ({ runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const reviewPath = path.join(runDir, "blueprint-review.json");
    const before = await readFile(reviewPath, "utf8");

    const missingReviewer = runHarness(["blueprint", "approve", runDir]);
    assert.equal(missingReviewer.status, 1);
    assert.equal(await readFile(reviewPath, "utf8"), before);

    const runnerEnv = runHarness(["blueprint", "approve", runDir, "--by", "operator:eugene"], {
      env: { ...process.env, MAKEITREAL_WORK_ITEM_ID: "work.feature-auth" }
    });
    assert.equal(runnerEnv.status, 1);
    assert.equal(await readFile(reviewPath, "utf8"), before);

    await writeJsonFile(reviewPath, { status: "invalid" });
    const malformedBefore = await readFile(reviewPath, "utf8");
    const malformed = runHarness(["blueprint", "approve", runDir, "--by", "operator:eugene"]);
    assert.equal(malformed.status, 1);
    assert.equal(await readFile(reviewPath, "utf8"), malformedBefore);

    await rm(path.join(runDir, ".makeitreal"), { recursive: true, force: true });
  });
});

test("blueprint review classifies question UI answers through the LLM judge", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const judgeEnv = await writeApprovalJudgeFixture(root, {
      decision: "approved",
      launchRequested: true,
      confidence: "high",
      reason: "The operator approved the Blueprint from the review question UI."
    });

    const reviewed = runHarness([
      "blueprint",
      "review",
      runDir,
      "--prompt",
      "승인하고 바로 시작",
      "--context",
      "Blueprint review question shown after the operator-facing report.",
      "--session",
      "question-ui",
      "--now",
      "2026-05-06T00:01:00.000Z"
    ], {
      env: { ...process.env, ...judgeEnv, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(reviewed.status, 0, reviewed.stdout || reviewed.stderr);

    const output = JSON.parse(reviewed.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.command, "blueprint review");
    assert.equal(output.action, "approved");
    assert.equal(output.launchRequested, true);
    assert.match(output.additionalContext, /Blueprint approval has been recorded/);

    const review = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(review.status, "approved");
    assert.equal(review.reviewSource, "makeitreal:interactive-review:llm");
    assert.equal(review.reviewedBy, "operator:question-ui");
    assert.match(review.decisionNote, /LLM interactive Blueprint review decision/);
  });
});

test("blueprint review keeps revision requests pending for rework instead of rejection", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const judgeEnv = await writeApprovalJudgeFixture(root, {
      decision: "revision_requested",
      launchRequested: false,
      confidence: "high",
      reason: "The operator wants narrower frontend/backend boundaries before approval."
    });

    const reviewed = runHarness([
      "blueprint",
      "review",
      runDir,
      "--prompt",
      "승인 전에 프론트엔드와 백엔드 책임경계를 더 쪼개주세요",
      "--context",
      "Blueprint review question shown after the operator-facing report.",
      "--session",
      "question-ui-revision",
      "--now",
      "2026-05-06T00:01:00.000Z"
    ], {
      env: { ...process.env, ...judgeEnv, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(reviewed.status, 0, reviewed.stdout || reviewed.stderr);

    const output = JSON.parse(reviewed.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "revision-requested");
    assert.equal(output.launchRequested, false);
    assert.match(output.additionalContext, /Blueprint revision request has been recorded/);

    const review = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(review.status, "pending");
    assert.equal(review.reviewedBy, null);
    assert.equal(review.revisionRequestedBy, "operator:question-ui-revision");
    assert.match(review.revisionNote, /narrower frontend\/backend boundaries/);
  });
});
