import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { nextBackoffMs } from "../src/orchestrator/retry-policy.mjs";
import { resolveWorkspace } from "../src/orchestrator/workspace-manager.mjs";

test("workspace stays inside board workspace root", () => {
  const boardDir = path.resolve("/tmp/harness-board");
  assert.deepEqual(resolveWorkspace({ boardDir, workItemId: "work.login-ui" }), {
    ok: true,
    workspace: path.join(boardDir, "workspaces", "work.login-ui"),
    errors: []
  });
  const escaped = resolveWorkspace({ boardDir, workItemId: "../escape" });
  assert.equal(escaped.ok, false);
  assert.equal(escaped.errors[0].code, "HARNESS_WORKSPACE_ESCAPE");
  assert.equal(escaped.errors[0].recoverable, false);
});

test("retry policy uses capped exponential backoff", () => {
  assert.equal(nextBackoffMs(1), 1000);
  assert.equal(nextBackoffMs(2), 2000);
  assert.equal(nextBackoffMs(3), 4000);
  assert.equal(nextBackoffMs(20), 30000);
});
