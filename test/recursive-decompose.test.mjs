import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { loadBoard, saveBoard } from "../src/board/board-store.mjs";
import { validateChildWorkProposal, materializeChildWorkItems, completeParentWhenChildrenDone } from "../src/board/board-mutator.mjs";
import { readJsonFile, writeJsonFile } from "../src/io/json.mjs";
import { finishNativeClaudeTask, startNativeClaudeTask, reconcileBoard } from "../src/orchestrator/orchestrator.mjs";
import { decideBlueprintReview } from "../src/blueprint/review.mjs";
import { canTransition } from "../src/kanban/state-engine.mjs";

// ── Validation Tests (pure, no filesystem) ─────────────────────────

describe("validateChildWorkProposal", () => {
  const baseBoard = {
    workItems: [
      { id: "work.parent", lane: "Running", allowedPaths: ["src/auth/**"],
        contractIds: ["contract.auth"], decompositionDepth: 0 }
    ]
  };
  const baseParent = baseBoard.workItems[0];
  const baseArtifacts = { workItemDag: { nodes: [], edges: [] } };

  function validChild(id, allowedPaths) {
    return {
      id,
      allowedPaths: allowedPaths ?? [`src/auth/${id}/**`],
      contractIds: [],
      dependsOn: [],
      responsibilityUnitId: `ru.${id}`,
      verificationCommands: [{ file: "npm", args: ["test"] }],
      doneEvidence: [
        { kind: "verification", path: `ev/${id}-v.json` },
        { kind: "wiki-sync", path: `ev/${id}-w.json` }
      ]
    };
  }

  test("accepts valid 2-child proposal", () => {
    const proposal = {
      reason: "Too complex for single implementation",
      children: [
        validChild("child-a", ["src/auth/hasher/**"]),
        { ...validChild("child-b", ["src/auth/api/**"]), dependsOn: ["child-a"] }
      ]
    };
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(result.ok, result.errors.map(e => e.reason).join("; "));
  });

  test("rejects depth > MAX", () => {
    const proposal = {
      reason: "Split needed for deep nesting",
      children: [validChild("c1", ["src/auth/x/**"])]
    };
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: { ...baseParent, decompositionDepth: 2 },
      board: baseBoard, artifacts: baseArtifacts, depth: 2
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_DEPTH_EXCEEDED"));
  });

  test("rejects overlapping child paths", () => {
    const proposal = {
      reason: "Split needed for overlapping paths",
      children: [
        validChild("c1", ["src/auth/**"]),
        validChild("c2", ["src/auth/**"])
      ]
    };
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_PATH_OVERLAP"));
  });

  test("rejects child path outside parent", () => {
    const proposal = {
      reason: "Split needed for outside path",
      children: [validChild("c1", ["src/billing/**"])]
    };
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_PATH_OUTSIDE_PARENT"));
  });

  test("rejects cyclic children dependencies", () => {
    const proposal = {
      reason: "Split needed with a dependency cycle",
      children: [
        { ...validChild("c1", ["src/auth/a/**"]), dependsOn: ["c2"] },
        { ...validChild("c2", ["src/auth/b/**"]), dependsOn: ["c1"] }
      ]
    };
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CYCLE"));
  });

  test("rejects duplicate child id", () => {
    const proposal = {
      reason: "Split needed with duplicate ids",
      children: [
        validChild("c1", ["src/auth/a/**"]),
        validChild("c1", ["src/auth/b/**"])
      ]
    };
    const result = validateChildWorkProposal({
      proposal, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CHILD_ID_DUPLICATE"));
  });

  test("rejects null proposal", () => {
    const result = validateChildWorkProposal({
      proposal: null, parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_SCHEMA_INVALID"));
  });

  test("rejects empty children array", () => {
    const result = validateChildWorkProposal({
      proposal: { reason: "some reason text here", children: [] },
      parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CHILDREN_EMPTY"));
  });

  test("rejects child missing verificationCommands", () => {
    const child = validChild("c1", ["src/auth/a/**"]);
    delete child.verificationCommands;
    const result = validateChildWorkProposal({
      proposal: { reason: "Split needed for verification", children: [child] },
      parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_VERIFICATION_MISSING"));
  });

  test("rejects child missing done evidence", () => {
    const child = validChild("c1", ["src/auth/a/**"]);
    // Doctrine: the LLM decides which evidence kinds are required; the engine
    // only enforces that *some* done-evidence plan exists. An empty plan fails.
    child.doneEvidence = [];
    const result = validateChildWorkProposal({
      proposal: { reason: "Split needed for evidence check", children: [child] },
      parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_EVIDENCE_MISSING"));
  });

  test("rejects short reason", () => {
    const result = validateChildWorkProposal({
      proposal: { reason: "short", children: [validChild("c1", ["src/auth/a/**"])] },
      parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_REASON_MISSING"));
  });

  test("rejects child id conflicting with existing board item", () => {
    const boardWithExisting = {
      workItems: [
        baseParent,
        { id: "existing-item", lane: "Ready" }
      ]
    };
    const result = validateChildWorkProposal({
      proposal: { reason: "Split needed for conflict test", children: [validChild("existing-item", ["src/auth/a/**"])] },
      parentWorkItem: baseParent, board: boardWithExisting, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_CHILD_ID_CONFLICT"));
  });

  test("rejects child depending on non-sibling non-parent", () => {
    const result = validateChildWorkProposal({
      proposal: {
        reason: "Split needed for dependency check",
        children: [{ ...validChild("c1", ["src/auth/a/**"]), dependsOn: ["unknown-external"] }]
      },
      parentWorkItem: baseParent, board: baseBoard, artifacts: baseArtifacts, depth: 0
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_DEPENDENCY_INVALID"));
  });
});

// ── Lane Transition Tests ──────────────────────────────────────────

describe("Decomposing lane transitions", () => {
  test("Running can transition to Decomposing", () => {
    const result = canTransition({ from: "Running", to: "Decomposing", context: { gates: {} } });
    assert.ok(result.ok);
  });

  test("Decomposing requires childrenComplete gate to transition to Verifying", () => {
    const blocked = canTransition({ from: "Decomposing", to: "Verifying", context: { gates: {} } });
    assert.ok(!blocked.ok);
    assert.deepEqual(blocked.requiredGates, ["childrenComplete"]);

    const allowed = canTransition({ from: "Decomposing", to: "Verifying", context: { gates: { childrenComplete: true } } });
    assert.ok(allowed.ok);
  });

  test("Decomposing cannot jump directly to Done", () => {
    const result = canTransition({ from: "Decomposing", to: "Done", context: { gates: {} } });
    assert.ok(!result.ok);
    assert.equal(result.errors[0].code, "HARNESS_TRANSITION_ILLEGAL");
  });
});

// ── Materialize & Complete Tests (require filesystem) ──────────────

async function withBoardFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-decompose-"));
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(root, "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ root, boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function addParentWorkItem(boardDir, overrides = {}) {
  const board = await loadBoard(boardDir);
  // Mark all existing Ready items as Done so they don't interfere
  for (const item of board.workItems) {
    if (item.lane === "Ready") {
      item.lane = "Done";
    }
  }
  const parentWorkItem = {
    id: "work.decompose-parent",
    lane: "Ready",
    title: "Auth system",
    responsibilityUnitId: "ru.auth-parent",
    allowedPaths: ["src/auth/**"],
    contractIds: ["contract.auth"],
    decompositionDepth: 0,
    ...overrides
  };
  board.workItems.push(parentWorkItem);
  board.workItemDAG = board.workItemDAG ?? { nodes: [], edges: [] };
  board.workItemDAG.nodes.push({
    workItemId: parentWorkItem.id,
    kind: "implementation",
    requiredForDone: true
  });
  await saveBoard(boardDir, board);

  // Also update the work-item-dag.json file
  const dagPath = path.join(boardDir, "work-item-dag.json");
  const dag = await readJsonFile(dagPath);
  dag.nodes.push({
    id: parentWorkItem.id,
    kind: "implementation",
    requiredForDone: true,
    responsibilityUnitId: parentWorkItem.responsibilityUnitId
  });
  await writeJsonFile(dagPath, dag);

  // Write work item file
  await mkdir(path.join(boardDir, "work-items"), { recursive: true });
  await writeJsonFile(path.join(boardDir, "work-items", `${parentWorkItem.id}.json`), {
    schemaVersion: "1.0",
    prdId: "prd.auth",
    ...parentWorkItem
  });

  // Add responsibility unit
  const ruPath = path.join(boardDir, "responsibility-units.json");
  const ru = await readJsonFile(ruPath);
  ru.units.push({
    id: parentWorkItem.responsibilityUnitId,
    owner: "team.auth",
    owns: parentWorkItem.allowedPaths,
    publicSurfaces: [parentWorkItem.title],
    mayUseContracts: parentWorkItem.contractIds
  });
  await writeJsonFile(ruPath, ru);

  return parentWorkItem;
}

function validProposal() {
  return {
    reason: "Auth system needs separate hasher and API endpoint modules",
    children: [
      {
        id: "work.child-hasher",
        title: "Password hasher",
        allowedPaths: ["src/auth/hasher/**"],
        contractIds: [],
        dependsOn: [],
        responsibilityUnitId: "ru.child-hasher",
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [
          { kind: "verification", path: "ev/hasher-v.json" },
          { kind: "wiki-sync", path: "ev/hasher-w.json" }
        ]
      },
      {
        id: "work.child-api",
        title: "Auth API",
        allowedPaths: ["src/auth/api/**"],
        contractIds: [],
        dependsOn: ["work.child-hasher"],
        responsibilityUnitId: "ru.child-api",
        verificationCommands: [{ file: "npm", args: ["test"] }],
        doneEvidence: [
          { kind: "verification", path: "ev/api-v.json" },
          { kind: "wiki-sync", path: "ev/api-w.json" }
        ]
      }
    ]
  };
}

describe("materializeChildWorkItems", () => {
  test("creates child work items on the board", async () => {
    await withBoardFixture(async ({ boardDir }) => {
      await addParentWorkItem(boardDir, { lane: "Running" });
      const proposal = validProposal();
      const now = new Date("2026-05-19T12:00:00Z");

      const result = await materializeChildWorkItems({
        boardDir,
        parentWorkItemId: "work.decompose-parent",
        proposal,
        now
      });

      assert.ok(result.ok, result.errors.map(e => e.reason).join("; "));
      assert.deepEqual(result.childWorkItemIds, ["work.child-hasher", "work.child-api"]);

      // Verify board state
      const board = await loadBoard(boardDir);
      const parent = board.workItems.find(w => w.id === "work.decompose-parent");
      assert.equal(parent.lane, "Decomposing");
      assert.deepEqual(parent.childWorkItemIds, ["work.child-hasher", "work.child-api"]);

      const childHasher = board.workItems.find(w => w.id === "work.child-hasher");
      assert.equal(childHasher.lane, "Ready");
      assert.equal(childHasher.parentWorkItemId, "work.decompose-parent");
      assert.equal(childHasher.decompositionDepth, 1);

      const childApi = board.workItems.find(w => w.id === "work.child-api");
      assert.equal(childApi.lane, "Ready");
      assert.equal(childApi.parentWorkItemId, "work.decompose-parent");

      // Verify DAG was updated
      const dag = await readJsonFile(path.join(boardDir, "work-item-dag.json"));
      assert.ok(dag.nodes.some(n => n.id === "work.child-hasher"));
      assert.ok(dag.nodes.some(n => n.id === "work.child-api"));
      assert.ok(dag.edges.some(e => e.from === "work.child-hasher" && e.to === "work.child-api"));
    });
  });

  test("rejects invalid proposal through materialize", async () => {
    await withBoardFixture(async ({ boardDir }) => {
      await addParentWorkItem(boardDir, { lane: "Running" });
      const now = new Date("2026-05-19T12:00:00Z");

      const result = await materializeChildWorkItems({
        boardDir,
        parentWorkItemId: "work.decompose-parent",
        proposal: { reason: "short", children: [] },
        now
      });

      assert.ok(!result.ok);
      assert.equal(result.childWorkItemIds.length, 0);
    });
  });

  test("rejects when parent not found", async () => {
    await withBoardFixture(async ({ boardDir }) => {
      const now = new Date("2026-05-19T12:00:00Z");
      const result = await materializeChildWorkItems({
        boardDir,
        parentWorkItemId: "work.nonexistent",
        proposal: validProposal(),
        now
      });
      assert.ok(!result.ok);
      assert.ok(result.errors.some(e => e.code === "HARNESS_WORK_ITEM_UNKNOWN"));
    });
  });
});

describe("completeParentWhenChildrenDone", () => {
  test("signals childrenComplete without transitioning the parent", async () => {
    await withBoardFixture(async ({ boardDir }) => {
      await addParentWorkItem(boardDir, { lane: "Running" });
      const now = new Date("2026-05-19T12:00:00Z");

      // First materialize children
      await materializeChildWorkItems({
        boardDir,
        parentWorkItemId: "work.decompose-parent",
        proposal: validProposal(),
        now
      });

      // Mark both children as Done
      const board = await loadBoard(boardDir);
      for (const child of board.workItems) {
        if (child.parentWorkItemId === "work.decompose-parent") {
          child.lane = "Done";
        }
      }
      await saveBoard(boardDir, board);

      const result = await completeParentWhenChildrenDone({
        boardDir,
        parentWorkItemId: "work.decompose-parent",
        now
      });

      assert.ok(result.ok);
      // Doctrine: the engine only observes the condition and emits an event; it
      // does NOT autonomously move the parent. The LLM owns the transition.
      assert.equal(result.transitioned, false);
      assert.equal(result.childrenComplete, true);

      const updatedBoard = await loadBoard(boardDir);
      const parent = updatedBoard.workItems.find(w => w.id === "work.decompose-parent");
      assert.equal(parent.lane, "Decomposing");
    });
  });

  test("does not transition if some children not Done", async () => {
    await withBoardFixture(async ({ boardDir }) => {
      await addParentWorkItem(boardDir, { lane: "Running" });
      const now = new Date("2026-05-19T12:00:00Z");

      await materializeChildWorkItems({
        boardDir,
        parentWorkItemId: "work.decompose-parent",
        proposal: validProposal(),
        now
      });

      // Mark only one child as Done
      const board = await loadBoard(boardDir);
      const hasher = board.workItems.find(w => w.id === "work.child-hasher");
      hasher.lane = "Done";
      await saveBoard(boardDir, board);

      const result = await completeParentWhenChildrenDone({
        boardDir,
        parentWorkItemId: "work.decompose-parent",
        now
      });

      assert.ok(result.ok);
      assert.ok(!result.transitioned);

      const updatedBoard = await loadBoard(boardDir);
      const parent = updatedBoard.workItems.find(w => w.id === "work.decompose-parent");
      assert.equal(parent.lane, "Decomposing");
    });
  });

  test("returns ok with transitioned=false if parent not Decomposing", async () => {
    await withBoardFixture(async ({ boardDir }) => {
      const now = new Date("2026-05-19T12:00:00Z");
      const result = await completeParentWhenChildrenDone({
        boardDir,
        parentWorkItemId: "work.nonexistent",
        now
      });
      assert.ok(result.ok);
      assert.ok(!result.transitioned);
    });
  });
});

// ── Integration with orchestrator finishNativeClaudeTask ───────────

async function withProjectBoardFixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-decompose-orch-"));
  const projectRoot = path.join(root, "project");
  const source = new URL("../examples/kanban/.makeitreal/board", import.meta.url);
  const boardDir = path.join(projectRoot, ".makeitreal", "runs", "board");
  await cp(source, boardDir, { recursive: true });
  try {
    await callback({ root, projectRoot, boardDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function enableClaudeRunner(boardDir) {
  await writeJsonFile(path.join(boardDir, "trust-policy.json"), {
    schemaVersion: "1.0",
    runnerMode: "claude-code",
    realAgentLaunch: "enabled",
    approvalPolicy: "never",
    sandbox: "workspace-only",
    commandExecution: "structured-command-only",
    userInputRequired: "fail-fast",
    unsupportedToolCall: "fail-fast"
  });
}

describe("finishNativeClaudeTask NEEDS_DECOMPOSE", () => {
  test("NEEDS_DECOMPOSE without childWorkProposal returns error", async () => {
    await withProjectBoardFixture(async ({ boardDir }) => {
      await enableClaudeRunner(boardDir);
      const now = new Date("2026-05-19T12:00:00Z");
      const parent = await addParentWorkItem(boardDir);

      // Approve blueprint before starting native task
      await decideBlueprintReview({
        runDir: boardDir,
        status: "approved",
        reviewedBy: "operator:recursive-test",
        now
      });

      // Start native task to get it into Running + create attempt
      const started = await startNativeClaudeTask({ boardDir, workerId: "test-worker", concurrency: 1, now });
      assert.ok(started.ok, started.errors.map(e => e.reason).join("; "));
      assert.equal(started.nativeTasks.length, 1);
      const task = started.nativeTasks[0];

      const resultText = JSON.stringify({
        makeitrealReport: {
          role: "implementation-worker",
          status: "NEEDS_DECOMPOSE",
          summary: "Needs decomposition",
          changedFiles: [],
          tested: [],
          concerns: [],
          needsContext: [],
          blockers: [],
          workItemId: task.workItemId,
          attemptId: task.attemptId
        }
      });

      const result = await finishNativeClaudeTask({
        boardDir,
        workItemId: task.workItemId,
        attemptId: task.attemptId,
        workerId: "test-worker",
        resultText,
        now
      });

      assert.ok(!result.ok);
      assert.ok(result.errors.some(e => e.code === "HARNESS_DECOMPOSE_PROPOSAL_MISSING"));
    });
  });

  test("NEEDS_DECOMPOSE with valid proposal creates children and transitions parent", async () => {
    await withProjectBoardFixture(async ({ boardDir }) => {
      await enableClaudeRunner(boardDir);
      const now = new Date("2026-05-19T12:00:00Z");
      await addParentWorkItem(boardDir);

      // Approve blueprint before starting native task
      await decideBlueprintReview({
        runDir: boardDir,
        status: "approved",
        reviewedBy: "operator:recursive-test",
        now
      });

      const started = await startNativeClaudeTask({ boardDir, workerId: "test-worker", concurrency: 1, now });
      assert.ok(started.ok, started.errors.map(e => e.reason).join("; "));
      const task = started.nativeTasks[0];

      const proposal = validProposal();
      const resultText = JSON.stringify({
        makeitrealReport: {
          role: "implementation-worker",
          status: "NEEDS_DECOMPOSE",
          summary: "Needs decomposition into hasher and API",
          changedFiles: [],
          tested: [],
          concerns: [],
          needsContext: [],
          blockers: [],
          childWorkProposal: proposal,
          workItemId: task.workItemId,
          attemptId: task.attemptId
        }
      });

      const result = await finishNativeClaudeTask({
        boardDir,
        workItemId: task.workItemId,
        attemptId: task.attemptId,
        workerId: "test-worker",
        resultText,
        now
      });

      assert.ok(result.ok, result.errors.map(e => e.reason).join("; "));
      assert.equal(result.decomposed, true);
      assert.deepEqual(result.childWorkItemIds, ["work.child-hasher", "work.child-api"]);
      assert.deepEqual(result.events, ["work_decomposed"]);

      // Verify board state
      const board = await loadBoard(boardDir);
      const parent = board.workItems.find(w => w.id === task.workItemId);
      assert.equal(parent.lane, "Decomposing");

      const childHasher = board.workItems.find(w => w.id === "work.child-hasher");
      assert.equal(childHasher.lane, "Ready");
      assert.equal(childHasher.decompositionDepth, 1);
    });
  });

  test("NEEDS_DECOMPOSE with invalid proposal fails and moves to Failed Fast", async () => {
    await withProjectBoardFixture(async ({ boardDir }) => {
      await enableClaudeRunner(boardDir);
      const now = new Date("2026-05-19T12:00:00Z");
      await addParentWorkItem(boardDir);

      // Approve blueprint before starting native task
      await decideBlueprintReview({
        runDir: boardDir,
        status: "approved",
        reviewedBy: "operator:recursive-test",
        now
      });

      const started = await startNativeClaudeTask({ boardDir, workerId: "test-worker", concurrency: 1, now });
      assert.ok(started.ok);
      const task = started.nativeTasks[0];

      const invalidProposal = {
        reason: "short",
        children: [
          {
            id: "bad-child",
            allowedPaths: ["src/billing/**"], // outside parent's allowed paths
            contractIds: [],
            dependsOn: [],
            responsibilityUnitId: "ru.bad",
            verificationCommands: [{ file: "npm", args: ["test"] }],
            doneEvidence: [
              { kind: "verification", path: "a" },
              { kind: "wiki-sync", path: "b" }
            ]
          }
        ]
      };

      const resultText = JSON.stringify({
        makeitrealReport: {
          role: "implementation-worker",
          status: "NEEDS_DECOMPOSE",
          summary: "Trying invalid decompose",
          changedFiles: [],
          tested: [],
          concerns: [],
          needsContext: [],
          blockers: [],
          childWorkProposal: invalidProposal,
          workItemId: task.workItemId,
          attemptId: task.attemptId
        }
      });

      const result = await finishNativeClaudeTask({
        boardDir,
        workItemId: task.workItemId,
        attemptId: task.attemptId,
        workerId: "test-worker",
        resultText,
        now
      });

      assert.ok(!result.ok);
      assert.ok(result.errors.length > 0);
    });
  });
});
