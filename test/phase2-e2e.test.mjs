import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("Kanban orchestrator dispatches, completes, and unblocks dependent work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-phase2-"));
  const source = new URL("../examples/kanban/.harness/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    const ready = spawnSync(process.execPath, ["bin/harness.mjs", "board", "ready", boardDir], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.deepEqual(JSON.parse(ready.stdout).workItemIds, ["work.login-ui"]);

    const tick = spawnSync(process.execPath, ["bin/harness.mjs", "orchestrator", "tick", boardDir, "--concurrency", "2"], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(tick.status, 0, tick.stdout || tick.stderr);

    const complete = spawnSync(process.execPath, [
      "bin/harness.mjs",
      "orchestrator",
      "complete",
      boardDir,
      "--work",
      "work.login-ui",
      "--now",
      "2026-04-30T00:00:01.000Z"
    ], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(complete.status, 0, complete.stdout || complete.stderr);

    const after = spawnSync(process.execPath, ["bin/harness.mjs", "board", "ready", boardDir], {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8"
    });
    assert.deepEqual(JSON.parse(after.stdout).workItemIds, ["work.audit-log"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
