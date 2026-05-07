import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { withFixture } from "./helpers/fixture.mjs";

function runHarness(args) {
  return spawnSync(process.execPath, ["bin/harness.mjs", ...args], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8"
  });
}

test("canonical fixture reaches Done through the public CLI", async () => {
  await withFixture(async ({ runDir }) => {
    const render = runHarness(["design", "render", runDir]);
    assert.equal(render.status, 0, render.stdout || render.stderr);

    const ready = runHarness(["gate", runDir, "--target", "Ready"]);
    assert.equal(ready.status, 0, ready.stdout || ready.stderr);
    assert.equal(JSON.parse(ready.stdout).ok, true);

    const verify = runHarness(["verify", runDir]);
    assert.equal(verify.status, 0, verify.stdout || verify.stderr);
    assert.equal(JSON.parse(verify.stdout).dashboardRefresh.attempted, true);

    const wiki = runHarness(["wiki", "sync", runDir]);
    assert.equal(wiki.status, 0, wiki.stdout || wiki.stderr);

    const done = runHarness(["gate", runDir, "--target", "Done"]);
    assert.equal(done.status, 0, done.stdout || done.stderr);
    assert.equal(JSON.parse(done.stdout).ok, true);
  });
});
