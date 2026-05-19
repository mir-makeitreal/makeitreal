import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startDashboardServer } from "../src/dashboard/server.mjs";

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

async function withTempRunDir(callback) {
  const root = await mkdir(path.join(os.tmpdir(), `mir-dash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
  const runDir = path.join(root.toString(), ".makeitreal", "runs", "test-run");
  const previewDir = path.join(runDir, "preview");
  await mkdir(previewDir, { recursive: true });
  try {
    await callback({ root: root.toString(), runDir, previewDir });
  } finally {
    await rm(root.toString(), { recursive: true, force: true }).catch(() => {});
  }
}

const minimalModel = {
  schemaVersion: "1.0",
  generatedAt: "2026-01-01T00:00:00.000Z",
  run: { runDir: "/tmp/test", runId: "test-run", workItemId: "wi-1", prdId: "prd-1" },
  blueprint: {
    title: "Test",
    summary: ["test"],
    goals: [],
    nonGoals: [],
    acceptanceCriteria: [],
    primaryContract: null,
    contracts: [],
    boundaries: [],
    moduleInterfaces: [],
    architecture: { nodes: [], edges: [] },
    stateTransitions: [],
    callStacks: [],
    sequences: [],
    systemDossier: null,
  },
  design: {
    architectureEdges: [],
    stateTransitions: [],
    apiSpecs: [],
    responsibilityBoundaries: [],
    moduleInterfaces: [],
    callStacks: [],
    sequences: [],
  },
  status: {
    phase: "blueprint-review",
    blueprintStatus: "pending",
    headline: "Test headline",
    blockers: [],
    nextAction: "review",
    nextCommand: "approve",
    evidenceSummary: [],
  },
  operatorCockpit: {
    readOnly: true,
    controlSurface: "harness",
    phase: "blueprint-review",
    blueprintStatus: "pending",
    headline: "Test",
    nextAction: "review",
    nextCommand: "approve",
    firstRunChecklist: [],
    evidenceLinks: [],
  },
  board: null,
};

test("dashboard server starts and serves /api/model", async () => {
  await withTempRunDir(async ({ runDir, previewDir }) => {
    await writeFile(path.join(previewDir, "preview-model.json"), JSON.stringify(minimalModel));

    // Use a temp dist dir with a minimal index.html
    const distDir = path.join(os.tmpdir(), `mir-dash-dist-${Date.now()}`);
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.html"), "<html><body>test</body></html>");

    const info = await startDashboardServer({
      runDir,
      port: 0,
      host: "127.0.0.1",
      idleTimeoutMs: 60000,
      parentPid: null,
      distDir,
    });

    try {
      assert.ok(info.port > 0, "should bind to a port");
      assert.ok(info.url.startsWith("http://"), "should have HTTP URL");

      // Test /api/model
      const res = await httpGet(`${info.url}/api/model`);
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.model.blueprint.title, "Test");

      // Test /api/server-info
      const infoRes = await httpGet(`${info.url}/api/server-info`);
      assert.equal(infoRes.status, 200);
      const infoData = JSON.parse(infoRes.body);
      assert.equal(infoData.ok, true);
      assert.equal(infoData.port, info.port);

      // Test static file serving
      const indexRes = await httpGet(`${info.url}/`);
      assert.equal(indexRes.status, 200);
      assert.match(indexRes.body, /test/);

      // Test 404 for missing asset
      const missingRes = await httpGet(`${info.url}/nonexistent.js`);
      assert.equal(missingRes.status, 404);
    } finally {
      await info.shutdown("test-cleanup");
      await rm(distDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("dashboard server returns 404 when preview-model.json is missing", async () => {
  await withTempRunDir(async ({ runDir }) => {
    const distDir = path.join(os.tmpdir(), `mir-dash-dist2-${Date.now()}`);
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.html"), "<html></html>");

    const info = await startDashboardServer({
      runDir,
      port: 0,
      host: "127.0.0.1",
      idleTimeoutMs: 60000,
      parentPid: null,
      distDir,
    });

    try {
      const res = await httpGet(`${info.url}/api/model`);
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, false);
    } finally {
      await info.shutdown("test-cleanup");
      await rm(distDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("dashboard server broadcast function works", async () => {
  await withTempRunDir(async ({ runDir }) => {
    const distDir = path.join(os.tmpdir(), `mir-dash-dist3-${Date.now()}`);
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.html"), "<html></html>");

    const info = await startDashboardServer({
      runDir,
      port: 0,
      host: "127.0.0.1",
      idleTimeoutMs: 60000,
      parentPid: null,
      distDir,
    });

    try {
      assert.equal(info.clientCount(), 0, "no WS clients initially");
      // broadcast should not throw even with no clients
      info.broadcast({ type: "test", data: "hello" });
    } finally {
      await info.shutdown("test-cleanup");
      await rm(distDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("dashboard server SPA fallback serves index.html for non-asset routes", async () => {
  await withTempRunDir(async ({ runDir }) => {
    const distDir = path.join(os.tmpdir(), `mir-dash-dist4-${Date.now()}`);
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.html"), "<html><body>spa</body></html>");

    const info = await startDashboardServer({
      runDir,
      port: 0,
      host: "127.0.0.1",
      idleTimeoutMs: 60000,
      parentPid: null,
      distDir,
    });

    try {
      const res = await httpGet(`${info.url}/some/deep/route`);
      assert.equal(res.status, 200);
      assert.match(res.body, /spa/);
    } finally {
      await info.shutdown("test-cleanup");
      await rm(distDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

test("dashboard server CORS headers on API routes", async () => {
  await withTempRunDir(async ({ runDir, previewDir }) => {
    await writeFile(path.join(previewDir, "preview-model.json"), JSON.stringify(minimalModel));

    const distDir = path.join(os.tmpdir(), `mir-dash-dist5-${Date.now()}`);
    await mkdir(distDir, { recursive: true });
    await writeFile(path.join(distDir, "index.html"), "<html></html>");

    const info = await startDashboardServer({
      runDir,
      port: 0,
      host: "127.0.0.1",
      idleTimeoutMs: 60000,
      parentPid: null,
      distDir,
    });

    try {
      const res = await httpGet(`${info.url}/api/model`);
      assert.equal(res.headers["access-control-allow-origin"], "*");
    } finally {
      await info.shutdown("test-cleanup");
      await rm(distDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
