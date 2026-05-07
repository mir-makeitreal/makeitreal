import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadBoard } from "../src/board/board-store.mjs";
import { claimWorkItem, getClaim, listClaims, releaseClaim } from "../src/board/claim-store.mjs";
import { writeJsonFile } from "../src/io/json.mjs";
import { approveBoard } from "./helpers/blueprint.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-claim-"));
  const source = new URL("../examples/kanban/.harness/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("claim prevents duplicate workers until lease expires", async () => {
  await withBoard(async ({ boardDir }) => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    assert.equal((await claimWorkItem({
      boardDir,
      workItemId: "work.login-ui",
      workerId: "worker.frontend",
      now,
      leaseMs: 1000
    })).ok, true);

    const conflict = await claimWorkItem({
      boardDir,
      workItemId: "work.login-ui",
      workerId: "worker.other",
      now,
      leaseMs: 1000
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.errors[0].code, "HARNESS_CLAIM_CONFLICT");
    assert.equal(conflict.errors[0].ownerModule, "ru.frontend");

    const later = new Date("2026-04-30T00:00:02.000Z");
    assert.equal((await claimWorkItem({
      boardDir,
      workItemId: "work.login-ui",
      workerId: "worker.other",
      now: later,
      leaseMs: 1000
    })).ok, true);
    assert.equal((await getClaim({ boardDir, workItemId: "work.login-ui", now: later })).workerId, "worker.other");
    assert.equal(
      (await getClaim({ boardDir, workItemId: "work.login-ui", now: later })).responsibilityUnitId,
      "ru.frontend"
    );
  });
});

test("only claim owner can release active claim", async () => {
  await withBoard(async ({ boardDir }) => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    await claimWorkItem({ boardDir, workItemId: "work.login-ui", workerId: "worker.frontend", now, leaseMs: 1000 });
    assert.equal((await releaseClaim({
      boardDir,
      workItemId: "work.login-ui",
      workerId: "worker.other"
    })).ok, false);
    assert.equal((await releaseClaim({
      boardDir,
      workItemId: "work.login-ui",
      workerId: "worker.frontend"
    })).ok, true);
    const board = await loadBoard(boardDir);
    assert.equal(board.workItems.find((item) => item.id === "work.login-ui").lane, "Ready");
  });
});

test("listClaims returns active non-expired claims", async () => {
  await withBoard(async ({ boardDir }) => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    await claimWorkItem({ boardDir, workItemId: "work.login-ui", workerId: "worker.frontend", now, leaseMs: 1000 });
    assert.deepEqual((await listClaims({ boardDir, now })).map((claim) => claim.workItemId), ["work.login-ui"]);
    assert.deepEqual(await listClaims({ boardDir, now: new Date("2026-04-30T00:00:02.000Z") }), []);
  });
});

test("claim requires unblocked Ready work", async () => {
  await withBoard(async ({ boardDir }) => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    const blocked = await claimWorkItem({
      boardDir,
      workItemId: "work.audit-log",
      workerId: "worker.audit",
      now,
      leaseMs: 1000
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "HARNESS_WORK_BLOCKED");

    const done = await claimWorkItem({
      boardDir,
      workItemId: "work.auth-contract",
      workerId: "worker.auth",
      now,
      leaseMs: 1000
    });
    assert.equal(done.ok, false);
    assert.equal(done.errors[0].code, "HARNESS_WORK_NOT_READY");
  });
});

test("claim rejects unapproved work without writing claims, events, lanes, or runtime state", async () => {
  await withBoard(async ({ boardDir }) => {
    await rm(path.join(boardDir, "blueprint-review.json"), { force: true });
    const boardBefore = await readFile(path.join(boardDir, "board.json"), "utf8");
    const result = await claimWorkItem({
      boardDir,
      workItemId: "work.login-ui",
      workerId: "worker.frontend",
      now: new Date("2026-04-30T00:00:00.000Z"),
      leaseMs: 1000
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_BLUEPRINT_AUDIT_UNLINKED");
    assert.equal(await readFile(path.join(boardDir, "board.json"), "utf8"), boardBefore);
    await assert.rejects(readFile(path.join(boardDir, "claims", "work.login-ui.json"), "utf8"));
    await assert.rejects(readFile(path.join(boardDir, "events.jsonl"), "utf8"));
    await assert.rejects(readFile(path.join(boardDir, "runtime-state.json"), "utf8"));
  });
});

test("claim requires exactly one responsibility owner", async () => {
  await withBoard(async ({ boardDir }) => {
    const board = await loadBoard(boardDir);
    board.workItems.find((item) => item.id === "work.login-ui").responsibilityUnitId = null;
    await writeJsonFile(path.join(boardDir, "board.json"), board);
    await approveBoard(boardDir);

    const result = await claimWorkItem({
      boardDir,
      workItemId: "work.login-ui",
      workerId: "worker.frontend",
      now: new Date("2026-04-30T00:00:00.000Z"),
      leaseMs: 1000
    });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_RESPONSIBILITY_OWNER_INVALID");
  });
});
