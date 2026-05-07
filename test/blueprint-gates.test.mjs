import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { seedBlueprintReview, decideBlueprintReview } from "../src/blueprint/review.mjs";
import { runGates } from "../src/gates/index.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { renderDesignPreview } from "../src/preview/render-preview.mjs";
import { withFixture } from "./helpers/fixture.mjs";

async function approve(runDir) {
  await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
  return decideBlueprintReview({
    runDir,
    status: "approved",
    reviewedBy: "operator:test",
    env: {},
    now: new Date("2026-05-06T00:00:00.000Z")
  });
}

test("Ready gate rejects missing Blueprint approval evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    await rm(path.join(runDir, "blueprint-review.json"), { force: true });
    const result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_MISSING"), true);
  });
});

test("Ready gate rejects pending, rejected, and malformed Blueprint review evidence", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    await seedBlueprintReview({ runDir, now: new Date("2026-05-06T00:00:00.000Z") });
    let result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_PENDING"), true);

    await decideBlueprintReview({
      runDir,
      status: "rejected",
      reviewedBy: "operator:test",
      env: {},
      now: new Date("2026-05-06T00:00:00.000Z")
    });
    result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_REJECTED"), true);

    await writeJsonFile(path.join(runDir, "blueprint-review.json"), { status: "unknown" });
    result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_REVIEW_INVALID"), true);
  });
});

test("Ready gate rejects drift and stale Blueprint approval", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    await approve(runDir);

    const reviewPath = path.join(runDir, "blueprint-review.json");
    const review = await readJsonFile(reviewPath);
    review.workItemId = "work.other";
    await writeJsonFile(reviewPath, review);
    let result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_DRIFT"), true);

    await approve(runDir);
    const designPackPath = path.join(runDir, "design-pack.json");
    const designPack = await readJsonFile(designPackPath);
    designPack.callStacks.push({ entrypoint: "Extra.call", calls: ["do work"] });
    await writeJsonFile(designPackPath, designPack);
    result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_STALE"), true);
  });
});

test("Ready gate detects contract/work-item set changes but ignores JSON key order", async () => {
  await withFixture(async ({ runDir }) => {
    await renderDesignPreview({ runDir });
    await approve(runDir);

    const prdPath = path.join(runDir, "prd.json");
    const prd = await readJsonFile(prdPath);
    await writeFile(prdPath, JSON.stringify({
      nonGoals: prd.nonGoals,
      acceptanceCriteria: prd.acceptanceCriteria,
      userVisibleBehavior: prd.userVisibleBehavior,
      goals: prd.goals,
      title: prd.title,
      id: prd.id,
      schemaVersion: prd.schemaVersion
    }, null, 2), "utf8");
    let result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.ok, true);

    await writeJsonFile(path.join(runDir, "contracts", "extra.json"), { contract: "extra" });
    result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_STALE"), true);

    await rm(path.join(runDir, "contracts", "extra.json"), { force: true });
    await approve(runDir);
    await writeJsonFile(path.join(runDir, "work-items", "work.extra.json"), {
      schemaVersion: "1.0",
      id: "work.extra",
      prdId: "prd.auth"
    });
    result = await runGates({ runDir, target: "Ready" });
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_APPROVAL_STALE"), true);
  });
});
