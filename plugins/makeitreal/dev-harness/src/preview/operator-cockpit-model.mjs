const FIRST_RUN_STEPS = Object.freeze([
  { id: "setup", label: "Setup", command: "/makeitreal:setup" },
  { id: "plan", label: "Plan", command: "/makeitreal:plan <request>" },
  { id: "blueprint-review", label: "Blueprint Review", command: "Approve in chat or /makeitreal:plan approve" },
  { id: "launch", label: "Launch", command: "/makeitreal:launch" },
  { id: "verification", label: "Verification", command: "/makeitreal:verify" },
  { id: "done", label: "Done", command: "/makeitreal:status" }
]);

const PHASE_STATUS = Object.freeze({
  "setup-required": ["current", "pending", "pending", "pending", "pending", "pending"],
  "approval-required": ["complete", "complete", "current", "pending", "pending", "pending"],
  "launch-ready": ["complete", "complete", "complete", "current", "pending", "pending"],
  running: ["complete", "complete", "complete", "complete", "current", "pending"],
  verifying: ["complete", "complete", "complete", "complete", "current", "pending"],
  "human-review": ["complete", "complete", "complete", "complete", "current", "pending"],
  "failed-fast": ["complete", "complete", "complete", "blocked", "blocked", "pending"],
  "rework-required": ["complete", "complete", "complete", "blocked", "blocked", "pending"],
  blocked: ["complete", "complete", "blocked", "pending", "pending", "pending"],
  done: ["complete", "complete", "complete", "complete", "complete", "complete"]
});

function checklistForPhase(phase) {
  const statuses = PHASE_STATUS[phase] ?? ["complete", "complete", "blocked", "pending", "pending", "pending"];
  return FIRST_RUN_STEPS.map((step, index) => ({
    ...step,
    status: statuses[index]
  }));
}

function evidenceHref(path) {
  if (!path || path.startsWith("/") || path.includes("..")) {
    return null;
  }
  return `../${path}`;
}

function evidenceLinks(evidenceSummary = []) {
  return evidenceSummary.map((item) => ({
    kind: item.kind ?? "evidence",
    summary: item.summary ?? "",
    path: item.path ?? "",
    href: evidenceHref(item.path)
  }));
}

export function buildOperatorCockpitModel({ status }) {
  return {
    readOnly: true,
    controlSurface: "claude-code",
    phase: status.phase ?? "unknown",
    blueprintStatus: status.blueprintStatus ?? "unknown",
    headline: status.headline ?? "Status unavailable.",
    nextAction: status.nextAction ?? "Run /makeitreal:status in Claude Code.",
    nextCommand: status.nextCommand ?? "/makeitreal:status",
    firstRunChecklist: checklistForPhase(status.phase),
    evidenceLinks: evidenceLinks(status.evidenceSummary)
  };
}
