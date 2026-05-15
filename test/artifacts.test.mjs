import assert from "node:assert/strict";
import { test } from "node:test";
import { findPrimaryWorkItem, loadRunArtifacts } from "../src/domain/artifacts.mjs";
import { withFixture } from "./helpers/fixture.mjs";

test("loads all canonical run artifacts", async () => {
  await withFixture(async ({ runDir }) => {
    const artifacts = await loadRunArtifacts(runDir);
    assert.equal(artifacts.prd.id, "prd.auth");
    assert.equal(artifacts.designPack.workItemId, "work.feature-auth");
    assert.equal(artifacts.responsibilityUnits.units.length, 2);
    assert.equal(artifacts.workItemDag.schemaVersion, "1.0");
    assert.equal(artifacts.workItemDag.nodes[0].id, artifacts.workItems[0].id);
    assert.equal(artifacts.contracts.length, 1);
    assert.equal(artifacts.workItems.length, 1);
    assert.equal(findPrimaryWorkItem(artifacts).id, "work.feature-auth");
  });
});
