import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateBoardWorkItemBoundary, validateChangedPaths } from "../src/board/responsibility-boundaries.mjs";
import { loadBoard } from "../src/board/board-store.mjs";

async function withBoard(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-boundary-"));
  const source = new URL("../examples/kanban/.harness/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("board work item boundary enforces contract permissions and allowed paths", async () => {
  await withBoard(async ({ boardDir }) => {
    const board = await loadBoard(boardDir);
    const login = board.workItems.find((item) => item.id === "work.login-ui");
    assert.equal((await validateBoardWorkItemBoundary({ boardDir, workItem: login })).ok, true);

    const unauthorized = { ...login, contractIds: ["contract.audit.write"] };
    const boundary = await validateBoardWorkItemBoundary({ boardDir, workItem: unauthorized });
    assert.equal(boundary.ok, false);
    assert.equal(boundary.errors[0].code, "HARNESS_CONTRACT_USAGE_UNAUTHORIZED");

    const paths = validateChangedPaths({ workItem: login, changedPaths: ["apps/web/auth/login.ts", "services/auth/private.ts"] });
    assert.equal(paths.ok, false);
    assert.equal(paths.errors[0].code, "HARNESS_PATH_BOUNDARY_VIOLATION");
  });
});
