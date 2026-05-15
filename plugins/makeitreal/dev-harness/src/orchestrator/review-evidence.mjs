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
  const direct = record.makeitrealReview
    ?? record.reviewReport
    ?? record.payload?.makeitrealReview
    ?? record.payload?.reviewReport
    ?? record.makeitrealReviews
    ?? record.reviewReports
    ?? record.reviews
    ?? record.payload?.makeitrealReviews
    ?? record.payload?.reviewReports
    ?? record.payload?.reviews
    ?? null;
  if (direct) {
    return direct;
  }

  for (const payload of structuredPayloadsFromText(record.result)) {
    const nested = payload.makeitrealReview
      ?? payload.reviewReport
      ?? payload.makeitrealReviews
      ?? payload.reviewReports
      ?? payload.reviews
      ?? null;
    if (nested) {
      return nested;
    }
  }

  return null;
}

function structuredPayloadsFromText(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }
  const text = value.trim();
  const candidates = [text];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    candidates.push(match[1].trim());
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  const payloads = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      payloads.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Non-JSON prose is normal Claude output; ignore it.
    }
  }
  return payloads;
}

function normalizeCandidates(candidate) {
  if (!candidate) {
    return [];
  }
  if (Array.isArray(candidate)) {
    return candidate.flatMap((item) => normalizeCandidates(item));
  }
  if (typeof candidate === "object") {
    if (candidate.role || candidate.status) {
      return [candidate];
    }
    const nested = candidate.makeitrealReview
      ?? candidate.reviewReport
      ?? candidate.makeitrealReviews
      ?? candidate.reviewReports
      ?? candidate.reviews
      ?? candidate.payload?.makeitrealReview
      ?? candidate.payload?.reviewReport
      ?? candidate.payload?.makeitrealReviews
      ?? candidate.payload?.reviewReports
      ?? candidate.payload?.reviews
      ?? null;
    if (nested) {
      return normalizeCandidates(nested);
    }
  }
  return [candidate];
}

export function extractReviewReports({ record, workItem, workerId, attemptId, now }) {
  const candidates = normalizeCandidates(candidateReview(record));
  if (candidates.length === 0) {
    return { ok: true, reports: [], errors: [] };
  }

  const reports = [];
  const errors = [];
  for (const candidate of candidates) {
    const extracted = extractSingleReviewReport({ candidate, workItem, workerId, attemptId, now });
    if (!extracted.ok) {
      errors.push(...extracted.errors);
    } else {
      reports.push(extracted.report);
    }
  }

  return { ok: errors.length === 0, reports, errors };
}

export function extractReviewReport({ record, workItem, workerId, attemptId, now }) {
  const extracted = extractReviewReports({ record, workItem, workerId, attemptId, now });
  return {
    ok: extracted.ok,
    report: extracted.reports[0] ?? null,
    errors: extracted.errors
  };
}

function extractSingleReviewReport({ candidate, workItem, workerId, attemptId, now }) {
  if (!candidate || typeof candidate !== "object") {
    return {
      ok: false,
      report: null,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_REPORT_INVALID",
        reason: "Review report must be an object.",
        ownerModule: workItem.responsibilityUnitId ?? null,
        evidence: ["runner.stdout"],
        recoverable: true
      })]
    };
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
      evidenceRole: String(candidate.evidenceRole ?? role),
      nativeSubagentType: candidate.nativeSubagentType ? String(candidate.nativeSubagentType) : null,
      mappingSource: candidate.mappingSource ? String(candidate.mappingSource) : null,
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
