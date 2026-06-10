import assert from "node:assert/strict";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { decideBlueprintReview, seedBlueprintReview } from "../src/blueprint/review.mjs";
import { fileExists, readJsonFile } from "../src/io/json.mjs";
import { currentRunStatePath, writeCurrentRunState } from "../src/project/run-state.mjs";
import { withFixture } from "./helpers/fixture.mjs";

const NOW = new Date("2026-06-10T00:00:00.000Z");

test("blueprint reject records a rejection even when work-item-dag.json is missing", async () => {
  await withFixture(async ({ runDir }) => {
    await seedBlueprintReview({ runDir, now: NOW });
    await rm(path.join(runDir, "work-item-dag.json"), { force: true });

    const result = await decideBlueprintReview({
      runDir,
      status: "rejected",
      reviewedBy: "operator:test",
      decisionNote: "Run packet is incomplete; rejecting to unblock the project.",
      env: {},
      now: NOW
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.status, "rejected");
    assert.equal(result.blueprintFingerprint, null);
    assert.equal(result.fingerprintUnavailable, true);

    const stored = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(stored.status, "rejected");
    assert.equal(stored.blueprintFingerprint, null);
    assert.equal(stored.reviewedBy, "operator:test");
    assert.equal(stored.reviewedAt, NOW.toISOString());
  });
});

test("blueprint reject releases the current-run pointer that references the rejected run", async () => {
  await withFixture(async ({ root, runDir }) => {
    const projectRunDir = path.join(root, ".makeitreal", "runs", "feature-auth");
    await mkdir(path.dirname(projectRunDir), { recursive: true });
    await cp(runDir, projectRunDir, { recursive: true });
    await rm(path.join(projectRunDir, "work-item-dag.json"), { force: true });
    await writeCurrentRunState({ projectRoot: root, runDir: projectRunDir, now: NOW });

    const pointerPath = currentRunStatePath(root);
    assert.equal(await fileExists(pointerPath), true);

    const result = await decideBlueprintReview({
      runDir: projectRunDir,
      status: "rejected",
      reviewedBy: "operator:test",
      env: {},
      now: NOW
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.currentRunPointer.released, true);
    assert.equal(result.currentRunPointer.pointerPath, pointerPath);
    assert.equal(await fileExists(pointerPath), false);
  });
});

test("blueprint reject leaves a current-run pointer for a different run untouched", async () => {
  await withFixture(async ({ root, runDir }) => {
    const rejectedRunDir = path.join(root, ".makeitreal", "runs", "feature-auth");
    const otherRunDir = path.join(root, ".makeitreal", "runs", "feature-other");
    await mkdir(path.dirname(rejectedRunDir), { recursive: true });
    await cp(runDir, rejectedRunDir, { recursive: true });
    await writeCurrentRunState({ projectRoot: root, runDir: otherRunDir, now: NOW });

    const pointerPath = currentRunStatePath(root);
    const result = await decideBlueprintReview({
      runDir: rejectedRunDir,
      status: "rejected",
      reviewedBy: "operator:test",
      env: {},
      now: NOW
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.currentRunPointer.released, false);
    assert.equal(await fileExists(pointerPath), true);
  });
});

test("blueprint approve still fails when work-item-dag.json is missing", async () => {
  await withFixture(async ({ runDir }) => {
    await seedBlueprintReview({ runDir, now: NOW });
    await rm(path.join(runDir, "work-item-dag.json"), { force: true });

    const result = await decideBlueprintReview({
      runDir,
      status: "approved",
      reviewedBy: "operator:test",
      env: {},
      now: NOW
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.code === "HARNESS_BLUEPRINT_REVIEW_INVALID"), true);

    const stored = await readJsonFile(path.join(runDir, "blueprint-review.json"));
    assert.equal(stored.status, "pending");
  });
});
