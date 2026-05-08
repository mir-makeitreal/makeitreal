import { createHarnessError } from "../domain/errors.mjs";

export const IMPLEMENTATION_ROLE = "implementation-worker";

export const AGENT_STATUSES = Object.freeze([
  "DONE",
  "DONE_WITH_CONCERNS",
  "NEEDS_CONTEXT",
  "BLOCKED"
]);

const VALID_AGENT_STATUSES = new Set(AGENT_STATUSES);

export function buildDynamicRoleHandoff({ workItem, verificationCommand = null }) {
  return {
    schemaVersion: "1.0",
    role: IMPLEMENTATION_ROLE,
    coordination: {
      mode: "control-plane-mediated",
      authority: [
        "approved Blueprint",
        "work item",
        "declared contracts",
        "allowed paths",
        "dependency artifacts",
        "Make It Real gates"
      ],
      forbidden: [
        "direct free-form agent-to-agent chat",
        "worker self-scoping from parent conversation history",
        "edits outside allowed paths",
        "fallback behavior outside declared contracts"
      ]
    },
    statusProtocol: AGENT_STATUSES,
    reportSchema: {
      makeitrealReport: {
        role: IMPLEMENTATION_ROLE,
        status: "DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED",
        summary: "string",
        changedFiles: ["relative/path"],
        tested: ["command or evidence"],
        concerns: ["optional concern"],
        needsContext: ["optional missing fact"],
        blockers: ["optional blocker"]
      }
    },
    reviewLoop: {
      afterDone: ["spec-reviewer", "quality-reviewer", "verification-reviewer"],
      sameImplementerFixesReviewFindings: true,
      nonDoneStatusCreatesReviewDebt: true
    },
    assignment: {
      workItemId: workItem.id,
      responsibilityUnitId: workItem.responsibilityUnitId ?? null,
      allowedPaths: workItem.allowedPaths ?? [],
      contractIds: workItem.contractIds ?? [],
      verificationCommand
    }
  };
}

export function renderDynamicRolePrompt(roleHandoff) {
  return `## Dynamic Role Handoff

Role: ${roleHandoff.role}
Coordination: ${roleHandoff.coordination.mode}

Authority:
${roleHandoff.coordination.authority.map((item) => `- ${item}`).join("\n")}

Forbidden:
${roleHandoff.coordination.forbidden.map((item) => `- ${item}`).join("\n")}

## Report Status Protocol

Before exiting, emit a structured Make It Real report in the final JSON event payload when possible:

\`\`\`json
{
  "event": "turn_completed",
  "makeitrealReport": {
    "role": "${IMPLEMENTATION_ROLE}",
    "status": "DONE",
    "summary": "Implemented the approved work item.",
    "changedFiles": [],
    "tested": [],
    "concerns": [],
    "needsContext": [],
    "blockers": []
  }
}
\`\`\`

Allowed statuses:
${roleHandoff.statusProtocol.map((status) => `- ${status}`).join("\n")}

Use DONE only when the approved work item is complete and verified from the staged workspace. Use DONE_WITH_CONCERNS when implementation is complete but you have correctness, scope, or quality concerns. Use NEEDS_CONTEXT when a missing decision prevents correct implementation. Use BLOCKED when the work cannot proceed safely.
`;
}

function reportArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

function candidateReport(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  return record.makeitrealReport
    ?? record.agentReport
    ?? record.payload?.makeitrealReport
    ?? record.payload?.agentReport
    ?? null;
}

export function extractAgentReport({ record, workItem, workerId, attemptId, now }) {
  const candidate = candidateReport(record);
  if (!candidate) {
    return { ok: true, report: null, errors: [] };
  }

  const status = String(candidate.status ?? "");
  if (!VALID_AGENT_STATUSES.has(status)) {
    return {
      ok: false,
      report: null,
      errors: [createHarnessError({
        code: "HARNESS_AGENT_STATUS_INVALID",
        reason: `Agent report status must be one of ${AGENT_STATUSES.join(", ")}.`,
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
      role: String(candidate.role ?? IMPLEMENTATION_ROLE),
      status,
      summary: String(candidate.summary ?? ""),
      changedFiles: reportArray(candidate.changedFiles),
      tested: reportArray(candidate.tested),
      concerns: reportArray(candidate.concerns),
      needsContext: reportArray(candidate.needsContext),
      blockers: reportArray(candidate.blockers),
      workItemId: workItem.id,
      workerId,
      attemptId,
      reportedAt: now.toISOString()
    },
    errors: []
  };
}

export function validateAgentReports({ reports, workItem }) {
  const implementationReports = (reports ?? []).filter((report) => report.role === IMPLEMENTATION_ROLE);
  const latest = implementationReports.at(-1) ?? null;
  if (!latest || latest.status === "DONE") {
    return { ok: true, errors: [] };
  }

  const codes = {
    DONE_WITH_CONCERNS: "HARNESS_AGENT_DONE_WITH_CONCERNS",
    NEEDS_CONTEXT: "HARNESS_AGENT_NEEDS_CONTEXT",
    BLOCKED: "HARNESS_AGENT_BLOCKED"
  };
  return {
    ok: false,
    errors: [createHarnessError({
      code: codes[latest.status] ?? "HARNESS_AGENT_STATUS_INVALID",
      reason: `Implementation worker reported ${latest.status}.`,
      ownerModule: workItem.responsibilityUnitId ?? null,
      evidence: ["runner.stdout", `attempts/${attemptIdFromReport(latest)}.json`].filter(Boolean),
      recoverable: true
    })]
  };
}

function attemptIdFromReport(report) {
  return report?.attemptId ?? null;
}
