import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildWikiIndex,
  generateWikiHtml,
  readWikiFiles,
  resolveWikiPaths
} from "../src/wiki/wiki-viewer.mjs";

async function withRun(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-viewer-"));
  const runDir = path.join(root, "run");
  const { liveDir } = resolveWikiPaths(runDir);
  await mkdir(liveDir, { recursive: true });
  try {
    await callback({ runDir, liveDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("generateWikiHtml renders dark theme with marked + JetBrains Mono", () => {
  const html = generateWikiHtml([
    { id: "WI-001", path: "/x/WI-001.md", content: "# Auth Service\n\nHandles login." }
  ]);
  assert.ok(html.includes("#08090a"), "uses dark background");
  assert.ok(html.includes("JetBrains+Mono"), "loads JetBrains Mono");
  assert.ok(html.includes("marked.min.js"), "loads marked.js from CDN");
  assert.ok(html.includes('id="work-WI-001"'), "creates a section per work item");
  assert.ok(html.includes("Auth Service"), "uses the markdown H1 as the title");
});

test("generateWikiHtml escapes markdown content so the browser renders it", () => {
  const html = generateWikiHtml([
    { id: "WI-XSS", path: "/x/WI-XSS.md", content: "# Title\n\n<script>alert(1)</script>" }
  ]);
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw script is escaped, not injected");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "content is HTML-escaped");
});

test("generateWikiHtml shows an empty state when there are no pages", () => {
  const html = generateWikiHtml([]);
  assert.ok(html.includes("No wiki pages yet"), "shows a helpful empty state");
});

test("readWikiFiles returns [] when the live directory is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-missing-"));
  try {
    const files = await readWikiFiles(path.join(root, "nope", "live"));
    assert.deepEqual(files, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readWikiFiles reads .md files sorted by id and ignores non-markdown", async () => {
  await withRun(async ({ liveDir }) => {
    await writeFile(path.join(liveDir, "WI-002.md"), "# Two", "utf8");
    await writeFile(path.join(liveDir, "WI-001.md"), "# One", "utf8");
    await writeFile(path.join(liveDir, "notes.txt"), "ignore me", "utf8");
    const files = await readWikiFiles(liveDir);
    assert.deepEqual(files.map((f) => f.id), ["WI-001", "WI-002"]);
    assert.equal(files[0].content, "# One");
  });
});

test("buildWikiIndex writes index.html next to the live directory", async () => {
  // Create proper .makeitreal/runs/<slug>/ structure so resolveWikiPaths can navigate correctly
  const { mkdtemp, mkdir, writeFile: wf, rm } = await import("node:fs/promises");
  const { readFile } = await import("node:fs/promises");
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-viewer-test-"));
  const runDir = path.join(tmpRoot, ".makeitreal", "runs", "test-run");
  const { liveDir, indexPath } = resolveWikiPaths(runDir);
  try {
    await mkdir(liveDir, { recursive: true });
    await wf(path.join(liveDir, "WI-001.md"), "# Hello\n\nbody", "utf8");
    const result = await buildWikiIndex(runDir);
    assert.equal(result.count, 1);
    assert.equal(result.indexPath, indexPath);
    const html = await readFile(indexPath, "utf8");
    assert.ok(html.includes("work-WI-001"));
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
