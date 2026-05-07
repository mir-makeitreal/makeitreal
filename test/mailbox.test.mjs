import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readMailbox, sendMailboxMessage } from "../src/board/mailbox.mjs";

test("mailbox sends messages scoped to workers and work items", async () => {
  const boardDir = await mkdtemp(path.join(os.tmpdir(), "harness-mailbox-"));
  try {
    await sendMailboxMessage({
      boardDir,
      fromWorkerId: "worker.frontend",
      toWorkerId: "worker.auth",
      workItemId: "work.login-ui",
      message: "contract.auth.login verified",
      now: new Date("2026-04-30T00:00:00.000Z")
    });
    assert.deepEqual((await readMailbox({ boardDir, workerId: "worker.auth" })).map((entry) => entry.message), [
      "contract.auth.login verified"
    ]);
    assert.deepEqual(await readMailbox({ boardDir, workerId: "worker.frontend" }), []);
  } finally {
    await rm(boardDir, { recursive: true, force: true });
  }
});
