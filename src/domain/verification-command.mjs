import crypto from "node:crypto";
import { stableStringify } from "../io/json.mjs";

export const VERIFICATION_PRODUCER = "makeitreal-engine verify";
export const BOARD_VERIFICATION_PRODUCER = "makeitreal-engine board-complete";

export function normalizeVerificationCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    return {
      ok: false,
      reason: "Verification command must be an object with file (or command) and args fields, for example {\"file\":\"npm\",\"args\":[\"test\"]}."
    };
  }

  const allowedKeys = new Set(["file", "command", "args", "env"]);
  const unsupportedKeys = Object.keys(command).filter((key) => !allowedKeys.has(key));
  if (unsupportedKeys.length > 0) {
    return {
      ok: false,
      reason: `Verification command has unsupported field(s): ${unsupportedKeys.join(", ")}. Supported fields are file, command, args, and env.`
    };
  }

  const file = command.file ?? command.command;
  if (typeof file !== "string" || file.trim().length === 0) {
    return {
      ok: false,
      reason: "Verification command file must be a non-empty string. Use {\"file\":\"npm\",\"args\":[\"test\"]}; {\"command\":\"npm\",\"args\":[\"test\"]} is accepted as an alias."
    };
  }

  const args = command.args ?? [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    return {
      ok: false,
      reason: "Verification command args must be an array of strings."
    };
  }

  const env = command.env ?? {};
  if (!env || typeof env !== "object" || Array.isArray(env) || Object.values(env).some((value) => typeof value !== "string")) {
    return {
      ok: false,
      reason: "Verification command env must be an object with string values."
    };
  }

  return {
    ok: true,
    command: {
      file,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {})
    }
  };
}

export function hashCommand(command) {
  const normalized = normalizeVerificationCommand(command);
  const value = normalized.ok ? normalized.command : command;
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function formatVerificationCommand(command) {
  const normalized = normalizeVerificationCommand(command);
  if (!normalized.ok) {
    return "<invalid verification command>";
  }
  return [normalized.command.file, ...normalized.command.args].join(" ");
}
