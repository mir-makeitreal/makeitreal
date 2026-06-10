import { createHarnessError } from "../domain/errors.mjs";

export const REVIEW_STATUSES = Object.freeze([
  "APPROVED",
  "APPROVED_WITH_NOTES",
  "CHANGES_REQUESTED",
  "REJECTED",
  "NEEDS_CONTEXT",
  "BLOCKED"
]);

// The LLM must use these exact status strings to signal approval, so the engine
// keeps them as a named constant. It does NOT define which review roles a run
// requires — that comes from the work item / completion policy.
export const APPROVED_REVIEW_STATUSES = new Set(["APPROVED", "APPROVED_WITH_NOTES"]);
const VALID_REVIEW_STATUSES = new Set(REVIEW_STATUSES);

// Infrastructure validation only. Doctrine: requiredReviewRoles is NOT declared
// here — it comes from workItem.requiredReviewRoles. The engine validates and
// saves; it does not decide which reviewers a work item needs.
// Canonical copy shared by orchestrator.mjs and board-completion.mjs; reportKeys
// are only consumed by the native finish path in orchestrator.mjs.
export const COMPLETION_POLICIES = Object.freeze({
  "implementation": {
    reportRole: "implementation-worker",
    reportKeys: ["makeitrealReport", "agentReport"],
    requiresChangedFiles: true,
    requiresVerificationCommands: true
  },
  "domain-pm": {
    reportRole: "domain-pm",
    reportKeys: ["makeitrealPmReport", "pmReport"],
    requiresChangedFiles: false,
    requiresVerificationCommands: false
  },
  "integration-evidence": {
    reportRole: "integration-evidence",
    reportKeys: ["makeitrealEvidenceReport", "evidenceReport"],
    requiresChangedFiles: false,
    requiresVerificationCommands: true
  }
});

// Doctrine: the blueprint (LLM) decides which review roles a work item needs.
// The engine only validates and saves. Blueprint import rejects work items that
// omit the declaration (REQUIRED_REVIEW_ROLES_REQUIRED); this runtime warning
// only covers boards imported before that gate existed.
export function resolveRequiredReviewRoles({ workItem }) {
  if (Array.isArray(workItem?.requiredReviewRoles)) {
    return workItem.requiredReviewRoles;
  }
  process.stderr.write("[make-it-real] workItem missing requiredReviewRoles — no reviewers required. Declare requiredReviewRoles in your blueprint.\n");
  return [];
}

function reportArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (typeof item === "string") {
      return item.trim();
    }
    if (item && typeof item === "object") {
      return JSON.stringify(item);
    }
    return String(item ?? "").trim();
  }).filter(Boolean);
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
  if (!role) {
    return {
      ok: false,
      report: null,
      errors: [createHarnessError({
        code: "HARNESS_REVIEW_ROLE_INVALID",
        reason: "Review report must declare a non-empty role.",
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
      mappingPath: candidate.mappingPath ? String(candidate.mappingPath) : null,
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

export function validateCompletionReviews({ attempt, workItem, requiredRoles = [] }) {
  const reports = attempt?.runner?.reviewReports ?? [];
  const latestByRole = new Map();
  for (const report of reports) {
    if (report?.workItemId === workItem.id && report?.attemptId === attempt.attemptId) {
      latestByRole.set(report.role, report);
    }
  }

  const required = Array.isArray(requiredRoles) ? requiredRoles : [];
  const missing = required.filter((role) => !latestByRole.has(role));
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

  const rejected = required.map((role) => latestByRole.get(role))
    .find((report) => report && !APPROVED_REVIEW_STATUSES.has(report.status));
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
