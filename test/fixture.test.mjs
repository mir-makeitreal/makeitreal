import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { shouldCopyFixturePath } from "./helpers/fixture.mjs";

test("fixture copy skips generated preview, evidence, and temporary files", () => {
  const sourceRoot = path.join("repo", "examples", "canonical", ".makeitreal", "runs", "feature-auth");

  assert.equal(shouldCopyFixturePath(sourceRoot, sourceRoot), true);
  assert.equal(shouldCopyFixturePath(sourceRoot, path.join(sourceRoot, "board.json")), true);
  assert.equal(shouldCopyFixturePath(sourceRoot, path.join(sourceRoot, "contracts", "auth-login.openapi.json")), true);
  assert.equal(shouldCopyFixturePath(sourceRoot, path.join(sourceRoot, "preview")), false);
  assert.equal(shouldCopyFixturePath(sourceRoot, path.join(sourceRoot, "preview", "design-pack.json")), false);
  assert.equal(shouldCopyFixturePath(sourceRoot, path.join(sourceRoot, "evidence", "verification.json")), false);
  assert.equal(shouldCopyFixturePath(sourceRoot, path.join(sourceRoot, ".makeitreal", "wiki", "live", "work.md")), false);
  assert.equal(shouldCopyFixturePath(sourceRoot, path.join(sourceRoot, "board.json.tmp")), false);
});
