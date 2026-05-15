import assert from "node:assert/strict";
import { test } from "node:test";
import { validateNativePacket } from "../src/orchestrator/native-packets.mjs";

const packet = {
  schemaVersion: "1.0",
  runDir: "/project/.makeitreal/runs/feature-orders",
  projectRoot: "/project",
  expectedCwd: "/project",
  workItemId: "work.orders-api",
  attemptId: "attempt.001",
  evidenceRole: "implementation-worker",
  hookContext: {
    runDir: "/project/.makeitreal/runs/feature-orders",
    workItemId: "work.orders-api",
    agentPacketPath: "/project/.makeitreal/runs/feature-orders/agent-packets/work.orders-api.attempt.001.json"
  },
  scope: {
    responsibilityUnitId: "ru.orders-api",
    allowedPaths: ["src/api/orders/**"],
    forbiddenPaths: [".makeitreal/**"]
  },
  readScope: {
    requiredReads: ["prd.json", "design-pack.json"],
    forbiddenReads: ["src/data/orders/**"]
  },
  contracts: ["contract.orders.create"],
  dependencyContracts: [],
  verificationCommands: [{ file: "node", args: ["--test"] }],
  reportSchema: "makeitrealReport.v1"
};

test("validates complete native packet", () => {
  assert.equal(validateNativePacket(packet).ok, true);
});

test("rejects missing hook-visible work item scope", () => {
  const result = validateNativePacket({ ...packet, hookContext: { runDir: packet.runDir } });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_PACKET_SCOPE_MISSING");
});

test("rejects native packet expected cwd under legacy workspace", () => {
  const result = validateNativePacket({
    ...packet,
    expectedCwd: "/project/.makeitreal/runs/feature-orders/workspaces/work.orders-api"
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_NATIVE_PACKET_WORKSPACE_INVALID");
});
