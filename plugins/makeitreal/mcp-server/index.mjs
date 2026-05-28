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

const TOOL_DEFINITIONS = [
  {
    name: "mir_blueprint",
    description:
      "Submit an architecture blueprint for validation and storage. Claude generates the proposal, this tool validates and saves it.",
    inputSchema: buildToolInputSchema()
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
      if (toolName !== "mir_blueprint") {
        return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
      const result = await handleBlueprintTool(args);
      return jsonRpcResult(id, result);
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
