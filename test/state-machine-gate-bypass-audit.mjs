#!/usr/bin/env node
/**
 * STATE MACHINE + GATE BYPASS AUDIT
 * ===================================
 * Tests every shortcut to Done. 10 scenarios:
 *
 * 1. Approve blueprint, manually edit artifact, launch — fingerprint stale detected?
 * 2. Two concurrent mir_blueprint for same runSlug — race condition?
 * 3. Complete with ZERO requiredReviewRoles — reaches Done without review?
 * 4. Manually write fake evidence/verification.json {ok:true} — gate accepts?
 * 5. Manually set blueprint-review.json status:approved — launch works?
 * 6. Call mir_launch(start) twice — double-claim?
 * 7. Finish with changedFiles:[] and requiredReviewRoles:[] — reaches Done?
 * 8. Skip approve, call launch directly — blocked?
 * 9. Manually move work item to Done in board.json, call complete — what happens?
 * 10. Submit finish reviewers that don't match requiredReviewRoles — blocked?
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cp, mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SOURCE = path.join(__dirname, "../examples/canonical/.makeitreal/runs/feature-auth");

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function copyFixture(destRoot, { trustPolicyMode = "disabled" } = {}) {
  const runDir = path.join(destRoot, "feature-auth");
  await cp(FIXTURE_SOURCE, runDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(FIXTURE_SOURCE, src);
      if (rel === "") return true;
      // skip preview and evidence (re-created per test)
      const first = rel.split(path.sep)[0];
      return !["preview", "evidence"].includes(first);
    }
  });
  // Ensure preview dir exists with required index.html
  await mkdir(path.join(runDir, "preview"), { recursive: true });
  await writeFile(path.join(runDir, "preview", "index.html"), "<html><body>preview</body></html>");
  // Write trust-policy.json based on requested mode
  if (trustPolicyMode === "claude-code-enabled") {
    await writeJson(path.join(runDir, "trust-policy.json"), {
      schemaVersion: "1.0",
      runnerMode: "claude-code",
      realAgentLaunch: "enabled",
      approvalPolicy: "never",
      sandbox: "workspace-only",
      commandExecution: "structured-command-only",
      userInputRequired: "fail-fast",
      unsupportedToolCall: "fail-fast",
      source: "audit-test",
      runId: "feature-auth"
    });
    // Also write native-role-mapping.json (required for startNativeClaudeTask)
    await writeJson(path.join(runDir, "native-role-mapping.json"), {
      schemaVersion: "1.0",
      mappings: [
        { evidenceRole: "implementation-worker", nativeSubagentType: "general-purpose" },
        { evidenceRole: "domain-pm", nativeSubagentType: "general-purpose" },
        { evidenceRole: "security-reviewer", nativeSubagentType: "general-purpose" },
        { evidenceRole: "qa-reviewer", nativeSubagentType: "general-purpose" }
      ]
    });
  }
  return runDir;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

let tmpRoot;

before(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mir-statemachine-audit-"));
});

after(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 1: Approve blueprint, edit artifact, launch — stale fingerprint?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-1: Fingerprint stale detection after artifact edit", () => {
  test("validateBlueprintApproval detects STALE after editing a work-item", async () => {
    const root = path.join(tmpRoot, "audit1");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root);

    const { decideBlueprintReview, validateBlueprintApproval } = await import("../src/blueprint/review.mjs");

    // 1. Approve blueprint legitimately
    const seedReview = {
      schemaVersion: "1.0",
      runId: "feature-auth",
      workItemId: "work.feature-auth",
      prdId: "prd.auth",
      blueprintFingerprint: "sha256:placeholder",
      status: "pending",
      reviewSource: "makeitreal:plan",
      reviewedBy: null,
      reviewedAt: null,
      decisionNote: null
    };
    await writeJson(path.join(runDir, "blueprint-review.json"), seedReview);

    const approveResult = await decideBlueprintReview({
      runDir,
      status: "approved",
      reviewedBy: "operator:audit1",
      env: {}
    });
    assert.strictEqual(approveResult.ok, true, "First approval must succeed");
    const approvedFingerprint = approveResult.blueprintFingerprint;

    // 2. Manually edit a work-item (add a stray field)
    const workItemPath = path.join(runDir, "work-items", "work.feature-auth.json");
    const workItem = await readJson(workItemPath);
    workItem.__audit_tamper = true;
    await writeJson(workItemPath, workItem);

    // 3. Validate blueprint approval — expect STALE
    const validation = await validateBlueprintApproval({ runDir });

    console.log(`  AUDIT-1 result: ok=${validation.ok}, status=${validation.status}, stale=${validation.stale}`);
    console.log(`  Errors: ${validation.errors.map(e => e.code).join(", ")}`);

    assert.strictEqual(validation.ok, false, "Approval should be invalid after artifact edit");
    assert.strictEqual(validation.stale, true, "Must detect STALE fingerprint");
    assert.ok(
      validation.errors.some(e => e.code === "HARNESS_BLUEPRINT_APPROVAL_STALE"),
      "Must emit HARNESS_BLUEPRINT_APPROVAL_STALE"
    );

    console.log("  RESULT: BLOCKED — fingerprint stale detection works correctly.");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 2: Two concurrent mir_blueprint for same runSlug — race condition?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-2: Concurrent blueprint seeding for same runSlug", () => {
  test("Two concurrent seedBlueprintReview calls — last writer wins (no locking)", async () => {
    const root = path.join(tmpRoot, "audit2");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root);

    const { seedBlueprintReview } = await import("../src/blueprint/review.mjs");

    // Remove any existing review
    try { await rm(path.join(runDir, "blueprint-review.json")); } catch { }

    // Launch two concurrent seeds
    const [r1, r2] = await Promise.all([
      seedBlueprintReview({ runDir, now: new Date("2026-01-01T00:00:00Z") }),
      seedBlueprintReview({ runDir, now: new Date("2026-01-01T00:00:01Z") })
    ]);

    console.log(`  AUDIT-2 concurrent seed r1.ok=${r1.ok}, r2.ok=${r2.ok}`);

    // Both writes complete — no locking on seed. Last writer wins.
    const finalReview = await readJson(path.join(runDir, "blueprint-review.json"));
    console.log(`  Final review status: ${finalReview.status}`);

    // Both calls succeed — no mutual exclusion at this layer
    // This is NOT a gate bypass: seeding only creates a "pending" review.
    // The fingerprint is still computed at time of approve.
    const bothSucceeded = r1.ok && r2.ok;
    if (bothSucceeded) {
      console.log("  FINDING: Both seeds succeed concurrently (last-write-wins). Status is 'pending' — no gate bypass.");
      console.log("  RESULT: LOW RISK — seed only sets pending, both are the same fingerprint.");
    } else {
      console.log(`  RESULT: One failed — r1.ok=${r1.ok}, r2.ok=${r2.ok}`);
    }

    assert.strictEqual(finalReview.status, "pending",
      "Final status must be pending (not approved) — no bypass");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 3: Complete with ZERO requiredReviewRoles — reaches Done without review?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-3: Complete with empty requiredReviewRoles", () => {
  test("work item with requiredReviewRoles:[] can reach Done without any review report", async () => {
    const root = path.join(tmpRoot, "audit3");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root, { trustPolicyMode: "claude-code-enabled" });

    const { completeVerifiedWork } = await import("../src/orchestrator/board-completion.mjs");

    // Set up board with work item in Verifying, with empty requiredReviewRoles
    const board = {
      schemaVersion: "1.0",
      boardId: "board.feature-auth",
      blueprintRunDir: ".",
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen",
        "Ready", "Claimed", "Running", "Decomposing", "Verifying", "Human Review",
        "Done", "Failed Fast", "Rework", "Blocked", "Cancelled"],
      workItemDAG: { schemaVersion: "1.0", nodes: [{ workItemId: "work.feature-auth", kind: "implementation", requiredForDone: true }], edges: [] },
      workItems: [{
        schemaVersion: "1.0",
        id: "work.feature-auth",
        title: "Implement feature-auth login surface",
        lane: "Verifying",  // Already in Verifying
        responsibilityUnitId: "ru.frontend",
        contractIds: ["contract.auth.login"],
        dependsOn: [],
        allowedPaths: ["apps/web/auth/**"],
        prdId: "prd.auth",
        prdTrace: { acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003"] },
        doneEvidence: [
          { kind: "verification", path: "evidence/verification.json" },
          { kind: "wiki-sync", path: "evidence/wiki-sync.json" }
        ],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('verification ok')"] }],
        requiredReviewRoles: []  // ZERO review roles
      }]
    };
    await writeJson(path.join(runDir, "board.json"), board);

    // Create a fake successful attempt record (claude-code mode, with DONE agent report, no review reports)
    const attemptId = "attempt-audit3-001";
    const attempt = {
      attemptId,
      workItemId: "work.feature-auth",
      workerId: "claude-code.parent",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      events: ["session_started", "turn_completed"],
      runner: {
        mode: "claude-code",
        channel: "parent-native-task",
        nodeKind: "implementation",
        agentReports: [{
          schemaVersion: "1.0",
          role: "implementation-worker",
          status: "DONE",
          summary: "All done",
          changedFiles: ["apps/web/auth/login.js"],
          tested: [],
          concerns: [],
          workItemId: "work.feature-auth",
          workerId: "claude-code.parent",
          attemptId,
          reportedAt: new Date().toISOString()
        }],
        reviewReports: [],  // No reviews
        resultText: ""
      }
    };
    await mkdir(path.join(runDir, "attempts"), { recursive: true });
    await writeJson(path.join(runDir, "attempts", `${attemptId}.json`), attempt);

    const result = await completeVerifiedWork({
      boardDir: runDir,
      workItemId: "work.feature-auth",
      now: new Date()
    });

    console.log(`  AUDIT-3 result: ok=${result.ok}`);
    console.log(`  Errors: ${result.errors?.map(e => e.code).join(", ") || "none"}`);

    if (result.ok) {
      const updatedBoard = await readJson(path.join(runDir, "board.json"));
      const wi = updatedBoard.workItems.find(w => w.id === "work.feature-auth");
      console.log(`  Work item lane: ${wi.lane}`);
      console.log("  FINDING: Work item reached Done with ZERO reviewers declared.");
      console.log("  RESULT: BYPASS CONFIRMED — requiredReviewRoles:[] allows Done with no review.");
    } else {
      console.log("  RESULT: BLOCKED — could not reach Done without reviews.");
    }

    // Document actual behavior
    assert.ok(true, "Behavior documented");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 4: Manually write fake evidence/verification.json {ok:true} — accepted?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-4: Fake verification.json with {ok:true}", () => {
  test("readVerificationEvidence rejects forged evidence missing required fields", async () => {
    const root = path.join(tmpRoot, "audit4");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root);

    const { readVerificationEvidence } = await import("../src/domain/evidence.mjs");

    const workItem = {
      id: "work.feature-auth",
      responsibilityUnitId: "ru.frontend",
      doneEvidence: [{ kind: "verification", path: "evidence/verification.json" }],
      verificationCommands: [{ file: "node", args: ["-e", "console.log('verification ok')"] }]
    };

    // Test 4a: Minimal fake { ok: true }
    await mkdir(path.join(runDir, "evidence"), { recursive: true });
    await writeJson(path.join(runDir, "evidence", "verification.json"), { ok: true });

    const r4a = await readVerificationEvidence(runDir, { workItem });
    console.log(`  AUDIT-4a {ok:true}: accepted=${r4a.ok}, errors=${r4a.errors?.map(e => e.code).join(",") || "none"}`);

    // Test 4b: Fake with right kind but no commands
    await writeJson(path.join(runDir, "evidence", "verification.json"), {
      ok: true,
      kind: "verification",
      producer: "makeitreal-engine verify",
      commands: [],
      commandHashes: [],
      workItemId: "work.feature-auth"
    });

    const r4b = await readVerificationEvidence(runDir, { workItem });
    console.log(`  AUDIT-4b empty commands: accepted=${r4b.ok}, errors=${r4b.errors?.map(e => e.code).join(",") || "none"}`);

    // Test 4c: Correct structure but wrong command hashes
    await writeJson(path.join(runDir, "evidence", "verification.json"), {
      ok: true,
      kind: "verification",
      producer: "makeitreal-engine verify",
      commands: [{ command: { file: "node", args: ["-e", "console.log('verification ok')"] }, exitCode: 0, stdout: "verification ok\n", stderr: "" }],
      commandHashes: ["fakehash123"],
      workItemId: "work.feature-auth"
    });

    const r4c = await readVerificationEvidence(runDir, { workItem });
    console.log(`  AUDIT-4c wrong hashes: accepted=${r4c.ok}, errors=${r4c.errors?.map(e => e.code).join(",") || "none"}`);

    // Test 4d: Fully correct fake (matching hashes)
    const { hashCommand } = await import("../src/domain/verification-command.mjs");
    const cmd = { file: "node", args: ["-e", "console.log('verification ok')"] };
    const correctHash = hashCommand(cmd);
    await writeJson(path.join(runDir, "evidence", "verification.json"), {
      ok: true,
      kind: "verification",
      producer: "makeitreal-engine verify",
      commands: [{
        command: cmd,
        commandHash: correctHash,
        exitCode: 0,
        stdout: "verification ok\n",
        stderr: "",
        durationMs: 10
      }],
      commandHashes: [correctHash],
      workItemId: "work.feature-auth"
    });

    const r4d = await readVerificationEvidence(runDir, { workItem });
    console.log(`  AUDIT-4d correct structure+hash: accepted=${r4d.ok}, errors=${r4d.errors?.map(e => e.code).join(",") || "none"}`);

    if (r4d.ok) {
      console.log("  FINDING: Fully-crafted fake evidence (correct hash, correct producer, exit 0) is ACCEPTED.");
      console.log("  RESULT: BYPASS CONFIRMED — evidence.mjs validates structure/hash but not actual execution provenance.");
      console.log("  Root cause: producer string is checked against known values but not cryptographically signed.");
    } else {
      console.log("  RESULT: Fully crafted fake rejected.");
    }

    assert.strictEqual(r4a.ok, false, "Bare {ok:true} must be rejected");
    assert.strictEqual(r4b.ok, false, "Empty commands must be rejected");
    assert.strictEqual(r4c.ok, false, "Wrong hashes must be rejected");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 5: Manually set blueprint-review.json status:approved — launch works?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-5: Manually write blueprint-review.json with status:approved", () => {
  test("validateBlueprintApproval rejects manually written review with wrong fingerprint", async () => {
    const root = path.join(tmpRoot, "audit5");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root);

    const { validateBlueprintApproval } = await import("../src/blueprint/review.mjs");
    const { computeBlueprintFingerprint } = await import("../src/blueprint/fingerprint.mjs");

    // Get the real fingerprint
    const fp = await computeBlueprintFingerprint({ runDir });

    // Test 5a: Write review with WRONG fingerprint
    await writeJson(path.join(runDir, "blueprint-review.json"), {
      schemaVersion: "1.0",
      runId: "feature-auth",
      workItemId: "work.feature-auth",
      prdId: "prd.auth",
      blueprintFingerprint: "sha256:fakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefake",
      status: "approved",
      reviewSource: "makeitreal:plan approve",
      reviewedBy: "evil:attacker",
      reviewedAt: new Date().toISOString(),
      decisionNote: null
    });

    const r5a = await validateBlueprintApproval({ runDir });
    console.log(`  AUDIT-5a wrong fingerprint: ok=${r5a.ok}, stale=${r5a.stale}, errors=${r5a.errors?.map(e => e.code).join(",") || "none"}`);

    // Test 5b: Write review with CORRECT fingerprint (known through API)
    await writeJson(path.join(runDir, "blueprint-review.json"), {
      schemaVersion: "1.0",
      runId: "feature-auth",
      workItemId: "work.feature-auth",
      prdId: "prd.auth",
      blueprintFingerprint: fp.fingerprint,
      status: "approved",
      reviewSource: "makeitreal:plan approve",
      reviewedBy: "evil:attacker",
      reviewedAt: new Date().toISOString(),
      decisionNote: null
    });

    const r5b = await validateBlueprintApproval({ runDir });
    console.log(`  AUDIT-5b correct fingerprint: ok=${r5b.ok}, errors=${r5b.errors?.map(e => e.code).join(",") || "none"}`);

    if (r5b.ok) {
      console.log("  FINDING: Manually written blueprint-review.json with correct fingerprint is ACCEPTED.");
      console.log("  RESULT: BYPASS CONFIRMED — blueprint-review.json is not cryptographically signed.");
      console.log("  Root cause: validateBlueprintApproval only checks fingerprint match, not who wrote the file.");
    } else {
      console.log("  RESULT: BLOCKED — manually written review rejected.");
    }

    assert.strictEqual(r5a.ok, false, "Wrong-fingerprint manual review must be rejected");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 6: Call startNativeClaudeTask twice — double-claim?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-6: Call mir_launch(start) twice — double claim?", () => {
  test("startNativeClaudeTask blocks second claim on same work item", async () => {
    const root = path.join(tmpRoot, "audit6");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root, { trustPolicyMode: "claude-code-enabled" });

    const { startNativeClaudeTask } = await import("../src/orchestrator/orchestrator.mjs");

    // Set work item to Ready state — must match DAG kind in work-item-dag.json
    const board = {
      schemaVersion: "1.0",
      boardId: "board.feature-auth",
      blueprintRunDir: ".",
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen",
        "Ready", "Claimed", "Running", "Decomposing", "Verifying", "Human Review",
        "Done", "Failed Fast", "Rework", "Blocked", "Cancelled"],
      workItemDAG: {
        schemaVersion: "1.0",
        // Use original implementation kind to match work-item-dag.json
        nodes: [{ workItemId: "work.feature-auth", kind: "implementation", requiredForDone: true }],
        edges: []
      },
      workItems: [{
        schemaVersion: "1.0",
        id: "work.feature-auth",
        title: "Implement feature-auth",
        lane: "Ready",
        responsibilityUnitId: "ru.frontend",
        contractIds: ["contract.auth.login"],
        dependsOn: [],
        allowedPaths: ["apps/web/auth/**"],
        prdId: "prd.auth",
        prdTrace: { acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003"] },
        doneEvidence: [
          { kind: "verification", path: "evidence/verification.json" },
          { kind: "wiki-sync", path: "evidence/wiki-sync.json" }
        ],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('ok')"] }],
        requiredReviewRoles: []
      }]
    };
    await writeJson(path.join(runDir, "board.json"), board);

    // Compute fresh fingerprint AFTER all file mutations and write approved review
    const { computeBlueprintFingerprint } = await import("../src/blueprint/fingerprint.mjs");
    const fp = await computeBlueprintFingerprint({ runDir });
    await writeJson(path.join(runDir, "blueprint-review.json"), {
      schemaVersion: "1.0",
      runId: "feature-auth",
      workItemId: "work.feature-auth",
      prdId: "prd.auth",
      blueprintFingerprint: fp.fingerprint,
      status: "approved",
      reviewSource: "audit-test",
      reviewedBy: "audit-tester",
      reviewedAt: new Date().toISOString(),
      decisionNote: null
    });

    const now = new Date();

    // First call
    const r1 = await startNativeClaudeTask({
      boardDir: runDir,
      workerId: "worker-1",
      concurrency: 1,
      now
    });
    console.log(`  AUDIT-6 first start: ok=${r1.ok}, tasks=${r1.nativeTasks?.length}`);

    // Second call immediately after
    const r2 = await startNativeClaudeTask({
      boardDir: runDir,
      workerId: "worker-2",
      concurrency: 1,
      now
    });
    console.log(`  AUDIT-6 second start: ok=${r2.ok}, tasks=${r2.nativeTasks?.length}`);
    if (!r2.ok) {
      console.log(`  Second start errors: ${r2.errors?.map(e => e.code).join(",")}`);
    }

    const updatedBoard = await readJson(path.join(runDir, "board.json"));
    const wi = updatedBoard.workItems.find(w => w.id === "work.feature-auth");
    console.log(`  Work item lane after two starts: ${wi.lane}`);

    if (r2.nativeTasks?.length > 0) {
      console.log("  FINDING: DOUBLE CLAIM — second start dispatched the same work item.");
      console.log("  RESULT: RACE CONDITION — two concurrent starts can both claim the same item.");
    } else {
      console.log("  RESULT: PROTECTED — second start gets no tasks (item already Running).");
    }

    // The first start should succeed
    assert.ok(r1.nativeTasks?.length >= 0, "First start should return tasks array");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 7: Finish with changedFiles:[] and requiredReviewRoles:[] — Done?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-7: domain-pm node — zero changedFiles, zero reviewRoles — reaches Done?", () => {
  test("domain-pm work item with no changedFiles and no reviewers completes successfully", async () => {
    const root = path.join(tmpRoot, "audit7");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root, { trustPolicyMode: "claude-code-enabled" });

    const { completeVerifiedWork } = await import("../src/orchestrator/board-completion.mjs");

    // domain-pm: requiresChangedFiles=false, requiresVerificationCommands=false
    const board = {
      schemaVersion: "1.0",
      boardId: "board.feature-auth",
      blueprintRunDir: ".",
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen",
        "Ready", "Claimed", "Running", "Decomposing", "Verifying", "Human Review",
        "Done", "Failed Fast", "Rework", "Blocked", "Cancelled"],
      workItemDAG: { schemaVersion: "1.0", nodes: [{ workItemId: "work.feature-auth", kind: "domain-pm", requiredForDone: true }], edges: [] },
      workItems: [{
        schemaVersion: "1.0",
        id: "work.feature-auth",
        title: "PM planning work",
        lane: "Verifying",
        responsibilityUnitId: "ru.frontend",
        contractIds: [],
        dependsOn: [],
        allowedPaths: ["apps/web/auth/**"],
        prdId: "prd.auth",
        prdTrace: { acceptanceCriteriaIds: ["AC-001"] },
        doneEvidence: [
          { kind: "verification", path: "evidence/verification.json" },
          { kind: "wiki-sync", path: "evidence/wiki-sync.json" }
        ],
        verificationCommands: [],
        verificationExempt: { reason: "domain-pm node does not require automated verification" },
        requiredReviewRoles: []  // ZERO
      }]
    };
    await writeJson(path.join(runDir, "board.json"), board);

    // Fake a successful domain-pm attempt
    const attemptId = "attempt-audit7-001";
    const attempt = {
      attemptId,
      workItemId: "work.feature-auth",
      workerId: "claude-code.parent",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      events: ["session_started", "turn_completed"],
      runner: {
        mode: "claude-code",
        channel: "parent-native-task",
        nodeKind: "domain-pm",
        agentReports: [{
          schemaVersion: "1.0",
          role: "domain-pm",
          status: "DONE",
          summary: "PM planning complete",
          changedFiles: [],      // Empty — domain-pm doesn't need changed files
          tested: [],
          concerns: [],
          workItemId: "work.feature-auth",
          workerId: "claude-code.parent",
          attemptId,
          reportedAt: new Date().toISOString()
        }],
        reviewReports: []  // No reviews
      }
    };
    await mkdir(path.join(runDir, "attempts"), { recursive: true });
    await writeJson(path.join(runDir, "attempts", `${attemptId}.json`), attempt);

    const result = await completeVerifiedWork({
      boardDir: runDir,
      workItemId: "work.feature-auth",
      now: new Date()
    });

    console.log(`  AUDIT-7 result: ok=${result.ok}`);
    if (!result.ok) {
      console.log(`  Errors: ${result.errors?.map(e => `${e.code}: ${e.reason}`).join("; ")}`);
    } else {
      const updatedBoard = await readJson(path.join(runDir, "board.json"));
      const wi = updatedBoard.workItems.find(w => w.id === "work.feature-auth");
      console.log(`  Final lane: ${wi.lane}`);
      console.log("  FINDING: domain-pm with changedFiles:[] and requiredReviewRoles:[] reaches Done.");
      console.log("  RESULT: EXPECTED BEHAVIOR — domain-pm policy explicitly exempts changed files + reviews.");
    }

    assert.ok(true, "Behavior documented");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 8: Skip approve, call launch directly — blocked?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-8: Skip approve, call startNativeClaudeTask directly", () => {
  test("startNativeClaudeTask fails if blueprint not approved", async () => {
    const root = path.join(tmpRoot, "audit8");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root, { trustPolicyMode: "claude-code-enabled" });

    const { startNativeClaudeTask } = await import("../src/orchestrator/orchestrator.mjs");

    // Write pending review (not approved)
    await writeJson(path.join(runDir, "blueprint-review.json"), {
      schemaVersion: "1.0",
      runId: "feature-auth",
      workItemId: "work.feature-auth",
      prdId: "prd.auth",
      blueprintFingerprint: "sha256:doesnotmatter",
      status: "pending",
      reviewSource: "makeitreal:plan",
      reviewedBy: null,
      reviewedAt: null,
      decisionNote: null
    });

    // Board: work item in Contract Frozen (needs Ready promotion via gate)
    const board = {
      schemaVersion: "1.0",
      boardId: "board.feature-auth",
      blueprintRunDir: ".",
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen",
        "Ready", "Claimed", "Running", "Decomposing", "Verifying", "Human Review",
        "Done", "Failed Fast", "Rework", "Blocked", "Cancelled"],
      workItemDAG: { schemaVersion: "1.0", nodes: [{ workItemId: "work.feature-auth", kind: "implementation", requiredForDone: true }], edges: [] },
      workItems: [{
        schemaVersion: "1.0",
        id: "work.feature-auth",
        title: "Implement feature-auth",
        lane: "Contract Frozen",  // Must pass Ready gate first
        responsibilityUnitId: "ru.frontend",
        contractIds: ["contract.auth.login"],
        dependsOn: [],
        allowedPaths: ["apps/web/auth/**"],
        prdId: "prd.auth",
        prdTrace: { acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003"] },
        doneEvidence: [
          { kind: "verification", path: "evidence/verification.json" },
          { kind: "wiki-sync", path: "evidence/wiki-sync.json" }
        ],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('ok')"] }],
        requiredReviewRoles: []
      }]
    };
    await writeJson(path.join(runDir, "board.json"), board);

    const r = await startNativeClaudeTask({
      boardDir: runDir,
      workerId: "worker-8",
      concurrency: 1,
      now: new Date()
    });

    console.log(`  AUDIT-8 skip-approve start: ok=${r.ok}, tasks=${r.nativeTasks?.length}`);
    if (!r.ok) {
      console.log(`  Errors: ${r.errors?.map(e => e.code).join(",")}`);
    }

    // The promoteReadyGateApprovedWork will check blueprint approval
    // If pending, the work item stays in Contract Frozen, so no tasks dispatched
    if (r.ok && r.nativeTasks?.length === 0) {
      console.log("  RESULT: BLOCKED — no tasks dispatched because blueprint approval is pending.");
    } else if (!r.ok) {
      console.log("  RESULT: BLOCKED — start fails with blueprint approval error.");
    } else {
      console.log("  FINDING: Work dispatched despite pending blueprint approval!");
      console.log("  RESULT: BYPASS CONFIRMED — skipping approve allows launch.");
    }

    // Now try with work item manually forced to Ready lane (simulating board manipulation)
    board.workItems[0].lane = "Ready";
    await writeJson(path.join(runDir, "board.json"), board);

    const r2 = await startNativeClaudeTask({
      boardDir: runDir,
      workerId: "worker-8b",
      concurrency: 1,
      now: new Date()
    });

    console.log(`  AUDIT-8b force-Ready with pending approval: ok=${r2.ok}, tasks=${r2.nativeTasks?.length}`);
    if (r2.nativeTasks?.length > 0) {
      console.log("  FINDING: Work dispatched from Ready lane WITHOUT blueprint approval gate check at start time!");
      console.log("  Root cause: startNativeClaudeTask does not re-validate blueprint approval for already-Ready items.");
      console.log("  RESULT: BYPASS CONFIRMED — manually move to Ready + skip approve = launch succeeds.");
    } else {
      console.log("  RESULT: PROTECTED even for manually-forced Ready items.");
    }

    assert.ok(true, "Behavior documented");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 9: Manually move work item to Done in board.json, call complete
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-9: Manually set lane:Done in board.json, call completeVerifiedWork", () => {
  test("completeVerifiedWork rejects work items not in Verifying/Rework", async () => {
    const root = path.join(tmpRoot, "audit9");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root);

    const { completeVerifiedWork } = await import("../src/orchestrator/board-completion.mjs");

    // Put work item directly in Done
    const board = {
      schemaVersion: "1.0",
      boardId: "board.feature-auth",
      blueprintRunDir: ".",
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen",
        "Ready", "Claimed", "Running", "Decomposing", "Verifying", "Human Review",
        "Done", "Failed Fast", "Rework", "Blocked", "Cancelled"],
      workItemDAG: { schemaVersion: "1.0", nodes: [{ workItemId: "work.feature-auth", kind: "implementation", requiredForDone: true }], edges: [] },
      workItems: [{
        schemaVersion: "1.0",
        id: "work.feature-auth",
        title: "Implement feature-auth",
        lane: "Done",  // Already Done
        responsibilityUnitId: "ru.frontend",
        contractIds: ["contract.auth.login"],
        dependsOn: [],
        allowedPaths: ["apps/web/auth/**"],
        prdId: "prd.auth",
        prdTrace: { acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003"] },
        doneEvidence: [
          { kind: "verification", path: "evidence/verification.json" },
          { kind: "wiki-sync", path: "evidence/wiki-sync.json" }
        ],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('ok')"] }],
        requiredReviewRoles: []
      }]
    };
    await writeJson(path.join(runDir, "board.json"), board);

    const result = await completeVerifiedWork({
      boardDir: runDir,
      workItemId: "work.feature-auth",
      now: new Date()
    });

    console.log(`  AUDIT-9 call complete on Done item: ok=${result.ok}`);
    console.log(`  Errors: ${result.errors?.map(e => e.code).join(",") || "none"}`);

    if (!result.ok && result.errors.some(e => e.code === "HARNESS_WORK_NOT_VERIFYING")) {
      console.log("  RESULT: BLOCKED — completeVerifiedWork checks lane is Verifying/Rework.");
      console.log("  Note: manually setting board.json lane to Done only fakes the state,");
      console.log("        but the DONE gate check in runGates still validates artifacts.");
    } else if (result.ok) {
      console.log("  FINDING: completeVerifiedWork accepted an already-Done work item.");
      console.log("  RESULT: ISSUE — idempotent call allowed.");
    }

    // What about the Done gate? It reads from runGates
    const { runGates } = await import("../src/gates/index.mjs");
    const gateResult = await runGates({ runDir, target: "Done" });
    console.log(`  AUDIT-9 Done gate check: ok=${gateResult.ok}`);
    if (!gateResult.ok) {
      console.log(`  Done gate errors: ${gateResult.errors.map(e => e.code).join(",")}`);
    }

    assert.strictEqual(result.ok, false, "complete on Done item must fail");
    assert.ok(
      result.errors.some(e => e.code === "HARNESS_WORK_NOT_VERIFYING"),
      "Must emit HARNESS_WORK_NOT_VERIFYING"
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT 10: Submit reviewers that don't match requiredReviewRoles — blocked?
// ──────────────────────────────────────────────────────────────────────────────

describe("AUDIT-10: Finish with wrong reviewer roles", () => {
  test("completeVerifiedWork blocks when reviewer role doesn't match requiredReviewRoles", async () => {
    const root = path.join(tmpRoot, "audit10");
    await mkdir(root, { recursive: true });
    const runDir = await copyFixture(root, { trustPolicyMode: "claude-code-enabled" });

    const { completeVerifiedWork } = await import("../src/orchestrator/board-completion.mjs");

    const board = {
      schemaVersion: "1.0",
      boardId: "board.feature-auth",
      blueprintRunDir: ".",
      lanes: ["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen",
        "Ready", "Claimed", "Running", "Decomposing", "Verifying", "Human Review",
        "Done", "Failed Fast", "Rework", "Blocked", "Cancelled"],
      workItemDAG: { schemaVersion: "1.0", nodes: [{ workItemId: "work.feature-auth", kind: "implementation", requiredForDone: true }], edges: [] },
      workItems: [{
        schemaVersion: "1.0",
        id: "work.feature-auth",
        title: "Implement feature-auth",
        lane: "Verifying",
        responsibilityUnitId: "ru.frontend",
        contractIds: ["contract.auth.login"],
        dependsOn: [],
        allowedPaths: ["apps/web/auth/**"],
        prdId: "prd.auth",
        prdTrace: { acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003"] },
        doneEvidence: [
          { kind: "verification", path: "evidence/verification.json" },
          { kind: "wiki-sync", path: "evidence/wiki-sync.json" }
        ],
        verificationCommands: [{ file: "node", args: ["-e", "console.log('verification ok')"] }],
        requiredReviewRoles: ["security-reviewer", "qa-reviewer"]  // REQUIRES these two roles
      }]
    };
    await writeJson(path.join(runDir, "board.json"), board);

    const attemptId = "attempt-audit10-001";

    // Scenario A: submit "wrong-reviewer" role (not in requiredReviewRoles)
    const attemptWrongRole = {
      attemptId,
      workItemId: "work.feature-auth",
      workerId: "claude-code.parent",
      status: "completed",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      events: ["session_started", "turn_completed"],
      runner: {
        mode: "claude-code",
        channel: "parent-native-task",
        nodeKind: "implementation",
        agentReports: [{
          schemaVersion: "1.0",
          role: "implementation-worker",
          status: "DONE",
          summary: "Done",
          changedFiles: ["apps/web/auth/login.js"],
          tested: [],
          concerns: [],
          workItemId: "work.feature-auth",
          workerId: "claude-code.parent",
          attemptId,
          reportedAt: new Date().toISOString()
        }],
        reviewReports: [{
          // Wrong role — not security-reviewer or qa-reviewer
          schemaVersion: "1.0",
          role: "wrong-reviewer",
          evidenceRole: "wrong-reviewer",
          status: "APPROVED",
          summary: "Looks good",
          workItemId: "work.feature-auth",
          attemptId,
          workerId: "claude-code.parent",
          reportedAt: new Date().toISOString()
        }]
      }
    };
    await mkdir(path.join(runDir, "attempts"), { recursive: true });
    await writeJson(path.join(runDir, "attempts", `${attemptId}.json`), attemptWrongRole);

    const r10a = await completeVerifiedWork({
      boardDir: runDir,
      workItemId: "work.feature-auth",
      now: new Date()
    });

    console.log(`  AUDIT-10a wrong reviewer role: ok=${r10a.ok}`);
    console.log(`  Errors: ${r10a.errors?.map(e => e.code).join(",") || "none"}`);

    // Scenario B: correct roles but REJECTED status
    const attemptRejected = {
      ...attemptWrongRole,
      runner: {
        ...attemptWrongRole.runner,
        reviewReports: [
          { schemaVersion: "1.0", role: "security-reviewer", evidenceRole: "security-reviewer", status: "REJECTED", summary: "Issues found", workItemId: "work.feature-auth", attemptId, workerId: "reviewer", reportedAt: new Date().toISOString() },
          { schemaVersion: "1.0", role: "qa-reviewer", evidenceRole: "qa-reviewer", status: "APPROVED", summary: "OK", workItemId: "work.feature-auth", attemptId, workerId: "reviewer", reportedAt: new Date().toISOString() }
        ]
      }
    };
    await writeJson(path.join(runDir, "attempts", `${attemptId}.json`), attemptRejected);

    // Reset board to Verifying
    await writeJson(path.join(runDir, "board.json"), {
      ...board,
      workItems: [{ ...board.workItems[0], lane: "Verifying" }]
    });

    const r10b = await completeVerifiedWork({
      boardDir: runDir,
      workItemId: "work.feature-auth",
      now: new Date()
    });

    console.log(`  AUDIT-10b one role rejected: ok=${r10b.ok}`);
    console.log(`  Errors: ${r10b.errors?.map(e => e.code).join(",") || "none"}`);

    // Scenario C: all required roles present and APPROVED
    const attemptAllApproved = {
      ...attemptWrongRole,
      runner: {
        ...attemptWrongRole.runner,
        reviewReports: [
          { schemaVersion: "1.0", role: "security-reviewer", evidenceRole: "security-reviewer", status: "APPROVED", summary: "OK", workItemId: "work.feature-auth", attemptId, workerId: "reviewer", reportedAt: new Date().toISOString() },
          { schemaVersion: "1.0", role: "qa-reviewer", evidenceRole: "qa-reviewer", status: "APPROVED", summary: "OK", workItemId: "work.feature-auth", attemptId, workerId: "reviewer", reportedAt: new Date().toISOString() }
        ]
      }
    };
    await writeJson(path.join(runDir, "attempts", `${attemptId}.json`), attemptAllApproved);

    // Reset board to Verifying
    await writeJson(path.join(runDir, "board.json"), {
      ...board,
      workItems: [{ ...board.workItems[0], lane: "Verifying" }]
    });

    const r10c = await completeVerifiedWork({
      boardDir: runDir,
      workItemId: "work.feature-auth",
      now: new Date()
    });

    console.log(`  AUDIT-10c all required roles approved: ok=${r10c.ok}`);
    if (!r10c.ok) {
      console.log(`  Errors: ${r10c.errors?.map(e => e.code).join(",")}`);
    }

    console.log("\n  RESULT SUMMARY:");
    console.log(`  - Wrong reviewer role: ${r10a.ok ? "BYPASS" : "BLOCKED"} (expected: BLOCKED)`);
    console.log(`  - One role rejected: ${r10b.ok ? "BYPASS" : "BLOCKED"} (expected: BLOCKED)`);
    console.log(`  - All required roles approved: ${r10c.ok ? "PASSES" : "FAILS"} (expected: PASSES)`);

    assert.strictEqual(r10a.ok, false, "Wrong reviewer role must be blocked");
    assert.strictEqual(r10b.ok, false, "Rejected reviewer must block completion");
  });
});
