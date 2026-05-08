import path from "node:path";
import { findPrimaryWorkItem, loadRunArtifacts } from "../domain/artifacts.mjs";
import { createHarnessError } from "../domain/errors.mjs";
import { fileExists, readJsonFile, writeJsonFile } from "../io/json.mjs";
import { computeBlueprintFingerprint } from "./fingerprint.mjs";

export const BLUEPRINT_APPROVAL_CODES = new Set([
  "HARNESS_BLUEPRINT_APPROVAL_MISSING",
  "HARNESS_BLUEPRINT_APPROVAL_PENDING",
  "HARNESS_BLUEPRINT_APPROVAL_REJECTED",
  "HARNESS_BLUEPRINT_APPROVAL_STALE",
  "HARNESS_BLUEPRINT_APPROVAL_DRIFT",
  "HARNESS_BLUEPRINT_REVIEW_INVALID",
  "HARNESS_BLUEPRINT_AUDIT_UNLINKED"
]);

const ALLOWED_STATUSES = new Set(["pending", "approved", "rejected"]);
const RUNNER_ENV_KEYS = ["MAKEITREAL_WORK_ITEM_ID", "MAKEITREAL_BOARD_DIR", "MAKEITREAL_WORKSPACE"];

function reviewPath(runDir) {
  return path.join(runDir, "blueprint-review.json");
}

function commandName(status) {
  return status === "approved" ? "blueprint approve" : "blueprint reject";
}

function error({ code, reason, evidence = ["blueprint-review.json"], recoverable = true }) {
  return createHarnessError({ code, reason, evidence, recoverable });
}

async function expectedBinding(runDir) {
  try {
    const artifacts = await loadRunArtifacts(runDir);
    const workItem = findPrimaryWorkItem(artifacts);
    return {
      ok: true,
      binding: {
        runId: artifacts.designPack.runId ?? path.basename(runDir),
        workItemId: workItem.id,
        prdId: artifacts.prd.id
      },
      errors: []
    };
  } catch (cause) {
    return {
      ok: false,
      binding: null,
      errors: [error({
        code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
        reason: cause instanceof Error ? cause.message : String(cause),
        evidence: ["prd.json", "design-pack.json", "work-items"]
      })]
    };
  }
}

export async function readBlueprintReview({ runDir }) {
  const filePath = reviewPath(runDir);
  if (!await fileExists(filePath)) {
    return {
      ok: false,
      review: null,
      reviewPath: filePath,
      errors: [error({
        code: "HARNESS_BLUEPRINT_APPROVAL_MISSING",
        reason: "Blueprint approval evidence is missing."
      })]
    };
  }

  try {
    return {
      ok: true,
      review: await readJsonFile(filePath),
      reviewPath: filePath,
      errors: []
    };
  } catch {
    return {
      ok: false,
      review: null,
      reviewPath: filePath,
      errors: [error({
        code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
        reason: "Blueprint approval evidence is malformed JSON."
      })]
    };
  }
}

export async function seedBlueprintReview({ runDir, now = new Date() }) {
  const binding = await expectedBinding(runDir);
  const fingerprint = await computeBlueprintFingerprint({ runDir });
  const errors = [...binding.errors, ...fingerprint.errors];
  if (errors.length > 0) {
    return { ok: false, command: "blueprint seed", reviewPath: reviewPath(runDir), errors };
  }

  const review = {
    schemaVersion: "1.0",
    runId: binding.binding.runId,
    workItemId: binding.binding.workItemId,
    prdId: binding.binding.prdId,
    blueprintFingerprint: fingerprint.fingerprint,
    status: "pending",
    reviewSource: "makeitreal:plan",
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null
  };
  const filePath = reviewPath(runDir);
  await writeJsonFile(filePath, review);
  return { ok: true, command: "blueprint seed", reviewPath: filePath, review, errors: [] };
}

function validateRunnerEnvironment(env = process.env) {
  const present = RUNNER_ENV_KEYS.filter((key) => env[key]);
  if (present.length === 0) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: [error({
      code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
      reason: `Blueprint approval cannot be decided from an implementation runner environment: ${present.join(", ")}`,
      evidence: present
    })]
  };
}

function validateReviewShape(review) {
  if (!review || typeof review !== "object" || Array.isArray(review) || !ALLOWED_STATUSES.has(review.status)) {
    return {
      ok: false,
      errors: [error({
        code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
        reason: "Blueprint review status must be pending, approved, or rejected."
      })]
    };
  }
  return { ok: true, errors: [] };
}

export async function decideBlueprintReview({
  runDir,
  status,
  reviewedBy,
  decisionNote = null,
  reviewSource = status === "approved" ? "makeitreal:plan approve" : "makeitreal:plan reject",
  env = process.env,
  now = new Date()
}) {
  if (!["approved", "rejected"].includes(status)) {
    return {
      ok: false,
      command: "blueprint decision",
      errors: [error({
        code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
        reason: "Blueprint decision status must be approved or rejected.",
        evidence: ["argv"]
      })]
    };
  }
  if (!reviewedBy) {
    return {
      ok: false,
      command: commandName(status),
      errors: [error({
        code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
        reason: "Blueprint approval decision requires --by <reviewer>.",
        evidence: ["--by"]
      })]
    };
  }
  const runnerEnv = validateRunnerEnvironment(env);
  if (!runnerEnv.ok) {
    return { ok: false, command: commandName(status), errors: runnerEnv.errors };
  }

  const currentReview = await readBlueprintReview({ runDir });
  if (!currentReview.ok) {
    return { ok: false, command: commandName(status), reviewPath: currentReview.reviewPath, errors: currentReview.errors };
  }
  const shape = validateReviewShape(currentReview.review);
  if (!shape.ok) {
    return { ok: false, command: commandName(status), reviewPath: currentReview.reviewPath, errors: shape.errors };
  }

  const binding = await expectedBinding(runDir);
  const fingerprint = await computeBlueprintFingerprint({ runDir });
  const errors = [...binding.errors, ...fingerprint.errors];
  if (errors.length > 0) {
    return { ok: false, command: commandName(status), reviewPath: currentReview.reviewPath, errors };
  }

  const review = {
    schemaVersion: "1.0",
    runId: binding.binding.runId,
    workItemId: binding.binding.workItemId,
    prdId: binding.binding.prdId,
    blueprintFingerprint: fingerprint.fingerprint,
    status,
    reviewSource,
    reviewedBy,
    reviewedAt: now.toISOString(),
    decisionNote
  };
  await writeJsonFile(currentReview.reviewPath, review);
  return {
    ok: true,
    command: commandName(status),
    runDir,
    reviewPath: currentReview.reviewPath,
    status,
    blueprintFingerprint: fingerprint.fingerprint,
    reviewedBy,
    review,
    errors: []
  };
}

export async function recordBlueprintRevisionRequest({
  runDir,
  requestedBy,
  decisionNote,
  reviewSource = "makeitreal:interactive-review:llm",
  env = process.env,
  now = new Date()
}) {
  if (!requestedBy) {
    return {
      ok: false,
      command: "blueprint revision request",
      errors: [error({
        code: "HARNESS_BLUEPRINT_REVIEW_INVALID",
        reason: "Blueprint revision request requires a reviewer identity.",
        evidence: ["reviewer"]
      })]
    };
  }
  const runnerEnv = validateRunnerEnvironment(env);
  if (!runnerEnv.ok) {
    return { ok: false, command: "blueprint revision request", errors: runnerEnv.errors };
  }

  const currentReview = await readBlueprintReview({ runDir });
  if (!currentReview.ok) {
    return {
      ok: false,
      command: "blueprint revision request",
      reviewPath: currentReview.reviewPath,
      errors: currentReview.errors
    };
  }
  const shape = validateReviewShape(currentReview.review);
  if (!shape.ok) {
    return {
      ok: false,
      command: "blueprint revision request",
      reviewPath: currentReview.reviewPath,
      errors: shape.errors
    };
  }

  const binding = await expectedBinding(runDir);
  const fingerprint = await computeBlueprintFingerprint({ runDir });
  const errors = [...binding.errors, ...fingerprint.errors];
  if (errors.length > 0) {
    return {
      ok: false,
      command: "blueprint revision request",
      reviewPath: currentReview.reviewPath,
      errors
    };
  }

  const review = {
    ...currentReview.review,
    schemaVersion: "1.0",
    runId: binding.binding.runId,
    workItemId: binding.binding.workItemId,
    prdId: binding.binding.prdId,
    blueprintFingerprint: fingerprint.fingerprint,
    status: "pending",
    reviewSource,
    reviewedBy: null,
    reviewedAt: null,
    decisionNote: null,
    revisionRequestedBy: requestedBy,
    revisionRequestedAt: now.toISOString(),
    revisionNote: decisionNote
  };
  await writeJsonFile(currentReview.reviewPath, review);
  return {
    ok: true,
    command: "blueprint revision request",
    runDir,
    reviewPath: currentReview.reviewPath,
    status: "pending",
    blueprintFingerprint: fingerprint.fingerprint,
    revisionRequestedBy: requestedBy,
    review,
    errors: []
  };
}

export async function validateBlueprintApproval({ runDir }) {
  const fingerprint = await computeBlueprintFingerprint({ runDir });
  if (!fingerprint.ok) {
    return { ok: false, status: "invalid", stale: false, reviewPath: reviewPath(runDir), errors: fingerprint.errors };
  }

  const reviewResult = await readBlueprintReview({ runDir });
  if (!reviewResult.ok) {
    return { ok: false, status: "missing", stale: false, reviewPath: reviewResult.reviewPath, errors: reviewResult.errors };
  }

  const review = reviewResult.review;
  const shape = validateReviewShape(review);
  if (!shape.ok) {
    return { ok: false, status: "invalid", stale: false, reviewPath: reviewResult.reviewPath, errors: shape.errors };
  }

  const binding = await expectedBinding(runDir);
  if (!binding.ok) {
    return { ok: false, status: "invalid", stale: false, reviewPath: reviewResult.reviewPath, errors: binding.errors };
  }

  if (
    review.runId !== binding.binding.runId ||
    review.workItemId !== binding.binding.workItemId ||
    review.prdId !== binding.binding.prdId
  ) {
    return {
      ok: false,
      status: review.status,
      stale: false,
      reviewPath: reviewResult.reviewPath,
      errors: [error({
        code: "HARNESS_BLUEPRINT_APPROVAL_DRIFT",
        reason: "Blueprint approval binding does not match the current run packet.",
        evidence: ["blueprint-review.json", "prd.json", "design-pack.json", "work-items"]
      })]
    };
  }

  if (review.status === "pending") {
    return {
      ok: false,
      status: "pending",
      stale: false,
      reviewPath: reviewResult.reviewPath,
      errors: [error({
        code: "HARNESS_BLUEPRINT_APPROVAL_PENDING",
        reason: "Blueprint review is pending user approval."
      })]
    };
  }

  if (review.status === "rejected") {
    return {
      ok: false,
      status: "rejected",
      stale: false,
      reviewPath: reviewResult.reviewPath,
      errors: [error({
        code: "HARNESS_BLUEPRINT_APPROVAL_REJECTED",
        reason: "Blueprint review was rejected by the operator."
      })]
    };
  }

  if (review.blueprintFingerprint !== fingerprint.fingerprint) {
    return {
      ok: false,
      status: "stale",
      stale: true,
      reviewPath: reviewResult.reviewPath,
      currentFingerprint: fingerprint.fingerprint,
      errors: [error({
        code: "HARNESS_BLUEPRINT_APPROVAL_STALE",
        reason: "Blueprint approval fingerprint is stale for the current run packet.",
        evidence: ["blueprint-review.json", ...fingerprint.files]
      })]
    };
  }

  return {
    ok: true,
    status: "approved",
    stale: false,
    reviewPath: reviewResult.reviewPath,
    review,
    currentFingerprint: fingerprint.fingerprint,
    errors: []
  };
}

export async function resolveBlueprintRunDir({ boardDir }) {
  const boardPath = path.join(boardDir, "board.json");
  let board = null;
  try {
    board = await readJsonFile(boardPath);
  } catch {
    return {
      ok: false,
      runDir: null,
      board: null,
      errors: [error({
        code: "HARNESS_BLUEPRINT_AUDIT_UNLINKED",
        reason: "Board cannot be read for Blueprint audit.",
        evidence: ["board.json"]
      })]
    };
  }

  const hasCoLocatedPacket = await fileExists(path.join(boardDir, "prd.json")) &&
    await fileExists(path.join(boardDir, "design-pack.json")) &&
    await fileExists(path.join(boardDir, "responsibility-units.json")) &&
    await fileExists(path.join(boardDir, "blueprint-review.json")) &&
    await fileExists(path.join(boardDir, "work-items"));

  if (hasCoLocatedPacket) {
    if (board.blueprintRunDir) {
      const linked = path.resolve(boardDir, board.blueprintRunDir);
      if (linked !== path.resolve(boardDir)) {
        return {
          ok: false,
          runDir: null,
          board,
          errors: [error({
            code: "HARNESS_BLUEPRINT_APPROVAL_DRIFT",
            reason: "Co-located board packet disagrees with board.json.blueprintRunDir.",
            evidence: ["board.json", "blueprint-review.json"]
          })]
        };
      }
    }
    return { ok: true, runDir: boardDir, board, errors: [] };
  }

  if (!board.blueprintRunDir) {
    return {
      ok: false,
      runDir: null,
      board,
      errors: [error({
        code: "HARNESS_BLUEPRINT_AUDIT_UNLINKED",
        reason: "Board is not linked to a Blueprint run packet.",
        evidence: ["board.json"]
      })]
    };
  }

  const resolved = path.resolve(boardDir, board.blueprintRunDir);
  const policyRoot = path.resolve(path.dirname(boardDir));
  const relative = path.relative(policyRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      runDir: null,
      board,
      errors: [error({
        code: "HARNESS_BLUEPRINT_AUDIT_UNLINKED",
        reason: "board.json.blueprintRunDir points outside the board policy root.",
        evidence: ["board.json"]
      })]
    };
  }

  if (!await fileExists(path.join(resolved, "blueprint-review.json"))) {
    return {
      ok: false,
      runDir: null,
      board,
      errors: [error({
        code: "HARNESS_BLUEPRINT_AUDIT_UNLINKED",
        reason: "board.json.blueprintRunDir does not contain Blueprint review evidence.",
        evidence: ["board.json", "blueprint-review.json"]
      })]
    };
  }

  return { ok: true, runDir: resolved, board, errors: [] };
}

export async function validateBoardBlueprintApproval({ boardDir }) {
  const resolved = await resolveBlueprintRunDir({ boardDir });
  if (!resolved.ok) {
    return resolved;
  }
  return validateBlueprintApproval({ runDir: resolved.runDir });
}

export function approvalErrorsOnly(errors = []) {
  return errors.length > 0 && errors.every((candidate) => BLUEPRINT_APPROVAL_CODES.has(candidate.code));
}
