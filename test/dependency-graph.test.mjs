import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getBlockedWorkItems,
  getReadyWorkItems,
  validateDependencyGraph
} from "../src/board/dependency-graph.mjs";

const board = {
  workItems: [
    { id: "a", lane: "Done", dependsOn: [] },
    { id: "b", lane: "Ready", dependsOn: ["a"] },
    { id: "c", lane: "Ready", dependsOn: ["b"] }
  ]
};

test("ready queue excludes blocked work", () => {
  assert.deepEqual(getReadyWorkItems(board).map((item) => item.id), ["b"]);
  assert.deepEqual(getBlockedWorkItems(board).map((item) => item.id), ["c"]);
});

test("dependency graph rejects missing dependency and cycle", () => {
  assert.equal(validateDependencyGraph(board).ok, true);
  assert.equal(validateDependencyGraph({ workItems: [{ id: "a", lane: "Ready", dependsOn: ["missing"] }] }).ok, false);
  assert.equal(validateDependencyGraph({
    workItems: [
      { id: "a", lane: "Ready", dependsOn: ["b"] },
      { id: "b", lane: "Ready", dependsOn: ["a"] }
    ]
  }).ok, false);
});
