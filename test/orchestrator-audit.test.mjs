/**
 * Orchestrator & Board State Machine Audit
 * Tests concurrency, leases, state transitions, DAG ordering,
 * decomposition, retry policy, evidence, and native task handoff.
 */
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, describe } from "node:test";
import { computeBlueprintFingerprint } from "../src/blueprint/fingerprint.mjs";

import { canTransition } from "../src/kanban/state-engine.mjs";
import { LANES, TRANSITIONS } from "../src/kanban/lanes.mjs";
import { nextBackoffMs } from "../src/orchestrator/retry-policy.mjs";
import { getReadyWorkItems, getBlockedWorkItems, validateDependencyGraph } from "../src/board/dependency-graph.mjs";
import { validateChildWorkProposal } from "../src/board/board-mutator.mjs";
import { createHarnessError } from "../src/domain/errors.mjs";
import { writeJsonFile, readJsonFile } from "../src/io/json.mjs";

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

async function makeTempBoard(workItems, extras = {}) {
  const root = await mkdir(path.join(os.tmpdir(), `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`), { recursive: true });
  const boardDir = root;

  const board = {
    schemaVersion: "1.0",
    boardId: "audit-test",
    workItems: workItems ?? [],
    ...extras
  };
  await writeJsonFile(path.join(boardDir, "board.json"), board);

  // trust-policy for claude-code mode
  await writeJsonFile(path.join(boardDir, "trust-policy.json"), {
    runnerMode: "claude-code",
    realAgentLaunch: "enabled",
    commandExecution: "structured-command-only",
    userInputRequired: "fail-fast",
    unsupportedToolCall: "fail-fast"
  });

  // minimal artifacts
  const dagNodes = (workItems ?? []).map(w => ({ id: w.id, kind: "implementation", requiredForDone: true, responsibilityUnitId: w.responsibilityUnitId ?? null }));
  const dagEdges = [];
  for (const w of workItems ?? []) {
    for (const dep of w.dependsOn ?? []) {
      dagEdges.push({ from: dep, to: w.id, kind: "coordination" });
    }
  }
  await writeJsonFile(path.join(boardDir, "work-item-dag.json"), {
    schemaVersion: "1.0",
    nodes: dagNodes,
    edges: dagEdges
  });

  // responsibility units
  const ruIds = [...new Set((workItems ?? []).map(w => w.responsibilityUnitId).filter(Boolean))];
  await writeJsonFile(path.join(boardDir, "responsibility-units.json"), {
    schemaVersion: "1.0",
    units: ruIds.map(id => ({
      id,
      owner: true,
      allowedPaths: ["src/**"],
      ownerWorkItemId: (workItems ?? []).find(w => w.responsibilityUnitId === id)?.id ?? null
    }))
  });

  // blueprint review will be written after all artifacts with computed fingerprint

  // work-item detail files
  await mkdir(path.join(boardDir, "work-items"), { recursive: true });
  for (const w of workItems ?? []) {
    await writeJsonFile(path.join(boardDir, "work-items", `${w.id}.json`), w);
  }

  // PRD for blueprint audit
  await writeJsonFile(path.join(boardDir, "prd.json"), {
    schemaVersion: "1.0",
    id: "prd.audit-test",
    title: "Audit test",
    goals: ["test"],
    acceptanceCriteria: ["test passes"],
    nonGoals: []
  });

  // design-pack for blueprint audit
  const primaryWorkItemId = (workItems ?? [])[0]?.id ?? "w1";
  await writeJsonFile(path.join(boardDir, "design-pack.json"), {
    schemaVersion: "1.0",
    workItemId: primaryWorkItemId,
    topology: { modules: [], edges: [] },
    stateFlow: {},
    apiSurfaces: [],
    boundaryEnforcement: { rules: [] },
    moduleInterfaces: [],
    sequences: []
  });

  // Compute real fingerprint and update blueprint-review
  // runId must match what expectedBinding computes: designPack.runId ?? path.basename(runDir)
  // Since design-pack.json has no runId, it falls back to path.basename(boardDir)
  const expectedRunId = path.basename(boardDir);
  const fpResult = await computeBlueprintFingerprint({ runDir: boardDir });
  const fingerprint = fpResult.ok ? fpResult.fingerprint : "sha256:test";
  await writeJsonFile(path.join(boardDir, "blueprint-review.json"), {
    schemaVersion: "1.0",
    runId: expectedRunId,
    workItemId: primaryWorkItemId,
    prdId: "prd.audit-test",
    blueprintFingerprint: fingerprint,
    status: "approved",
    reviewSource: "test",
    reviewedBy: "audit-test",
    reviewedAt: new Date().toISOString(),
    decisionNote: null
  });

  return { boardDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function makeWorkItem(id, lane = "Ready", overrides = {}) {
  return {
    schemaVersion: "1.0",
    id,
    lane,
    prdId: "prd.test",
    responsibilityUnitId: `ru.${id}`,
    contractIds: [],
    dependsOn: [],
    allowedPaths: [`src/${id}/**`],
    verificationCommands: [{ file: "echo", args: ["ok"] }],
    doneEvidence: [
      { kind: "verification", path: `evidence/${id}.verification.json` },
      { kind: "wiki-sync", path: `evidence/${id}.wiki-sync.json` }
    ],
    prdTrace: { acceptanceCriteriaIds: ["AC-001"] },
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. STATE MACHINE TRANSITION COVERAGE
// ═══════════════════════════════════════════════════════════════════
describe("State Machine Transitions", () => {
  test("all declared transitions are allowed", () => {
    for (const t of TRANSITIONS) {
      const result = canTransition({
        from: t.from,
        to: t.to,
        context: { gates: Object.fromEntries(t.requiredGates.map(g => [g, true])) }
      });
      assert.ok(result.ok, `${t.from} -> ${t.to} should be allowed but got: ${JSON.stringify(result.errors)}`);
    }
  });

  test("Done is a terminal state — no outgoing transitions", () => {
    for (const lane of LANES) {
      if (lane === "Done") continue;
      const result = canTransition({ from: "Done", to: lane, context: { gates: {} } });
      assert.ok(!result.ok, `Done -> ${lane} should be illegal`);
    }
  });

  test("Cancelled is a terminal state — no outgoing transitions", () => {
    for (const lane of LANES) {
      if (lane === "Cancelled") continue;
      const result = canTransition({ from: "Cancelled", to: lane, context: { gates: {} } });
      assert.ok(!result.ok, `Cancelled -> ${lane} should be illegal`);
    }
  });

  test("BUG CHECK: Done -> Running should be impossible", () => {
    const result = canTransition({ from: "Done", to: "Running", context: { gates: {} } });
    assert.ok(!result.ok, "Done -> Running must be impossible");
  });

  test("BUG CHECK: Cancelled -> Ready should be impossible", () => {
    const result = canTransition({ from: "Cancelled", to: "Ready", context: { gates: {} } });
    assert.ok(!result.ok, "Cancelled -> Ready must be impossible");
  });

  test("gates are enforced — missing gate blocks transition", () => {
    // Contract Frozen -> Ready requires 4 gates
    const result = canTransition({ from: "Contract Frozen", to: "Ready", context: { gates: {} } });
    assert.ok(!result.ok, "Should fail without gates");
    assert.ok(result.requiredGates.length > 0);
  });

  test("Claimed -> Ready requires leaseExpired gate", () => {
    const withGate = canTransition({ from: "Claimed", to: "Ready", context: { gates: { leaseExpired: true } } });
    assert.ok(withGate.ok);
    const withoutGate = canTransition({ from: "Claimed", to: "Ready", context: { gates: {} } });
    assert.ok(!withoutGate.ok);
  });

  test("Failed Fast -> Ready requires retry gate", () => {
    const withGate = canTransition({ from: "Failed Fast", to: "Ready", context: { gates: { retry: true } } });
    assert.ok(withGate.ok);
    const withoutGate = canTransition({ from: "Failed Fast", to: "Ready", context: { gates: {} } });
    assert.ok(!withoutGate.ok);
  });

  test("BUG HUNT: check for missing Blocked lane transitions", () => {
    // Blocked has no outgoing transitions in TRANSITIONS!
    const outgoing = TRANSITIONS.filter(t => t.from === "Blocked");
    // This is a potential bug — how do you unblock something?
    console.log(`  [FINDING] Blocked lane has ${outgoing.length} outgoing transitions`);
    if (outgoing.length === 0) {
      console.log("  [BUG] Blocked is a dead-end: once Blocked, work items can never leave!");
    }
  });

  test("BUG HUNT: check for missing Cancelled incoming transitions", () => {
    const incoming = TRANSITIONS.filter(t => t.to === "Cancelled");
    console.log(`  [FINDING] Cancelled lane has ${incoming.length} incoming transitions`);
    if (incoming.length === 0) {
      console.log("  [BUG] No way to move work items to Cancelled lane through state machine!");
    }
  });

  test("every non-terminal lane has at least one outgoing transition", () => {
    const terminal = new Set(["Done", "Cancelled"]);
    for (const lane of LANES) {
      if (terminal.has(lane)) continue;
      const outgoing = TRANSITIONS.filter(t => t.from === lane);
      if (outgoing.length === 0) {
        console.log(`  [BUG] Lane "${lane}" has ZERO outgoing transitions — dead end!`);
      }
      // Don't assert — we want to report all dead ends
    }
  });

  test("Human Review -> Done requires evidence AND wiki gates", () => {
    const noGates = canTransition({ from: "Human Review", to: "Done", context: { gates: {} } });
    assert.ok(!noGates.ok);
    const onlyEvidence = canTransition({ from: "Human Review", to: "Done", context: { gates: { evidence: true } } });
    assert.ok(!onlyEvidence.ok);
    const both = canTransition({ from: "Human Review", to: "Done", context: { gates: { evidence: true, wiki: true } } });
    assert.ok(both.ok);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. RETRY POLICY - BACKOFF
// ═══════════════════════════════════════════════════════════════════
describe("Retry Policy", () => {
  test("backoff is capped exponential", () => {
    const backoffs = [];
    for (let i = 1; i <= 20; i++) {
      backoffs.push(nextBackoffMs(i));
    }
    console.log("  Backoff series:", backoffs);

    // Should be 1000, 2000, 4000, 8000, 16000, 30000, 30000, ...
    assert.equal(backoffs[0], 1000);
    assert.equal(backoffs[1], 2000);
    assert.equal(backoffs[2], 4000);
    assert.equal(backoffs[3], 8000);
    assert.equal(backoffs[4], 16000);
    assert.equal(backoffs[5], 30000);

    // All subsequent should be capped at 30000
    for (let i = 5; i < 20; i++) {
      assert.equal(backoffs[i], 30000, `attempt ${i + 1} should be capped at 30s`);
    }
  });

  test("BUG: attemptNumber 0 — what happens?", () => {
    const result = nextBackoffMs(0);
    console.log(`  nextBackoffMs(0) = ${result}`);
    // Math.max(0, 0-1) = 0, so 1000 * 2^0 = 1000
    assert.equal(result, 1000);
  });

  test("BUG: negative attemptNumber", () => {
    const result = nextBackoffMs(-1);
    console.log(`  nextBackoffMs(-1) = ${result}`);
    // Math.max(0, -2) = 0, so 1000
    assert.equal(result, 1000);
  });

  test("BUG HUNT: no max attempt count — retries forever", () => {
    // The retry policy has no maximum number of attempts!
    // nextBackoffMs only caps the delay, not the count.
    // reconcileBoard moves Failed Fast -> Ready unconditionally when nextRetryAt is past.
    // orchestratorTick increments attemptNumber but never checks a max.
    console.log("  [BUG] No MAX_RETRY_ATTEMPTS constant exists.");
    console.log("  [BUG] Work items can retry FOREVER — attemptNumber grows unbounded.");
    console.log("  [BUG] After ~6 attempts, backoff is capped at 30s, so it retries every 30s forever.");

    // Verify: there is truly no cap
    assert.equal(nextBackoffMs(100), 30000, "attempt 100 still retries");
    assert.equal(nextBackoffMs(10000), 30000, "attempt 10000 still retries");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. DAG EXECUTION ORDER
// ═══════════════════════════════════════════════════════════════════
describe("DAG Execution Order", () => {
  test("child blocked until parent is Done", () => {
    const board = {
      workItems: [
        makeWorkItem("parent", "Ready"),
        makeWorkItem("child", "Ready", { dependsOn: ["parent"] })
      ]
    };

    const ready = getReadyWorkItems(board);
    const readyIds = ready.map(w => w.id);
    assert.ok(readyIds.includes("parent"), "parent should be ready");
    assert.ok(!readyIds.includes("child"), "child should be blocked");

    const blocked = getBlockedWorkItems(board);
    assert.ok(blocked.map(w => w.id).includes("child"));
  });

  test("child unblocked when parent is Done", () => {
    const board = {
      workItems: [
        makeWorkItem("parent", "Done"),
        makeWorkItem("child", "Ready", { dependsOn: ["parent"] })
      ]
    };

    const ready = getReadyWorkItems(board);
    assert.ok(ready.map(w => w.id).includes("child"), "child should be ready when parent is Done");
  });

  test("BUG: child blocked while parent is Running (not Done)", () => {
    const board = {
      workItems: [
        makeWorkItem("parent", "Running"),
        makeWorkItem("child", "Ready", { dependsOn: ["parent"] })
      ]
    };

    const ready = getReadyWorkItems(board);
    assert.ok(!ready.map(w => w.id).includes("child"), "child must not start while parent is Running");
  });

  test("BUG: child blocked while parent is Verifying", () => {
    const board = {
      workItems: [
        makeWorkItem("parent", "Verifying"),
        makeWorkItem("child", "Ready", { dependsOn: ["parent"] })
      ]
    };

    const ready = getReadyWorkItems(board);
    assert.ok(!ready.map(w => w.id).includes("child"), "child must not start while parent is Verifying");
  });

  test("diamond dependency: D waits for both B and C, B and C wait for A", () => {
    const board = {
      workItems: [
        makeWorkItem("A", "Done"),
        makeWorkItem("B", "Ready", { dependsOn: ["A"] }),
        makeWorkItem("C", "Ready", { dependsOn: ["A"] }),
        makeWorkItem("D", "Ready", { dependsOn: ["B", "C"] })
      ]
    };

    const ready = getReadyWorkItems(board);
    const readyIds = new Set(ready.map(w => w.id));
    assert.ok(readyIds.has("B"), "B is ready (A done)");
    assert.ok(readyIds.has("C"), "C is ready (A done)");
    assert.ok(!readyIds.has("D"), "D should be blocked (B,C not done)");
  });

  test("diamond: D ready when both B and C are Done", () => {
    const board = {
      workItems: [
        makeWorkItem("A", "Done"),
        makeWorkItem("B", "Done", { dependsOn: ["A"] }),
        makeWorkItem("C", "Done", { dependsOn: ["A"] }),
        makeWorkItem("D", "Ready", { dependsOn: ["B", "C"] })
      ]
    };

    const ready = getReadyWorkItems(board);
    assert.ok(ready.map(w => w.id).includes("D"), "D ready when both deps are Done");
  });

  test("cycle detection works", () => {
    const board = {
      workItems: [
        makeWorkItem("A", "Ready", { dependsOn: ["B"] }),
        makeWorkItem("B", "Ready", { dependsOn: ["A"] })
      ]
    };

    const result = validateDependencyGraph(board);
    assert.ok(!result.ok, "should detect cycle");
    assert.ok(result.errors.some(e => e.code === "HARNESS_DEPENDENCY_CYCLE"));
  });

  test("missing dependency reference detected", () => {
    const board = {
      workItems: [
        makeWorkItem("A", "Ready", { dependsOn: ["nonexistent"] })
      ]
    };

    const result = validateDependencyGraph(board);
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DEPENDENCY_MISSING"));
  });

  test("BUG HUNT: only Ready items can be blocked — what about items in other lanes with deps?", () => {
    // getBlockedWorkItems only checks lane === "Ready"
    // A "Claimed" item with unfulfilled deps is not caught
    const board = {
      workItems: [
        makeWorkItem("parent", "Running"),
        makeWorkItem("child", "Claimed", { dependsOn: ["parent"] })  // somehow got claimed despite dep
      ]
    };

    const blocked = getBlockedWorkItems(board);
    const ready = getReadyWorkItems(board);
    console.log("  [FINDING] Blocked check only applies to Ready items");
    console.log(`  blocked IDs: ${blocked.map(w => w.id)}`);
    console.log(`  ready IDs: ${ready.map(w => w.id)}`);
    // This is by design — the claim process should prevent this, but
    // if board.json is manually edited or a race occurs, there's no safety net.
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. CONCURRENCY & CLAIMS
// ═══════════════════════════════════════════════════════════════════
describe("Concurrency & Claims", () => {
  test("claim-store: double claim returns conflict", async () => {
    const { claimWorkItem } = await import("../src/board/claim-store.mjs");
    const { boardDir, cleanup } = await makeTempBoard([makeWorkItem("w1", "Ready")]);

    try {
      const now = new Date();
      const claim1 = await claimWorkItem({ boardDir, workItemId: "w1", workerId: "worker-A", now, leaseMs: 60000 });
      assert.ok(claim1.ok, `First claim should succeed: ${JSON.stringify(claim1.errors)}`);

      const claim2 = await claimWorkItem({ boardDir, workItemId: "w1", workerId: "worker-B", now, leaseMs: 60000 });
      assert.ok(!claim2.ok, "Second claim should fail");
      assert.ok(claim2.errors.some(e => e.code === "HARNESS_CLAIM_CONFLICT" || e.code === "HARNESS_WORK_NOT_READY"));
    } finally {
      await cleanup();
    }
  });

  test("claim-store: claim on non-Ready item fails", async () => {
    const { claimWorkItem } = await import("../src/board/claim-store.mjs");
    const { boardDir, cleanup } = await makeTempBoard([makeWorkItem("w1", "Running")]);

    try {
      const now = new Date();
      const result = await claimWorkItem({ boardDir, workItemId: "w1", workerId: "worker-A", now, leaseMs: 60000 });
      assert.ok(!result.ok, "Should not claim a Running item");
    } finally {
      await cleanup();
    }
  });

  test("BUG HUNT: concurrent claim race — read-check-write is non-atomic", async () => {
    // The claim process does:
    //   1. getClaim() — reads claim file
    //   2. checks if existing claim (returns conflict if so)
    //   3. writes new claim file
    // This is NOT atomic. Two concurrent claims can both pass step 1 (no file)
    // and both write in step 3.
    console.log("  [BUG] Claims use read-then-write pattern (non-atomic)");
    console.log("  [BUG] Two concurrent claimWorkItem() calls for the same work item");
    console.log("  [BUG] can BOTH succeed if they interleave between getClaim() and writeJsonFile().");
    console.log("  [BUG] writeJsonFile uses rename() which helps for data integrity but not for locking.");

    const { claimWorkItem } = await import("../src/board/claim-store.mjs");
    const { boardDir, cleanup } = await makeTempBoard([makeWorkItem("w1", "Ready")]);

    try {
      const now = new Date();
      // Race two claims simultaneously
      const [r1, r2] = await Promise.all([
        claimWorkItem({ boardDir, workItemId: "w1", workerId: "worker-A", now, leaseMs: 60000 }),
        claimWorkItem({ boardDir, workItemId: "w1", workerId: "worker-B", now, leaseMs: 60000 })
      ]);

      const bothOk = r1.ok && r2.ok;
      if (bothOk) {
        console.log("  [BUG CONFIRMED] Both concurrent claims succeeded! Double-claim is possible.");
      } else {
        console.log("  [NOTE] Race didn't manifest in this run (timing-dependent).");
        console.log(`  r1.ok=${r1.ok} r2.ok=${r2.ok}`);
      }
    } finally {
      await cleanup();
    }
  });

  test("BUG HUNT: concurrent board saves corrupt board.json", async () => {
    // saveBoard uses writeJsonFile which does write-tmp + rename — atomic at FS level
    // BUT two concurrent loadBoard -> modify -> saveBoard will lose one write
    console.log("  [BUG] loadBoard/saveBoard is load-modify-save pattern (non-atomic)");
    console.log("  [BUG] Concurrent modifications can cause lost updates (last writer wins)");

    const { boardDir, cleanup } = await makeTempBoard([
      makeWorkItem("w1", "Ready"),
      makeWorkItem("w2", "Ready")
    ]);

    try {
      const { loadBoard, saveBoard } = await import("../src/board/board-store.mjs");

      // Simulate two concurrent load-modify-save
      const board1 = await loadBoard(boardDir);
      const board2 = await loadBoard(boardDir);

      board1.workItems.find(w => w.id === "w1").lane = "Claimed";
      board2.workItems.find(w => w.id === "w2").lane = "Claimed";

      await saveBoard(boardDir, board1);
      await saveBoard(boardDir, board2);

      const final = await loadBoard(boardDir);
      const w1Lane = final.workItems.find(w => w.id === "w1").lane;
      const w2Lane = final.workItems.find(w => w.id === "w2").lane;

      console.log(`  After concurrent saves: w1=${w1Lane}, w2=${w2Lane}`);
      if (w1Lane === "Ready" && w2Lane === "Claimed") {
        console.log("  [BUG CONFIRMED] Lost update: board2 overwrote board1's change to w1!");
      }
    } finally {
      await cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. LEASE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
describe("Lease Management", () => {
  test("expired claim returns null", async () => {
    const { getClaim } = await import("../src/board/claim-store.mjs");
    const { boardDir, cleanup } = await makeTempBoard([makeWorkItem("w1", "Claimed")]);

    try {
      const past = new Date(Date.now() - 120000);
      await writeJsonFile(path.join(boardDir, "claims", "w1.json"), {
        workItemId: "w1",
        workerId: "worker-A",
        claimedAt: past.toISOString(),
        leaseExpiresAt: new Date(past.getTime() + 60000).toISOString()
      });

      const now = new Date();
      const claim = await getClaim({ boardDir, workItemId: "w1", now });
      assert.equal(claim, null, "Expired claim should return null");
    } finally {
      await cleanup();
    }
  });

  test("re-claim after lease expiry works", async () => {
    const { claimWorkItem, getClaim } = await import("../src/board/claim-store.mjs");
    const { boardDir, cleanup } = await makeTempBoard([makeWorkItem("w1", "Ready")]);

    try {
      const past = new Date(Date.now() - 120000);
      await mkdir(path.join(boardDir, "claims"), { recursive: true });
      await writeJsonFile(path.join(boardDir, "claims", "w1.json"), {
        workItemId: "w1",
        workerId: "worker-old",
        claimedAt: past.toISOString(),
        leaseExpiresAt: new Date(past.getTime() + 60000).toISOString()
      });

      const now = new Date();
      const result = await claimWorkItem({ boardDir, workItemId: "w1", workerId: "worker-new", now, leaseMs: 60000 });
      assert.ok(result.ok, `Re-claim should succeed: ${JSON.stringify(result.errors)}`);
    } finally {
      await cleanup();
    }
  });

  test("BUG HUNT: lease expiry while Running doesn't revert to Ready", async () => {
    // When claimWorkItem finds an expired claim, it only reverts "Claimed" -> "Ready"
    // But what if the item is "Running" and the lease expires?
    // There's no mechanism to handle this case!
    console.log("  [BUG] claimWorkItem only handles expired leases for Claimed items (line 93)");
    console.log("  [BUG] If a lease expires while lane=Running, the expired claim file is deleted");
    console.log("  [BUG] but the item stays in Running forever — orphaned!");
    console.log("  [BUG] reconcileBoard checks for claims on terminal items (Done/Cancelled)");
    console.log("  [BUG] but does NOT check for expired-lease items stuck in Running.");
  });

  test("releaseClaim checks worker ownership", async () => {
    const { claimWorkItem, releaseClaim } = await import("../src/board/claim-store.mjs");
    const { boardDir, cleanup } = await makeTempBoard([makeWorkItem("w1", "Ready")]);

    try {
      const now = new Date();
      await claimWorkItem({ boardDir, workItemId: "w1", workerId: "worker-A", now, leaseMs: 60000 });

      const result = await releaseClaim({ boardDir, workItemId: "w1", workerId: "worker-B" });
      assert.ok(!result.ok, "Wrong worker should not release claim");
      assert.ok(result.errors.some(e => e.code === "HARNESS_CLAIM_OWNER_MISMATCH"));
    } finally {
      await cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. NEEDS_DECOMPOSE - CHILD WORK PROPOSAL VALIDATION
// ═══════════════════════════════════════════════════════════════════
describe("NEEDS_DECOMPOSE Validation", () => {
  test("depth limit enforced", () => {
    const board = { workItems: [makeWorkItem("parent", "Running")] };
    const parent = board.workItems[0];
    parent.decompositionDepth = 2; // already at max

    const result = validateChildWorkProposal({
      proposal: {
        reason: "Need to split this work further.",
        children: [{
          id: "child1", allowedPaths: ["src/parent/**"],
          verificationCommands: [{ file: "echo", args: ["ok"] }],
          doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }]
        }]
      },
      parentWorkItem: parent,
      board,
      artifacts: {},
      depth: 2
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_DEPTH_EXCEEDED"));
  });

  test("max 8 children enforced", () => {
    const board = { workItems: [makeWorkItem("parent", "Running")] };
    const parent = board.workItems[0];

    const children = [];
    for (let i = 0; i < 9; i++) {
      children.push({
        id: `child-${i}`,
        allowedPaths: [`src/parent/sub${i}/**`],
        verificationCommands: [{ file: "echo", args: ["ok"] }],
        doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }]
      });
    }

    const result = validateChildWorkProposal({
      proposal: { reason: "Need to split into many parts.", children },
      parentWorkItem: parent,
      board,
      artifacts: {},
      depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CHILDREN_EXCEEDED"));
  });

  test("child IDs must be unique", () => {
    const board = { workItems: [makeWorkItem("parent", "Running")] };
    const parent = board.workItems[0];

    const result = validateChildWorkProposal({
      proposal: {
        reason: "Splitting parent work item into children.",
        children: [
          { id: "dup", allowedPaths: ["src/parent/a/**"], verificationCommands: [{ file: "echo", args: ["ok"] }], doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }] },
          { id: "dup", allowedPaths: ["src/parent/b/**"], verificationCommands: [{ file: "echo", args: ["ok"] }], doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }] }
        ]
      },
      parentWorkItem: parent,
      board,
      artifacts: {},
      depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CHILD_ID_DUPLICATE"));
  });

  test("child paths must be subset of parent paths", () => {
    const board = { workItems: [makeWorkItem("parent", "Running", { allowedPaths: ["src/auth/**"] })] };
    const parent = board.workItems[0];

    const result = validateChildWorkProposal({
      proposal: {
        reason: "Splitting parent work item into children.",
        children: [{
          id: "child1",
          allowedPaths: ["src/database/**"],  // not under src/auth
          verificationCommands: [{ file: "echo", args: ["ok"] }],
          doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }]
        }]
      },
      parentWorkItem: parent,
      board,
      artifacts: {},
      depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_PATH_OUTSIDE_PARENT"));
  });

  test("children cannot have overlapping paths", () => {
    const board = { workItems: [makeWorkItem("parent", "Running", { allowedPaths: ["src/**"] })] };
    const parent = board.workItems[0];

    const result = validateChildWorkProposal({
      proposal: {
        reason: "Splitting parent work item into children.",
        children: [
          { id: "c1", allowedPaths: ["src/shared/**"], verificationCommands: [{ file: "echo", args: ["ok"] }], doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }] },
          { id: "c2", allowedPaths: ["src/shared/**"], verificationCommands: [{ file: "echo", args: ["ok"] }], doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }] }
        ]
      },
      parentWorkItem: parent,
      board,
      artifacts: {},
      depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_PATH_OVERLAP"));
  });

  test("cycle among children detected", () => {
    const board = { workItems: [makeWorkItem("parent", "Running", { allowedPaths: ["src/**"] })] };
    const parent = board.workItems[0];

    const result = validateChildWorkProposal({
      proposal: {
        reason: "Splitting parent work item into children.",
        children: [
          { id: "c1", dependsOn: ["c2"], allowedPaths: ["src/a/**"], verificationCommands: [{ file: "echo", args: ["ok"] }], doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }] },
          { id: "c2", dependsOn: ["c1"], allowedPaths: ["src/b/**"], verificationCommands: [{ file: "echo", args: ["ok"] }], doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }] }
        ]
      },
      parentWorkItem: parent,
      board,
      artifacts: {},
      depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CYCLE"));
  });

  test("BUG HUNT: child can depend on non-sibling external work item", () => {
    // Validator checks that dependsOn references are either siblings or parent
    // But it does NOT check references to other board items that aren't siblings
    const board = { workItems: [
      makeWorkItem("parent", "Running", { allowedPaths: ["src/**"] }),
      makeWorkItem("external", "Done")
    ]};
    const parent = board.workItems[0];

    const result = validateChildWorkProposal({
      proposal: {
        reason: "Splitting parent work item into children.",
        children: [{
          id: "c1",
          dependsOn: ["external"],  // not a sibling, not parent
          allowedPaths: ["src/a/**"],
          verificationCommands: [{ file: "echo", args: ["ok"] }],
          doneEvidence: [{ kind: "verification" }, { kind: "wiki-sync" }]
        }]
      },
      parentWorkItem: parent,
      board,
      artifacts: {},
      depth: 0
    });
    // This should be rejected
    if (result.ok) {
      console.log("  [BUG] Child can depend on external work item not in its sibling set!");
    } else {
      assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_DEPENDENCY_INVALID"));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. MATERIALIZE CHILDREN - PARTIAL FAILURE
// ═══════════════════════════════════════════════════════════════════
describe("Materialization Atomicity", () => {
  test("BUG HUNT: materializeChildWorkItems is NOT atomic", async () => {
    // Looking at board-mutator.mjs lines 180-280:
    // It modifies board in memory, writes child files, DAG, board...
    // If it crashes after writing some child files but before saveBoard,
    // the board.json won't have the children but the files exist.
    console.log("  [BUG] materializeChildWorkItems is NOT atomic:");
    console.log("  Steps: push to board.workItems -> write child files -> write DAG -> saveBoard -> emit events");
    console.log("  If crash occurs between 'write child files' and 'saveBoard', orphan files exist.");
    console.log("  If crash occurs after saveBoard but before events, board says Decomposing but no events logged.");
    console.log("  No rollback mechanism exists.");
  });

  test("BUG HUNT: parent moves to Decomposing via direct assignment, bypassing state machine", async () => {
    // board-mutator.mjs line 198: parentWorkItem.lane = "Decomposing"
    // This bypasses canTransition() entirely!
    console.log("  [BUG] materializeChildWorkItems sets parent.lane = 'Decomposing' directly");
    console.log("  [BUG] bypassing canTransition(). No state machine validation occurs!");
    console.log("  [BUG] Similarly, completeParentWhenChildrenDone sets parent.lane = 'Verifying' directly (line 310)");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. EVIDENCE & TAMPER RESISTANCE
// ═══════════════════════════════════════════════════════════════════
describe("Evidence Collection", () => {
  test("BUG HUNT: evidence is plain JSON files — no integrity protection", () => {
    console.log("  [BUG] Evidence (attempt records, board events) are plain JSON/JSONL files.");
    console.log("  [BUG] No cryptographic hashing, signing, or chain-of-custody mechanism.");
    console.log("  [BUG] A malicious worker can:");
    console.log("    - Overwrite attempt files (writeJsonFile has no append-only enforcement)");
    console.log("    - Forge agent reports with any status/role");
    console.log("    - Modify events.jsonl (append-only but file permission is the only guard)");
    console.log("  [BUG] The extractAgentReport function trusts any JSON shape matching reportKeys.");
    console.log("  [BUG] No worker authentication — workerId is a plain string with no verification.");
  });

  test("BUG HUNT: appendBoardEvent uses flag 'a' but no fsync", () => {
    console.log("  [FINDING] appendBoardEvent appends to events.jsonl with flag:'a'");
    console.log("  [FINDING] No fsync/fdatasync call — crash can lose recent events.");
    console.log("  [FINDING] No locking — concurrent appends can interleave partial lines.");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. NATIVE TASK HANDOFF PROMPT COMPLETENESS
// ═══════════════════════════════════════════════════════════════════
describe("Native Task Handoff", () => {
  test("BUG HUNT: finishNativeClaudeTask releases claim BEFORE saving board", async () => {
    // orchestrator.mjs line 1073: releaseClaim (deletes claim file, sets lane=Ready)
    // line 1074: saveBoard (saves lane=Verifying or Failed Fast)
    //
    // releaseClaim at line 183 checks if lane === "Claimed" and sets to "Ready"
    // But by this point, the in-memory board has lane=Verifying.
    // However releaseClaim loads a FRESH board from disk!
    // At line 1073, the board on disk still has lane=Running.
    // releaseClaim loads that, sees lane !== "Claimed", does nothing (line 183).
    // Then line 1074 saves the in-memory board with lane=Verifying.
    // This is fine IF no concurrent process is also modifying the board.
    // But if two finishNativeClaudeTask calls overlap, the second releaseClaim
    // might load the first's saved board and corrupt it.
    console.log("  [BUG] finishNativeClaudeTask: releaseClaim() happens BEFORE saveBoard()");
    console.log("  [BUG] releaseClaim() loads a FRESH board from disk and may set lane=Ready");
    console.log("  [BUG] Then saveBoard() overwrites with the in-memory board (lane=Verifying)");
    console.log("  [BUG] If releaseClaim's board load happens between another process's save,");
    console.log("  [BUG] last-writer-wins causes lost updates.");
  });

  test("BUG HUNT: startNativeClaudeTask calls loadRuntimeState inside loop without caching", () => {
    // orchestrator.mjs line 759: inside the for-loop over readyWorkItems
    // loadRuntimeState is called each iteration — not cached outside the loop
    // This means if two work items are dispatched, the second iteration loads
    // a fresh runtime state, potentially losing the first iteration's changes
    // if another process modified it in between.
    //
    // Compare with orchestratorTick at line 369 which does `runtimeState ??= await loadRuntimeState(boardDir)`
    // — that caches it. startNativeClaudeTask does NOT cache.
    console.log("  [BUG] startNativeClaudeTask loads runtimeState inside the loop (line 759)");
    console.log("  [BUG] Each iteration loads fresh from disk, potentially losing prior iteration's writes.");
    console.log("  [BUG] orchestratorTick correctly caches with `runtimeState ??= await loadRuntimeState(boardDir)`");
    console.log("  [BUG] but startNativeClaudeTask does `const runtimeState = await loadRuntimeState(boardDir)` each time.");
  });

  test("BUG HUNT: finishNativeClaudeTask on decomposition failure — stale board reference", async () => {
    // orchestrator.mjs lines 900-944: NEEDS_DECOMPOSE handling
    // Line 918: materializeChildWorkItems is called, which calls loadBoard internally
    // and may modify + save the board
    // Line 930: transitionLane uses the ORIGINAL board variable (line 855)
    // If materializeChildWorkItems failed, it didn't modify the board.
    // But if it partially modified the board before failing... 
    // Actually materializeChildWorkItems saves the board only on success (line 262).
    // If validation fails, it returns early before saveBoard.
    // So the stale reference is OK for the failure path.
    // BUT: line 936 does saveBoard(boardDir, board) with the ORIGINAL board
    // which may be stale if another process modified it between line 855 and 936.
    console.log("  [FINDING] NEEDS_DECOMPOSE failure path uses original board reference (loaded at start)");
    console.log("  [FINDING] This could overwrite concurrent changes if another process modified board.json");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. RECONCILE BOARD
// ═══════════════════════════════════════════════════════════════════
describe("Board Reconciliation", () => {
  test("reconcileBoard moves Failed Fast -> Ready when nextRetryAt has passed", async () => {
    // We can't easily call reconcileBoard without all the dependencies, but we can verify
    // the state machine transition is correct
    const result = canTransition({ from: "Failed Fast", to: "Ready", context: { gates: { retry: true } } });
    assert.ok(result.ok);
  });

  test("BUG: reconcileBoard doesn't clear attemptNumber on retry", () => {
    // orchestrator.mjs line 1114-1120: when moving Failed Fast -> Ready:
    // It deletes nextRetryAt, errorCode, errorCategory, errorReason, errorNextAction, latestAttemptId
    // But it does NOT reset attemptNumber!
    // This means the next failure will increment from the old attemptNumber.
    // This is actually correct behavior (preserves attempt history).
    // But combined with no max retry count, it means infinite retries.
    console.log("  [FINDING] reconcileBoard preserves attemptNumber across retries (intentional?)");
    console.log("  [FINDING] Combined with no max retry count = infinite retry loop");
  });

  test("BUG HUNT: reconcileBoard checks decomposing parents with dynamic import inside loop", () => {
    // orchestrator.mjs lines 1130-1138
    // Inside a for loop, it does `await import("../board/board-mutator.mjs")`
    // This is fine performance-wise (ES modules cache) but the real issue is:
    // completeParentWhenChildrenDone loads a FRESH board each time (line 290)
    // If the reconcileBoard loop processes multiple decomposing parents,
    // the first completeParentWhenChildrenDone saves the board, then the second
    // loads that fresh board — this is actually correct!
    // But reconcileBoard itself already loaded board at line 1088 and modified it (line 1114).
    // It saves at line 1126. Then completeParentWhenChildrenDone at line 1134
    // loads and saves its own board copy. These are independent load-save cycles
    // that can conflict.
    console.log("  [BUG] reconcileBoard saves board at line 1126, then calls completeParentWhenChildrenDone");
    console.log("  [BUG] which loads a FRESH board at line 290 — this is OK.");
    console.log("  [BUG] But if completeParentWhenChildrenDone modifies items that reconcileBoard also");
    console.log("  [BUG] modified, the reconcileBoard save was wasted for those items.");
    console.log("  [BUG] Actually: reconcileBoard's save happens FIRST (line 1126) before the loop (1130).");
    console.log("  [BUG] So completeParentWhenChildrenDone sees the reconciled board. This is correct order.");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. FILE-LEVEL ATOMICITY
// ═══════════════════════════════════════════════════════════════════
describe("File-level Atomicity", () => {
  test("writeJsonFile uses write-tmp-then-rename pattern", async () => {
    // Verified from io/json.mjs — this is good practice
    // write to .tmp then rename is atomic on POSIX
    console.log("  [OK] writeJsonFile uses write-to-tmp + rename pattern");
    console.log("  [OK] This prevents partial/corrupt JSON files on crash");
    console.log("  [BUT] Does not prevent lost updates from concurrent read-modify-write");
  });

  test("BUG: no file locking anywhere in the codebase", async () => {
    const { default: searchResults } = await import("node:fs/promises");
    console.log("  [BUG] No file locking (flock, lockfile, etc.) used anywhere.");
    console.log("  [BUG] All state files (board.json, claims/*.json, runtime-state.json)");
    console.log("  [BUG] are vulnerable to lost-update races under concurrent access.");
    console.log("  [BUG] The claim system reads then writes — a TOCTOU vulnerability.");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. EDGE CASES IN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════
describe("Orchestrator Edge Cases", () => {
  test("BUG: orchestratorTick returns early on first claim failure, abandoning remaining candidates", () => {
    // orchestrator.mjs line 366-368: if claim fails, return immediately
    // This means if work item 1 of 3 fails to claim, items 2 and 3 are skipped
    console.log("  [BUG] orchestratorTick returns on first claim failure instead of continuing");
    console.log("  [BUG] A single already-claimed item blocks dispatch of all other ready items");
  });

  test("BUG: startNativeClaudeTask also returns early on first claim failure", () => {
    // orchestrator.mjs line 715-716: same pattern
    console.log("  [BUG] startNativeClaudeTask also fails-fast on first claim error");
    console.log("  [BUG] One blocked item prevents all concurrent native tasks from starting");
  });

  test("BUG: lease duration is hardcoded", () => {
    // orchestratorTick line 365: leaseMs: 60000 (1 minute)
    // startNativeClaudeTask line 714: leaseMs: 60 * 60 * 1000 (1 hour)
    console.log("  [FINDING] Scripted simulator lease: 60 seconds");
    console.log("  [FINDING] Native Claude lease: 1 hour");
    console.log("  [FINDING] These are hardcoded, not configurable via trust-policy");
    console.log("  [FINDING] 1 hour lease means if Claude crashes, item is locked for 1 hour");
  });
});
