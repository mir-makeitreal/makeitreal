import { createHarnessError } from "../domain/errors.mjs";

export const REVIEW_ROLES = Object.freeze([
  "spec-reviewer",
  "quality-reviewer",
  "verification-reviewer"
]);

export const REVIEW_STATUSES = Object.freeze([
  "APPROVED",
  "APPROVED_WITH_NOTES",
  "REJECTED",
  "NEEDS_CONTEXT",
  "BLOCKED"
]);

const REQUIRED_REVIEW_ROLES = new Set(REVIEW_ROLES);
const APPROVED_REVIEW_STATUSES = new Set(["APPROVED", "APPROVED_WITH_NOTES"]);
const VALID_REVIEW_STATUSES = new Set(REVIEW_STATUSES);

function reportArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

function candidateReview(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  return record.makeitrealReview
    ?? record.reviewReport
    ?? record.payload?.makeitrealReview
    ?? record.payload?.reviewReport
    ?? null;
}

export function extractReviewReport({ record, workItem, workerId, attemptId, now }) {
  const candidate = candidateReview(record);
  if (!candidate) {
    return { ok: true, report: null, errors: [] };
  }

  const role = String(candidate.role ?? "");
  const status = String(candidate.status ?? "");
  if (!REQUIRED_REVIEW_ROLES.has(role)) {
    return {
      ok: false,
      report: null,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_ROLE_INVALID",
        reason: `Review report role must be one of ${REVIEW_ROLES.join(", ")}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["runner.stdout"],
        recoverable: true
      })]
    };
  }
  if (!VALID_REVIEW_STATUSES.has(status)) {
    return {
      ok: false,
      report: null,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_STATUS_INVALID",
        reason: `Review report status must be one of ${REVIEW_STATUSES.join(", ")}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["runner.stdout"],
        recoverable: true
      })]
    };
  }

  return {
    ok: true,
    report: {
      schemaVersion: "1.0",
      role,
      status,
      summary: String(candidate.summary ?? ""),
      findings: reportArray(candidate.findings),
      evidence: reportArray(candidate.evidence),
      workItemId: String(candidate.workItemId ?? workItem.id),
      attemptId: String(candidate.attemptId ?? attemptId),
      workerId,
      reportedAt: now.toISOString()
    },
    errors: []
  };
}

export function validateCompletionReviews({ attempt, workItem }) {
  const reports = attempt?.runner?.reviewReports ?? [];
  const latestByRole = new Map();
  for (const report of reports) {
    if (report?.workItemId === workItem.id && report?.attemptId === attempt.attemptId) {
      latestByRole.set(report.role, report);
    }
  }

  const missing = REVIEW_ROLES.filter((role) => !latestByRole.has(role));
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_EVIDENCE_MISSING",
        reason: `Completion requires approved review evidence for: ${missing.join(", ")}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }

  const rejected = REVIEW_ROLES.map((role) => latestByRole.get(role))
    .find((report) => !APPROVED_REVIEW_STATUSES.has(report.status));
  if (rejected) {
    return {
      ok: false,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_REJECTED",
        reason: `${rejected.role} reported ${rejected.status}.`,
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: [`attempts/${attempt.attemptId}.json`],
        recoverable: true
      })]
    };
  }

  return { ok: true, errors: [] };
}
