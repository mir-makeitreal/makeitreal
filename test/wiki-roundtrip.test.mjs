// Round-trip guard for the canonical wiki location: every producer must write
// where the viewer resolver reads — <project>/.makeitreal/wiki/live/.
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runVerification } from "../src/adapters/command-evidence.mjs";
import { completeVerifiedWork } from "../src/orchestrator/board-completion.mjs";
import { orchestratorTick } from "../src/orchestrator/orchestrator.mjs";
import { syncLiveWiki } from "../src/wiki/live-wiki.mjs";
import { readWikiFiles, resolveWikiPaths } from "../src/wiki/wiki-viewer.mjs";
import { withFixture } from "./helpers/fixture.mjs";

test("wiki sync writes where the viewer resolver reads (canonical run layout)", async () => {
  await withFixture(async ({ root, runDir }) => {
    const projectRoot = path.join(root, "project");
    const canonicalRunDir = path.join(projectRoot, ".makeitreal", "runs", "feature-auth");
    await cp(runDir, canonicalRunDir, { recursive: true });

    await runVerification({ runDir: canonicalRunDir });
    const sync = await syncLiveWiki({ runDir: canonicalRunDir });
    assert.equal(sync.ok, true, JSON.stringify(sync.errors));
    assert.equal(sync.skipped, false);

    const { liveDir } = resolveWikiPaths(canonicalRunDir);
    assert.equal(liveDir, path.join(projectRoot, ".makeitreal", "wiki", "live"));
    assert.equal(sync.outputPath, path.join(liveDir, "work.feature-auth.md"));

    const files = await readWikiFiles(liveDir);
    assert.deepEqual(files.map((file) => file.id), ["work.feature-auth"]);
  });
});

test("orchestrator complete writes the board wiki to the viewer resolver location", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-roundtrip-board-"));
  const projectRoot = path.join(root, "project");
  const boardDir = path.join(projectRoot, ".makeitreal", "runs", "board");
  await cp(new URL("../examples/kanban/.makeitreal/board", import.meta.url), boardDir, { recursive: true });
  try {
    await orchestratorTick({
      boardDir,
      workerId: "worker.frontend",
      concurrency: 1,
      now: new Date("2026-06-10T00:00:00.000Z"),
      runnerScript: ["session_started", "turn_completed"]
    });
    const result = await completeVerifiedWork({
      boardDir,
      workItemId: "work.login-ui",
      now: new Date("2026-06-10T00:00:01.000Z")
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));

    const { liveDir } = resolveWikiPaths(boardDir);
    assert.equal(liveDir, path.join(projectRoot, ".makeitreal", "wiki", "live"));
    assert.equal(result.wikiPath, path.join(liveDir, "work.login-ui.md"));

    const files = await readWikiFiles(liveDir);
    assert.deepEqual(files.map((file) => file.id), ["work.login-ui"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
