import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appendBoardEvent, loadBoard, saveBoard } from "../src/board/board-store.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-board-"));
  const source = new URL("../examples/kanban/.harness/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("loads and saves board state", async () => {
  await withBoard(async ({ boardDir }) => {
    const board = await loadBoard(boardDir);
    assert.equal(board.boardId, "board.auth");
    assert.equal(board.workItems.length, 3);

    board.workItems[1].lane = "Claimed";
    await saveBoard(boardDir, board);
    assert.equal((await loadBoard(boardDir)).workItems[1].lane, "Claimed");
  });
});

test("appends structured board events", async () => {
  await withBoard(async ({ boardDir }) => {
    await appendBoardEvent(boardDir, {
      event: "claim_created",
      workItemId: "work.login-ui",
      workerId: "worker.frontend",
      timestamp: "2026-04-30T00:00:00.000Z"
    });
    const lines = (await readFile(path.join(boardDir, "events.jsonl"), "utf8")).trim().split("\n");
    assert.equal(JSON.parse(lines.at(-1)).event, "claim_created");
  });
});
