/**
 * Targeted race-condition and atomicity tests.
 */
import assert from "node:assert/strict";
import { mkdir, rm, writeFile as fsWriteFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, describe } from "node:test";
import { writeJsonFile, readJsonFile } from "../src/io/json.mjs";

async function makeTempDir() {
  const dir = path.join(os.tmpdir(), `race-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("BUG: writeJsonFile uses fixed .tmp name — concurrent writes CRASH", () => {
  test("two concurrent writeJsonFile to same path causes ENOENT", async () => {
    const dir = await makeTempDir();
    try {
      const filePath = path.join(dir, "test.json");
      await writeJsonFile(filePath, { initial: true });

      // Two concurrent writes to the same file
      let error = null;
      try {
        await Promise.all([
          writeJsonFile(filePath, { writer: "A" }),
          writeJsonFile(filePath, { writer: "B" })
        ]);
      } catch (e) {
        error = e;
      }

      if (error) {
        console.log(`  [BUG CONFIRMED] Concurrent writeJsonFile throws: ${error.code} ${error.message.slice(0, 80)}`);
        console.log(`  [BUG] writeJsonFile uses fixed path '${filePath}.tmp' for both writes`);
        console.log(`  [BUG] One write succeeds, the other's rename fails (file already renamed away)`);
        console.log(`  [BUG] Fix: use unique tmp filenames, e.g., '${filePath}.${process.pid}.${Date.now()}.tmp'`);
      } else {
        console.log(`  [NOTE] Both writes succeeded (OS scheduling prevented collision)`);
        const final = await readJsonFile(filePath);
        console.log(`  Winner: ${JSON.stringify(final)}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("board.json lost update (sequential proof)", () => {
  test("load-modify-save interleaving loses updates", async () => {
    const dir = await makeTempDir();
    try {
      const boardPath = path.join(dir, "board.json");
      const initial = {
        workItems: [
          { id: "w1", lane: "Ready" },
          { id: "w2", lane: "Ready" }
        ]
      };
      await writeJsonFile(boardPath, initial);

      // Simulate interleaved load-modify-save (sequential to avoid .tmp collision)
      const board1 = await readJsonFile(boardPath);  // snapshot 1
      const board2 = await readJsonFile(boardPath);  // snapshot 2 (same as 1)

      board1.workItems.find(w => w.id === "w1").lane = "Claimed";
      board2.workItems.find(w => w.id === "w2").lane = "Claimed";

      await writeJsonFile(boardPath, board1);  // saves w1=Claimed, w2=Ready
      await writeJsonFile(boardPath, board2);  // saves w1=Ready(stale!), w2=Claimed

      const final = await readJsonFile(boardPath);
      const w1 = final.workItems.find(w => w.id === "w1").lane;
      const w2 = final.workItems.find(w => w.id === "w2").lane;

      console.log(`  w1=${w1}, w2=${w2}`);
      assert.equal(w1, "Ready", "w1's Claimed update was lost (overwritten by board2's stale snapshot)");
      assert.equal(w2, "Claimed");
      console.log("  [BUG CONFIRMED] Lost update: board2's stale read overwrote board1's w1=Claimed change");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("events.jsonl concurrent appends", () => {
  test("concurrent appends to events.jsonl", async () => {
    const dir = await makeTempDir();
    const eventsPath = path.join(dir, "events.jsonl");

    try {
      const events = Array.from({ length: 50 }, (_, i) =>
        JSON.stringify({ event: `test_${i}`, n: i, padding: "x".repeat(100) })
      );

      // All append concurrently
      await Promise.all(events.map(e =>
        fsWriteFile(eventsPath, e + "\n", { flag: "a" })
      ));

      const content = await readFile(eventsPath, "utf8");
      const lines = content.trim().split("\n");
      console.log(`  Written ${events.length} events, got ${lines.length} lines`);

      let parseErrors = 0;
      for (const line of lines) {
        try { JSON.parse(line); } catch { parseErrors++; }
      }
      if (parseErrors > 0) {
        console.log(`  [BUG] ${parseErrors}/${lines.length} lines are corrupted from interleaved writes`);
      } else {
        console.log(`  [OK] All ${lines.length} lines parse correctly`);
        console.log(`  [NOTE] POSIX guarantees atomic append for writes < PIPE_BUF (4096 bytes)`);
        console.log(`  [NOTE] But larger event payloads could still interleave`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Claim TOCTOU: sequential demonstration", () => {
  test("two getClaim() returning null allows double-claim", async () => {
    const dir = await makeTempDir();
    const claimsDir = path.join(dir, "claims");
    await mkdir(claimsDir, { recursive: true });

    try {
      const claimPath = path.join(claimsDir, "w1.json");
      const { fileExists } = await import("../src/io/json.mjs");

      // Step 1: Both workers check — no claim file exists
      const exists1 = await fileExists(claimPath);
      const exists2 = await fileExists(claimPath);
      assert.equal(exists1, false);
      assert.equal(exists2, false);

      // Step 2: Worker A writes claim
      const claim1 = { workItemId: "w1", workerId: "worker-A" };
      await writeJsonFile(claimPath, claim1);

      // Step 3: Worker B writes claim (overwrites A!)
      const claim2 = { workItemId: "w1", workerId: "worker-B" };
      await writeJsonFile(claimPath, claim2);

      const final = await readJsonFile(claimPath);
      console.log(`  Final claim owner: ${final.workerId}`);
      console.log(`  [BUG] Worker A thinks it has the claim (its write succeeded)`);
      console.log(`  [BUG] Worker B's write overwrote it — classic TOCTOU race`);
      console.log(`  [BUG] In real code: both workers transition board item to Claimed`);
      console.log(`  [BUG] Both workers start Running — double execution of same work item`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runtimeState overwrite across iterations", () => {
  test("loading fresh runtimeState each iteration preserves data (but not under concurrency)", async () => {
    const dir = await makeTempDir();
    const rsPath = path.join(dir, "runtime-state.json");

    try {
      const initial = { claimed: {}, running: {} };
      await writeJsonFile(rsPath, initial);

      // Iteration 1
      const rs1 = await readJsonFile(rsPath);
      rs1.claimed["w1"] = { workItemId: "w1" };
      await writeJsonFile(rsPath, rs1);

      // Iteration 2 — loads fresh, sees w1
      const rs2 = await readJsonFile(rsPath);
      assert.ok(rs2.claimed["w1"], "w1 survives between iterations");
      rs2.claimed["w2"] = { workItemId: "w2" };
      await writeJsonFile(rsPath, rs2);

      const final = await readJsonFile(rsPath);
      assert.ok(final.claimed["w1"] && final.claimed["w2"]);
      console.log("  [OK] Sequential iterations preserve data (each loads fresh)");
      console.log("  [BUG] But concurrent startNativeClaudeTask calls would race on runtimeState");
      console.log("  [BUG] orchestratorTick caches with ??= operator — startNativeClaudeTask does not");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
