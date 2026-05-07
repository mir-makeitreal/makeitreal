import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransition } from "../src/kanban/state-engine.mjs";

test("Contract Frozen to Ready requires design, contract, responsibility, and Blueprint approval gates", () => {
  const blocked = canTransition({ from: "Contract Frozen", to: "Ready", context: { gates: { design: true } } });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.requiredGates, ["contract", "responsibility", "blueprintApproval"]);

  const allowed = canTransition({ from: "Contract Frozen", to: "Ready", context: { gates: { design: true, contract: true, responsibility: true, blueprintApproval: true } } });
  assert.equal(allowed.ok, true);
});

test("Running cannot jump directly to Done", () => {
  const result = canTransition({ from: "Running", to: "Done", context: { gates: {} } });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_TRANSITION_ILLEGAL");
});

test("Human Review to Done requires evidence and wiki", () => {
  const blocked = canTransition({ from: "Human Review", to: "Done", context: { gates: { evidence: true } } });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.requiredGates, ["wiki"]);

  const allowed = canTransition({ from: "Human Review", to: "Done", context: { gates: { evidence: true, wiki: true } } });
  assert.equal(allowed.ok, true);
});
