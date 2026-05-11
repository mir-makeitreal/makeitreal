import { spawn } from "node:child_process";

const DECISIONS = new Set(["approved", "rejected", "revision_requested", "none"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_CONTEXT_CHARS = 12000;

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: {
      type: "string",
      enum: ["approved", "rejected", "revision_requested", "none"]
    },
    launchRequested: { type: "boolean" },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"]
    },
    reason: { type: "string" }
  },
  required: ["decision", "launchRequested", "confidence", "reason"]
};

const JUDGE_SYSTEM_PROMPT = [
  "You are the Make It Real Blueprint review-intent judge.",
  "Your only job is to decide the user's intent toward the pending Blueprint review.",
  "Do not evaluate whether the Blueprint is technically good.",
  "Use the latest user prompt and the previous assistant message as conversation context.",
  "Choose approved only when the user intentionally approves the current Blueprint.",
  "Choose rejected when the user explicitly rejects the current Blueprint.",
  "Choose revision_requested when the user asks for changes, more review, or blocks approval until changes are made.",
  "Choose none when the prompt is unrelated or ambiguous.",
  "Set launchRequested true only when the user also asks execution to start after approval.",
  "Return only JSON that matches the provided schema."
].join("\n");

function truncate(value) {
  const text = String(value ?? "");
  if (text.length <= MAX_CONTEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_CONTEXT_CHARS)}\n[truncated]`;
}

function buildJudgePrompt({ prompt, approvalContext, runDir }) {
  return JSON.stringify({
    task: "Classify the user's Make It Real Blueprint review intent.",
    currentRunDir: runDir ?? null,
    userPrompt: truncate(prompt),
    previousAssistantMessage: truncate(approvalContext),
    outputContract: {
      decision: "approved | rejected | revision_requested | none",
      launchRequested: "boolean",
      confidence: "high | medium | low",
      reason: "short explanation"
    }
  }, null, 2);
}

function parseCommandJson(env) {
  if (!env.MAKEITREAL_APPROVAL_JUDGE_COMMAND_JSON) {
    return null;
  }
  const parsed = JSON.parse(env.MAKEITREAL_APPROVAL_JUDGE_COMMAND_JSON);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.file !== "string") {
    throw new Error("MAKEITREAL_APPROVAL_JUDGE_COMMAND_JSON must be an object with a string file.");
  }
  if (parsed.args !== undefined && (!Array.isArray(parsed.args) || parsed.args.some((arg) => typeof arg !== "string"))) {
    throw new Error("MAKEITREAL_APPROVAL_JUDGE_COMMAND_JSON args must be an array of strings.");
  }
  return {
    file: parsed.file,
    args: parsed.args ?? []
  };
}

function resolveJudgeCommand(env = process.env) {
  const configured = parseCommandJson(env);
  if (configured) {
    return configured;
  }
  return {
    file: env.MAKEITREAL_APPROVAL_JUDGE_COMMAND || "claude",
    args: [
      "--print",
      "--output-format",
      "json",
      "--permission-mode",
      "dontAsk",
      "--tools",
      "",
      "--no-session-persistence",
      "--system-prompt",
      JUDGE_SYSTEM_PROMPT,
      "--json-schema",
      JSON.stringify(JUDGE_SCHEMA)
    ]
  };
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }
  return JSON.parse(value);
}

function extractJudgePayload(stdout) {
  const parsed = JSON.parse(stdout);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    if (parsed.is_error) {
      throw new Error(parsed.result || "Claude approval judge returned an error result.");
    }
    if (Object.hasOwn(parsed, "result") && String(parsed.result ?? "").trim()) {
      return parseMaybeJson(parsed.result);
    }
    if (Object.hasOwn(parsed, "structured_output")) {
      return parseMaybeJson(parsed.structured_output);
    }
    if (Object.hasOwn(parsed, "decision")) {
      return parsed;
    }
  }
  throw new Error("Approval judge output did not contain a decision payload.");
}

function normalizeJudgePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Approval judge decision must be a JSON object.");
  }
  if (!DECISIONS.has(payload.decision)) {
    throw new Error("Approval judge decision must be approved, rejected, revision_requested, or none.");
  }
  if (typeof payload.launchRequested !== "boolean") {
    throw new Error("Approval judge launchRequested must be boolean.");
  }
  if (!CONFIDENCE.has(payload.confidence)) {
    throw new Error("Approval judge confidence must be high, medium, or low.");
  }
  if (typeof payload.reason !== "string" || !payload.reason.trim()) {
    throw new Error("Approval judge reason must be a non-empty string.");
  }
  return {
    ok: true,
    decision: payload.decision,
    launchRequested: payload.launchRequested,
    confidence: payload.confidence,
    reason: payload.reason.trim()
  };
}

function runJudgeCommand({ command, promptText, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command.file, [...command.args, promptText], {
      env: { ...env, MAKEITREAL_APPROVAL_JUDGE_ACTIVE: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        error: `Approval judge timed out after ${timeoutMs}ms.`
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          error: `Approval judge exited with code ${code}: ${stderr.trim()}`
        });
        return;
      }
      resolve({ ok: true, stdout });
    });
  });
}

export async function judgeInteractiveBlueprintReviewWithLlm({
  prompt,
  approvalContext = "",
  runDir = null,
  env = process.env
}) {
  let command;
  try {
    command = resolveJudgeCommand(env);
  } catch (error) {
    return {
      ok: false,
      decision: "none",
      launchRequested: false,
      confidence: "low",
      reason: error instanceof Error ? error.message : String(error)
    };
  }

  const timeoutMs = Number.parseInt(env.MAKEITREAL_APPROVAL_JUDGE_TIMEOUT_MS ?? "", 10) || DEFAULT_TIMEOUT_MS;
  const executed = await runJudgeCommand({
    command,
    promptText: buildJudgePrompt({ prompt, approvalContext, runDir }),
    env,
    timeoutMs
  });
  if (!executed.ok) {
    return {
      ok: false,
      decision: "none",
      launchRequested: false,
      confidence: "low",
      reason: executed.error
    };
  }

  try {
    return normalizeJudgePayload(extractJudgePayload(executed.stdout));
  } catch (error) {
    return {
      ok: false,
      decision: "none",
      launchRequested: false,
      confidence: "low",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
