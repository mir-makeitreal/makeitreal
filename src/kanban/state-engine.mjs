import { createHarnessError } from "../domain/errors.mjs";
import { TRANSITIONS } from "./lanes.mjs";

export function canTransition({ from, to, context }) {
  const transition = TRANSITIONS.find((candidate) => candidate.from === from && candidate.to === to);
  if (!transition) {
    return {
      ok: false,
      requiredGates: [],
      errors: [createHarnessError({
        code: "HARNESS_TRANSITION_ILLEGAL",
        reason: `Illegal Kanban transition: ${from} -> ${to}`,
        evidence: []
      })]
    };
  }

  const gates = context?.gates ?? {};
  const missing = transition.requiredGates.filter((gate) => gates[gate] !== true);
  return {
    ok: missing.length === 0,
    requiredGates: missing,
    errors: missing.map((gate) => createHarnessError({
      code: "HARNESS_GATE_REQUIRED",
      reason: `${from} -> ${to} requires gate: ${gate}`,
      evidence: []
    }))
  };
}
