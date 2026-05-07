export const LANES = [
  "Intake",
  "Discovery",
  "Scoped",
  "Blueprint Bound",
  "Contract Frozen",
  "Ready",
  "Claimed",
  "Running",
  "Verifying",
  "Human Review",
  "Done",
  "Failed Fast",
  "Rework",
  "Blocked",
  "Cancelled"
];

export const TRANSITIONS = [
  { from: "Intake", to: "Discovery", requiredGates: [] },
  { from: "Discovery", to: "Scoped", requiredGates: ["prd"] },
  { from: "Scoped", to: "Blueprint Bound", requiredGates: ["blueprint"] },
  { from: "Blueprint Bound", to: "Contract Frozen", requiredGates: ["contract"] },
  { from: "Contract Frozen", to: "Ready", requiredGates: ["design", "contract", "responsibility", "blueprintApproval"] },
  { from: "Ready", to: "Claimed", requiredGates: [] },
  { from: "Claimed", to: "Ready", requiredGates: ["leaseExpired"] },
  { from: "Claimed", to: "Running", requiredGates: [] },
  { from: "Running", to: "Verifying", requiredGates: [] },
  { from: "Running", to: "Failed Fast", requiredGates: [] },
  { from: "Failed Fast", to: "Ready", requiredGates: ["retry"] },
  { from: "Verifying", to: "Human Review", requiredGates: ["evidence"] },
  { from: "Verifying", to: "Rework", requiredGates: [] },
  { from: "Human Review", to: "Done", requiredGates: ["evidence", "wiki"] }
];
