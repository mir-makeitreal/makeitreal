#!/usr/bin/env node
import { createInterface } from "node:readline";
import path from "node:path";
import {
  getBlueprintSchema,
  validateBlueprintProposal,
  normalizeBlueprintProposal,
  writeBlueprintArtifacts
} from "../dev-harness/src/plan/claude-blueprint.mjs";
import { materializeLaunchBoard } from "../dev-harness/src/plan/artifact-assembly.mjs";
import { seedBlueprintReview } from "../dev-harness/src/blueprint/review.mjs";
import { renderDesignPreview } from "../dev-harness/src/preview/render-preview.mjs";
import { readBoardStatus } from "../dev-harness/src/status/board-status.mjs";
import { readRunStatus } from "../dev-harness/src/status/run-status.mjs";
import {
  startNativeClaudeTask,
  finishNativeClaudeTask
} from "../dev-harness/src/orchestrator/orchestrator.mjs";
import { completeVerifiedWork } from "../dev-harness/src/orchestrator/board-completion.mjs";
import { runGates } from "../dev-harness/src/gates/index.mjs";
import { loadBoard } from "../dev-harness/src/board/board-store.mjs";
import { fileExists } from "../dev-harness/src/io/json.mjs";

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "make-it-real";
const SERVER_VERSION = "0.1.0";

function buildToolInputSchema() {
  const base = getBlueprintSchema();
  const properties = {
    projectRoot: {
      type: "string",
      description: "Absolute path to the project root"
    },
    runSlug: {
      type: "string",
      description: "Short identifier for this run (e.g. auth-system)"
    },
    ...(base.properties ?? {})
  };
  const required = ["projectRoot", "runSlug", ...(base.required ?? [])];
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true
  };
}

const LAUNCH_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    projectRoot: {
      type: "string",
      description: "Absolute path to the project root"
    },
    runSlug: {
      type: "string",
      description: "Run identifier (matches the plan run)"
    },
    action: {
      type: "string",
      enum: ["status", "start", "finish", "complete"],
      description: "Which phase of the launch loop to execute"
    },
    workItemId: {
      type: "string",
      description: "Work item ID (required for finish/complete)"
    },
    attemptId: {
      type: "string",
      description: "Attempt ID (required for finish)"
    },
    result: {
      type: "object",
      description: "Implementation result envelope (required for finish)"
    }
  },
  required: ["projectRoot", "runSlug", "action"],
  additionalProperties: true
};

const TOOL_DEFINITIONS = [
  {
    name: "mir_blueprint",
    description:
      "Submit an architecture blueprint for validation and storage. Claude generates the proposal, this tool validates and saves it.",
    inputSchema: buildToolInputSchema()
  },
  {
    name: "mir_launch",
    description:
      "Drive the Make It Real implementation loop. action=status returns launchable work, action=start dispatches native Claude tasks, action=finish records an attempt result, action=complete runs verification and moves work to Done.",
    inputSchema: LAUNCH_TOOL_INPUT_SCHEMA
  }
];

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolCallText(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: Boolean(payload && payload.ok === false)
  };
}

async function handleBlueprintTool(args) {
  if (!args || typeof args !== "object") {
    return toolCallText({ ok: false, errors: [{ code: "INVALID_ARGS", reason: "Tool arguments must be an object." }] });
  }
  const { projectRoot, runSlug, ...proposal } = args;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return toolCallText({ ok: false, errors: [{ code: "MISSING_PROJECT_ROOT", reason: "projectRoot is required." }] });
  }
  if (typeof runSlug !== "string" || runSlug.length === 0) {
    return toolCallText({ ok: false, errors: [{ code: "MISSING_RUN_SLUG", reason: "runSlug is required." }] });
  }
  if (!path.isAbsolute(projectRoot)) {
    return toolCallText({ ok: false, errors: [{ code: "PROJECT_ROOT_NOT_ABSOLUTE", reason: "projectRoot must be an absolute path." }] });
  }

  const validation = validateBlueprintProposal(proposal);
  if (!validation.ok) {
    return toolCallText({ ok: false, errors: validation.errors, warnings: validation.warnings });
  }

  const normalized = normalizeBlueprintProposal(proposal);
  const runDir = path.join(projectRoot, ".makeitreal", "runs", runSlug);

  await writeBlueprintArtifacts(normalized, runDir, runSlug);

  const launchBoard = await materializeLaunchBoard({
    runDir,
    runId: runSlug,
    slug: runSlug,
    workItems: normalized.workItems,
    workItemDag: normalized.workItemDag,
    runnerMode: "claude-code"
  });

  const review = await seedBlueprintReview({ runDir });
  const preview = await renderDesignPreview({ runDir });

  const previewUrl = preview && preview.dashboardRefresh
    ? preview.dashboardRefresh.dashboardUrl ?? null
    : null;

  const errors = [
    ...(launchBoard.errors ?? []),
    ...(review.errors ?? []),
    ...(preview.errors ?? [])
  ];

  if (errors.length > 0) {
    return toolCallText({
      ok: false,
      runDir,
      workItemCount: normalized.workItems.length,
      previewUrl,
      errors
    });
  }

  return toolCallText({
    ok: true,
    runDir,
    workItemCount: normalized.workItems.length,
    previewUrl
  });
}

function validateLaunchCommonArgs(args) {
  if (!args || typeof args !== "object") {
    return { ok: false, errors: [{ code: "INVALID_ARGS", reason: "Tool arguments must be an object." }] };
  }
  const { projectRoot, runSlug, action } = args;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return { ok: false, errors: [{ code: "MISSING_PROJECT_ROOT", reason: "projectRoot is required." }] };
  }
  if (!path.isAbsolute(projectRoot)) {
    return { ok: false, errors: [{ code: "PROJECT_ROOT_NOT_ABSOLUTE", reason: "projectRoot must be an absolute path." }] };
  }
  if (typeof runSlug !== "string" || runSlug.length === 0) {
    return { ok: false, errors: [{ code: "MISSING_RUN_SLUG", reason: "runSlug is required." }] };
  }
  if (typeof action !== "string" || !["status", "start", "finish", "complete"].includes(action)) {
    return { ok: false, errors: [{ code: "INVALID_ACTION", reason: "action must be one of: status, start, finish, complete." }] };
  }
  return { ok: true };
}

async function findWorkItemLane(runDir, workItemId) {
  const boardPath = path.join(runDir, "board.json");
  if (!await fileExists(boardPath)) return null;
  try {
    const board = await loadBoard(runDir);
    return board.workItems?.find((item) => item.id === workItemId)?.lane ?? null;
  } catch {
    return null;
  }
}

async function handleLaunchTool(args) {
  const validation = validateLaunchCommonArgs(args);
  if (!validation.ok) {
    return toolCallText({ ok: false, errors: validation.errors });
  }
  const { projectRoot, runSlug, action, workItemId, attemptId, result } = args;
  const runDir = path.join(projectRoot, ".makeitreal", "runs", runSlug);
  const now = new Date();

  if (action === "status") {
    if (!await fileExists(runDir)) {
      return toolCallText({
        ok: false,
        errors: [{ code: "RUN_DIR_MISSING", reason: `Run directory does not exist: ${runDir}` }]
      });
    }
    const readyGate = await runGates({ runDir, target: "Ready" });
    const boardJsonPath = path.join(runDir, "board.json");
    const hasBoard = await fileExists(boardJsonPath);
    const boardStatus = hasBoard
      ? await readBoardStatus({ boardDir: runDir, now, readyGate })
      : null;
    const runStatus = await readRunStatus({ projectRoot, runDir, now });
    return toolCallText({
      ok: true,
      action: "status",
      runDir,
      phase: boardStatus?.phase ?? runStatus?.phase ?? null,
      launchableWorkItemIds: boardStatus?.launchableWorkItemIds ?? [],
      recommendedNativeTaskConcurrency: boardStatus?.recommendedNativeTaskConcurrency ?? 0,
      laneCounts: boardStatus?.laneCounts ?? {},
      blockers: boardStatus?.blockers ?? runStatus?.blockers ?? [],
      nextAction: boardStatus?.nextAction ?? runStatus?.nextAction ?? null,
      readyGate: readyGate ? { ok: readyGate.ok, errors: readyGate.errors ?? [] } : null,
      blueprintApproved: runStatus?.blueprint?.ok ?? false,
      errors: []
    });
  }

  if (action === "start") {
    const boardJsonPath = path.join(runDir, "board.json");
    if (!await fileExists(boardJsonPath)) {
      return toolCallText({
        ok: false,
        action: "start",
        nativeTasks: [],
        errors: [{ code: "BOARD_MISSING", reason: `board.json not found in ${runDir}` }]
      });
    }
    const concurrencyArg = Number.parseInt(args.concurrency ?? "", 10);
    const concurrency = Number.isInteger(concurrencyArg) && concurrencyArg >= 1 ? concurrencyArg : 1;
    const startResult = await startNativeClaudeTask({
      boardDir: runDir,
      workerId: typeof args.workerId === "string" && args.workerId ? args.workerId : "claude-code.parent",
      concurrency,
      now
    });
    let board = null;
    try { board = await loadBoard(runDir); } catch { board = null; }
    const enrichedTasks = (startResult.nativeTasks ?? []).map((task) => {
      const workItem = board?.workItems?.find((item) => item.id === task.workItemId);
      return {
        workItemId: task.workItemId,
        attemptId: task.attemptId,
        nodeKind: task.nodeKind,
        nativeSubagentType: task.nativeSubagentType,
        allowedPaths: workItem?.allowedPaths ?? [],
        implementationPrompt: task.implementationPrompt,
        reviewerPrompts: task.reviewerPrompts
      };
    });
    return toolCallText({
      ok: startResult.ok,
      action: "start",
      nativeTasks: enrichedTasks,
      promotedWorkItemIds: startResult.promotedWorkItemIds ?? [],
      errors: startResult.errors ?? []
    });
  }

  if (action === "finish") {
    if (typeof workItemId !== "string" || !workItemId) {
      return toolCallText({ ok: false, action: "finish", errors: [{ code: "MISSING_WORK_ITEM_ID", reason: "workItemId is required for finish." }] });
    }
    if (typeof attemptId !== "string" || !attemptId) {
      return toolCallText({ ok: false, action: "finish", errors: [{ code: "MISSING_ATTEMPT_ID", reason: "attemptId is required for finish." }] });
    }
    if (!result || typeof result !== "object") {
      return toolCallText({ ok: false, action: "finish", errors: [{ code: "MISSING_RESULT", reason: "result envelope object is required for finish." }] });
    }
    const finishResult = await finishNativeClaudeTask({
      boardDir: runDir,
      workItemId,
      attemptId,
      workerId: typeof args.workerId === "string" && args.workerId ? args.workerId : "claude-code.parent",
      resultText: JSON.stringify(result),
      now
    });
    const lane = await findWorkItemLane(runDir, workItemId);
    return toolCallText({
      ok: finishResult.ok,
      action: "finish",
      workItemId: finishResult.workItemId ?? workItemId,
      attemptId: finishResult.attemptId ?? attemptId,
      lane,
      events: finishResult.events ?? [],
      decomposed: finishResult.decomposed ?? false,
      childWorkItemIds: finishResult.childWorkItemIds ?? [],
      errors: finishResult.errors ?? []
    });
  }

  if (action === "complete") {
    if (typeof workItemId !== "string" || !workItemId) {
      return toolCallText({ ok: false, action: "complete", errors: [{ code: "MISSING_WORK_ITEM_ID", reason: "workItemId is required for complete." }] });
    }
    const completeResult = await completeVerifiedWork({
      boardDir: runDir,
      workItemId,
      runnerMode: typeof args.runnerMode === "string" ? args.runnerMode : null,
      now
    });
    const newLane = await findWorkItemLane(runDir, workItemId);
    let remainingItems = [];
    try {
      const board = await loadBoard(runDir);
      remainingItems = (board.workItems ?? [])
        .filter((item) => !["Done", "Cancelled"].includes(item.lane))
        .map((item) => ({ id: item.id, lane: item.lane }));
    } catch {
      remainingItems = [];
    }
    return toolCallText({
      ok: completeResult.ok,
      action: "complete",
      workItemId: completeResult.workItemId ?? workItemId,
      newLane,
      evidence: {
        evidencePath: completeResult.evidencePath ?? null,
        wikiPath: completeResult.wikiPath ?? null,
        wikiSkipped: completeResult.wikiSkipped ?? false
      },
      remainingItems,
      errors: completeResult.errors ?? []
    });
  }

  return toolCallText({ ok: false, errors: [{ code: "INVALID_ACTION", reason: `Unknown action: ${action}` }] });
}

async function handleRequest(message) {
  const { id, method, params } = message;

  try {
    if (method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        }
      });
    }

    if (method === "tools/list") {
      return jsonRpcResult(id, { tools: TOOL_DEFINITIONS });
    }

    if (method === "tools/call") {
      const toolName = params && params.name;
      const args = (params && params.arguments) ?? {};
      if (toolName === "mir_blueprint") {
        const result = await handleBlueprintTool(args);
        return jsonRpcResult(id, result);
      }
      if (toolName === "mir_launch") {
        const result = await handleLaunchTool(args);
        return jsonRpcResult(id, result);
      }
      return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
    }

    if (method === "ping") {
      return jsonRpcResult(id, {});
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    if (method === "tools/call") {
      return jsonRpcResult(id, toolCallText({ ok: false, errors: [{ code: "TOOL_EXCEPTION", reason }] }));
    }
    return jsonRpcError(id, -32603, "Internal error", { reason });
  }
}

async function handleNotification(message) {
  // Notifications carry no id and expect no response. Acknowledge by ignoring.
  if (message.method === "notifications/initialized") return;
  if (message.method === "notifications/cancelled") return;
}

async function main() {
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (parseError) {
      writeMessage(jsonRpcError(null, -32700, "Parse error", { reason: parseError.message }));
      return;
    }

    try {
      if (message.id === undefined || message.id === null) {
        await handleNotification(message);
        return;
      }
      const response = await handleRequest(message);
      if (response) writeMessage(response);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      writeMessage(jsonRpcError(message.id ?? null, -32603, "Internal error", { reason }));
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });

  process.on("uncaughtException", (err) => {
    writeMessage(jsonRpcError(null, -32603, "Uncaught exception", { reason: err && err.message ? err.message : String(err) }));
  });
  process.on("unhandledRejection", (err) => {
    writeMessage(jsonRpcError(null, -32603, "Unhandled rejection", { reason: err && err.message ? err.message : String(err) }));
  });
}

main();
