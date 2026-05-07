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
