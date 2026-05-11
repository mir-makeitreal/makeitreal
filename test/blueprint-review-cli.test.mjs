import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
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

test("blueprint review records native Claude Code decision JSON", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const decision = {
      decision: "approved",
      launchRequested: true,
      confidence: "high",
      reason: "The current Claude Code session judged the operator approved the Blueprint from the review question UI."
    };

    const reviewed = runHarness([
      "blueprint",
      "review",
      runDir,
      "--decision-json",
      JSON.stringify(decision),
      "--session",
      "question-ui",
      "--now",
      "2026-05-06T00:01:00.000Z"
    ], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
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
    assert.equal(review.reviewSource, "makeitreal:interactive-review:native-claude");
    assert.equal(review.reviewedBy, "operator:question-ui");
    assert.match(review.decisionNote, /Native Claude Code Blueprint review decision/);
  });
});

test("blueprint review accepts --run for native Claude command recovery", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const decision = {
      decision: "approved",
      launchRequested: true,
      confidence: "high",
      reason: "The current Claude Code session judged the operator approved the Blueprint from the review question UI."
    };

    const reviewed = runHarness([
      "blueprint",
      "review",
      "--run",
      runDir,
      "--decision-json",
      JSON.stringify(decision),
      "--session",
      "question-ui",
      "--project-root",
      root,
      "--now",
      "2026-05-06T00:01:00.000Z"
    ]);
    assert.equal(reviewed.status, 0, reviewed.stdout || reviewed.stderr);

    const output = JSON.parse(reviewed.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "approved");

    const review = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(review.status, "approved");
    assert.equal(review.reviewedBy, "operator:question-ui");
  });
});

test("blueprint review accepts native decisions with optional metadata defaults", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const decision = {
      decision: "approved",
      launchRequested: true
    };

    const reviewed = runHarness([
      "blueprint",
      "review",
      runDir,
      "--decision-json",
      JSON.stringify(decision),
      "--session",
      "question-ui",
      "--now",
      "2026-05-06T00:01:00.000Z"
    ], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(reviewed.status, 0, reviewed.stdout || reviewed.stderr);

    const output = JSON.parse(reviewed.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.action, "approved");

    const review = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(review.status, "approved");
    assert.match(review.decisionNote, /medium confidence/);
    assert.match(review.decisionNote, /current Blueprint review interaction/);
  });
});

test("blueprint review tolerates noncanonical native confidence metadata", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const decision = {
      decision: "approved",
      launchRequested: true,
      confidence: "very high",
      reason: "The current Claude Code session judged the operator approved the Blueprint."
    };

    const reviewed = runHarness([
      "blueprint",
      "review",
      runDir,
      "--decision-json",
      JSON.stringify(decision),
      "--session",
      "question-ui",
      "--now",
      "2026-05-06T00:01:00.000Z"
    ], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
    });
    assert.equal(reviewed.status, 0, reviewed.stdout || reviewed.stderr);

    const review = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(review.status, "approved");
    assert.match(review.decisionNote, /high confidence/);
  });
});

test("blueprint review refuses prompt-only child-judge flow", async () => {
  await withFixture(async ({ runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const before = await readFile(path.join(runDir, "blueprint-review.json"), "utf8");

    const reviewed = runHarness([
      "blueprint",
      "review",
      runDir,
      "--prompt",
      "승인하고 시작합니다",
      "--session",
      "structured-output",
      "--now",
      "2026-05-06T00:01:00.000Z"
    ]);
    assert.equal(reviewed.status, 1);

    const output = JSON.parse(reviewed.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.errors[0].code, "HARNESS_NATIVE_REVIEW_DECISION_REQUIRED");
    assert.match(output.errors[0].reason, /Do not spawn a separate Claude CLI judge/);
    assert.equal(await readFile(path.join(runDir, "blueprint-review.json"), "utf8"), before);
  });
});

test("blueprint review keeps revision requests pending for rework instead of rejection", async () => {
  await withFixture(async ({ root, runDir }) => {
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    const decision = {
      decision: "revision_requested",
      launchRequested: false,
      confidence: "high",
      reason: "The operator wants narrower frontend/backend boundaries before approval."
    };

    const reviewed = runHarness([
      "blueprint",
      "review",
      runDir,
      "--decision-json",
      JSON.stringify(decision),
      "--session",
      "question-ui-revision",
      "--now",
      "2026-05-06T00:01:00.000Z"
    ], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }
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
